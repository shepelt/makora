import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ConflictError, normalizeEtag, read, stat, write } from './dav';
import type { DavConfig } from './dav';
import type { EditorHandle } from './Editor';
import { clearDraft, getDraft, putDraft } from './store';

export type Status = 'idle' | 'loading' | 'clean' | 'dirty' | 'saving' | 'conflict' | 'error';

export type DocState = {
  path: string | null;
  status: Status;
  error: string | null;
  // Bumped whenever the editor must be recreated with new content.
  editorKey: number;
  initialMarkdown: string;
  // The server changed the file while we have unsaved edits.
  remoteChanged: boolean;
  // A local draft exists but was based on an older server version.
  staleDraft: { text: string; updatedAt: number } | null;
  // Saving would change formatting of untouched parts of the file.
  normalizes: { changedLines: number } | null;
  lastSavedAt: number | null;
};

const AUTOSAVE_MS = 2500;
const DRAFT_MS = 800;
const POLL_MS = 60_000;

// --- lossless-ish save helpers ----------------------------------------------
// Keep the file's line endings, BOM and trailing newline as they were.

type FileShape = { crlf: boolean; bom: boolean; trailing: string };

export function shapeOf(text: string): FileShape {
  return {
    crlf: /\r\n/.test(text),
    bom: text.charCodeAt(0) === 0xfeff,
    trailing: toEditor(text).match(/\n*$/)![0],
  };
}

export function toEditor(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function fromEditor(md: string, shape: FileShape): string {
  let out = md.replace(/\n+$/, '') + shape.trailing;
  if (shape.crlf) out = out.replace(/\n/g, '\r\n');
  if (shape.bom) out = '﻿' + out;
  return out;
}

function countChangedLines(a: string, b: string): number {
  const al = a.split('\n');
  const bl = b.split('\n');
  let n = Math.abs(al.length - bl.length);
  const len = Math.min(al.length, bl.length);
  for (let i = 0; i < len; i++) if (al[i] !== bl[i]) n++;
  return n;
}

function conflictCopyName(path: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const m = path.match(/^(.*?)(\.[^./]+)?$/)!;
  return `${m[1]} (conflict ${stamp})${m[2] ?? ''}`;
}

// -----------------------------------------------------------------------------

export function useDocument(cfg: DavConfig | null, editorRef: RefObject<EditorHandle | null>) {
  const [doc, setDoc] = useState<DocState>({
    path: null,
    status: 'idle',
    error: null,
    editorKey: 0,
    initialMarkdown: '',
    remoteChanged: false,
    staleDraft: null,
    normalizes: null,
    lastSavedAt: null,
  });

  // Mutable bookkeeping that must not trigger renders.
  const r = useRef({
    path: null as string | null,
    etag: null as string | null,
    shape: { crlf: false, bom: false, trailing: '\n' } as FileShape,
    original: '', // editor-normalized text as loaded
    seq: 0, // increments on every edit
    savedSeq: 0,
    saving: null as Promise<void> | null,
    autosave: 0 as any,
    draftTimer: 0 as any,
    checkedNormalization: false,
  });

  const docRef = useRef(doc);
  docRef.current = doc;

  const patch = useCallback((p: Partial<DocState>) => setDoc((d) => ({ ...d, ...p })), []);

  const isDirty = () => r.current.seq !== r.current.savedSeq;

  // --- save ------------------------------------------------------------------

  const save = useCallback(async (opts: { force?: boolean } = {}): Promise<void> => {
    const s = r.current;
    if (!cfg || !s.path) return;
    if (s.saving) {
      await s.saving;
      if (!isDirty()) return;
    }
    if (!isDirty() && !opts.force) return;
    clearTimeout(s.autosave);

    const run = (async () => {
      const path = s.path!;
      const seqAtStart = s.seq;
      patch({ status: 'saving', error: null });
      try {
        const md = await editorRef.current!.getMarkdown();
        if (s.path !== path) return;
        await putDraft(cfg, path, { text: md, baseEtag: s.etag, updatedAt: Date.now() });
        let etag = s.etag;
        if (opts.force) etag = (await stat(cfg, path)).etag;
        const res = await write(cfg, path, fromEditor(md, s.shape), etag);
        if (s.path !== path) return;
        s.etag = res.etag;
        s.savedSeq = seqAtStart;
        if (isDirty()) {
          patch({ status: 'dirty', lastSavedAt: Date.now(), remoteChanged: false });
          scheduleAutosave();
        } else {
          await clearDraft(cfg, path);
          patch({ status: 'clean', lastSavedAt: Date.now(), remoteChanged: false });
        }
      } catch (err: any) {
        if (s.path !== path) return;
        if (err instanceof ConflictError) {
          patch({ status: 'conflict', error: null });
        } else {
          patch({ status: 'error', error: err?.message || String(err) });
        }
      }
    })();
    s.saving = run;
    try {
      await run;
    } finally {
      s.saving = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, patch]);

  const scheduleAutosave = useCallback(() => {
    const s = r.current;
    clearTimeout(s.autosave);
    s.autosave = setTimeout(() => {
      // Don't auto-retry into a conflict; the user decides.
      if (docRef.current.status !== 'conflict') void save();
    }, AUTOSAVE_MS);
  }, [save]);

  // --- edits -----------------------------------------------------------------

  const onEdit = useCallback(() => {
    const s = r.current;
    s.seq++;
    setDoc((d) => (d.status === 'clean' || d.status === 'idle' ? { ...d, status: 'dirty' } : d));
    clearTimeout(s.draftTimer);
    s.draftTimer = setTimeout(async () => {
      if (!cfg || !s.path || !editorRef.current) return;
      const path = s.path;
      const md = await editorRef.current.getMarkdown();
      if (s.path === path && isDirty()) await putDraft(cfg, path, { text: md, baseEtag: s.etag, updatedAt: Date.now() });
    }, DRAFT_MS);
    scheduleAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, scheduleAutosave]);

  // --- open ------------------------------------------------------------------

  const open = useCallback(async (path: string) => {
    if (!cfg) return;
    const s = r.current;
    if (s.path && isDirty()) await save();
    clearTimeout(s.autosave);
    clearTimeout(s.draftTimer);
    s.path = path;
    patch({ path, status: 'loading', error: null, remoteChanged: false, staleDraft: null, normalizes: null });
    try {
      performance.mark('open:start');
      const [file, draft] = await Promise.all([read(cfg, path), getDraft(cfg, path)]);
      performance.mark('open:fetched');
      if (s.path !== path) return;
      s.etag = file.etag;
      s.shape = shapeOf(file.text);
      s.original = toEditor(file.text);
      s.checkedNormalization = false;
      let initial = s.original;
      let status: Status = 'clean';
      let staleDraft: DocState['staleDraft'] = null;
      s.seq = 0;
      s.savedSeq = 0;
      if (draft && draft.text !== s.original) {
        if (draft.baseEtag && normalizeEtag(draft.baseEtag) === file.etag) {
          // Unsaved work on top of the current server version: restore it.
          initial = draft.text;
          s.seq = 1;
          status = 'dirty';
        } else {
          staleDraft = { text: draft.text, updatedAt: draft.updatedAt };
        }
      } else if (draft) {
        await clearDraft(cfg, path);
      }
      setDoc((d) => ({
        ...d,
        path,
        status,
        error: null,
        editorKey: d.editorKey + 1,
        initialMarkdown: initial,
        staleDraft,
        remoteChanged: false,
      }));
      if (status === 'dirty') scheduleAutosave();
    } catch (err: any) {
      if (s.path !== path) return;
      patch({ status: 'error', error: err?.message || String(err) });
    }
  }, [cfg, patch, save, scheduleAutosave]);

  // Called by the editor once it has rendered: check whether a save would
  // reformat parts of the file the user didn't touch.
  const onEditorReady = useCallback(async () => {
    const s = r.current;
    if (s.checkedNormalization || !editorRef.current) return;
    s.checkedNormalization = true;
    if (isDirty()) return;
    const md = await editorRef.current.getMarkdown();
    const roundTrip = toEditor(fromEditor(md, s.shape));
    if (roundTrip !== s.original) {
      patch({ normalizes: { changedLines: countChangedLines(s.original, roundTrip) } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch]);

  // --- conflict resolution ---------------------------------------------------

  const resolveConflict = useCallback(async (choice: 'reload' | 'overwrite' | 'copy') => {
    const s = r.current;
    if (!cfg || !s.path) return;
    const path = s.path;
    if (choice === 'overwrite') {
      await save({ force: true });
      return;
    }
    const md = await editorRef.current!.getMarkdown();
    if (choice === 'copy') {
      try {
        await write(cfg, conflictCopyName(path), fromEditor(md, s.shape), null);
      } catch (err: any) {
        patch({ status: 'error', error: `Could not save copy: ${err?.message || err}` });
        return;
      }
    }
    await clearDraft(cfg, path);
    s.seq = s.savedSeq; // discard local edits
    await open(path);
  }, [cfg, open, patch, save]);

  const discardStaleDraft = useCallback(async () => {
    if (!cfg || !r.current.path) return;
    await clearDraft(cfg, r.current.path);
    patch({ staleDraft: null });
  }, [cfg, patch]);

  const saveStaleDraftAsCopy = useCallback(async () => {
    const s = r.current;
    if (!cfg || !s.path) return;
    const draft = docRef.current.staleDraft;
    if (!draft) return;
    try {
      await write(cfg, conflictCopyName(s.path), fromEditor(draft.text, s.shape), null);
      await clearDraft(cfg, s.path);
      patch({ staleDraft: null });
    } catch (err: any) {
      patch({ error: `Could not save copy: ${err?.message || err}` });
    }
  }, [cfg, patch]);

  // --- remote change detection -----------------------------------------------

  const checkRemote = useCallback(async () => {
    const s = r.current;
    if (!cfg || !s.path || s.saving || document.visibilityState !== 'visible') return;
    const path = s.path;
    try {
      const { etag, exists } = await stat(cfg, path);
      if (s.path !== path || !exists || !etag || etag === s.etag || s.saving) return;
      if (isDirty()) patch({ remoteChanged: true });
      else await open(path); // clean: just pick up the new version
    } catch {
      /* offline or transient; try again later */
    }
  }, [cfg, open, patch]);

  useEffect(() => {
    const onVisible = () => void checkRemote();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const poll = setInterval(onVisible, POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(poll);
    };
  }, [checkRemote]);

  // Save when the page is being hidden (switching apps on iPad); warn on unload.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && isDirty()) void save();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [save]);

  // Retry failed saves when the connection comes back.
  useEffect(() => {
    const onOnline = () => {
      if (docRef.current.status === 'error' && isDirty()) void save();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [save]);

  const close = useCallback(() => {
    r.current.path = null;
    patch({ path: null, status: 'idle', error: null, staleDraft: null, normalizes: null, remoteChanged: false });
  }, [patch]);

  return {
    doc,
    open,
    close,
    save,
    onEdit,
    onEditorReady,
    resolveConflict,
    discardStaleDraft,
    saveStaleDraftAsCopy,
  };
}

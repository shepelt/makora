import { useCallback, useEffect, useRef, useState } from 'react';
import type { DavConfig } from './dav';
import { Editor } from './Editor';
import type { EditorHandle } from './Editor';
import { FileBrowser } from './FileBrowser';
import { Settings } from './Settings';
import { lastFile, loadConfig, saveConfig } from './store';
import { useDocument } from './useDocument';
import type { DocState } from './useDocument';

function useIsNarrow() {
  const q = '(max-width: 820px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

function StatusPill({ doc, onRetry }: { doc: DocState; onRetry: () => void }) {
  const map: Record<string, [string, string]> = {
    loading: ['Opening…', 'text-stone-400'],
    clean: ['Saved', 'text-stone-400'],
    dirty: ['Edited', 'text-stone-500'],
    saving: ['Saving…', 'text-stone-500'],
    conflict: ['Conflict', 'text-amber-700'],
    error: ['Not saved', 'text-red-700'],
  };
  const entry = map[doc.status];
  if (!entry) return null;
  return (
    <span className={`flex items-center gap-1.5 text-xs ${entry[1]}`} data-testid="status" data-status={doc.status}>
      {(doc.status === 'dirty' || doc.status === 'saving') && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {entry[0]}
      {doc.status === 'error' && (
        <button className="underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </span>
  );
}

export function App() {
  const [cfg, setCfg] = useState<DavConfig | null>(() => loadConfig());
  const [showSettings, setShowSettings] = useState(() => !loadConfig());
  const [sidebar, setSidebar] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const narrow = useIsNarrow();
  const editorRef = useRef<EditorHandle>(null);
  const { doc, open, close, save, onEdit, onEditorReady, resolveConflict, discardStaleDraft, saveStaleDraftAsCopy } =
    useDocument(cfg, editorRef);

  // Restore the last open file.
  useEffect(() => {
    const last = lastFile.get();
    if (cfg && last) {
      void open(last);
      if (narrow) setSidebar(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  const openFile = useCallback(
    (path: string) => {
      lastFile.set(path);
      void open(path);
      if (narrow) setSidebar(false);
    },
    [open, narrow],
  );

  // Cmd/Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save({});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const title = doc.path ? doc.path.split('/').pop()!.replace(/\.(md|markdown|mdown)$/i, '') : '';

  return (
    <div className="flex h-[100dvh] flex-col bg-stone-50 text-stone-800">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-stone-200/80 px-2 pt-[env(safe-area-inset-top)]">
        <button
          className="rounded-md p-2 text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
          onClick={() => setSidebar((s) => !s)}
          aria-label="Toggle files"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h12M2 8h12M2 12h12" />
          </svg>
        </button>
        <div className="min-w-0 flex-1 truncate text-[15px] font-medium" title={doc.path ?? ''}>
          {title || <span className="text-stone-400">Makora</span>}
        </div>
        <StatusPill doc={doc} onRetry={() => void save({})} />
        {doc.path && (
          <button
            className="rounded-md px-2.5 py-1.5 text-sm text-stone-600 hover:bg-stone-200/60 disabled:opacity-40"
            onClick={() => void save({})}
            disabled={doc.status !== 'dirty' && doc.status !== 'error'}
          >
            Save
          </button>
        )}
        <button
          className="rounded-md p-2 text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
          onClick={() => setShowSettings(true)}
          aria-label="Settings"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
          </svg>
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {cfg && sidebar && (
          <>
            {narrow && <div className="absolute inset-0 z-20 bg-stone-900/10" onClick={() => setSidebar(false)} />}
            <aside
              className={`${
                narrow ? 'absolute inset-y-0 left-0 z-30 w-[85%] max-w-[320px] shadow-xl' : 'w-[272px] shrink-0'
              } border-r border-stone-200/80 bg-stone-100/95`}
            >
              <FileBrowser cfg={cfg} selected={doc.path} onOpen={openFile} refreshKey={refreshKey} />
            </aside>
          </>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto" id="editor-scroll">
          {doc.remoteChanged && (
            <Banner tone="amber">
              This file changed on the server while you were editing. Your next save will ask what to do.
            </Banner>
          )}
          {doc.staleDraft && (
            <Banner tone="amber">
              Unsaved edits from {new Date(doc.staleDraft.updatedAt).toLocaleString()} are based on an older version of this file.
              <button className="ml-2 underline" onClick={() => void saveStaleDraftAsCopy()}>
                Save them as a copy
              </button>
              <button className="ml-2 underline" onClick={() => void discardStaleDraft()}>
                Discard
              </button>
            </Banner>
          )}
          {doc.normalizes && doc.status === 'clean' && (
            <Banner tone="stone">
              Heads-up: saving this file will also reformat about {doc.normalizes.changedLines} line
              {doc.normalizes.changedLines === 1 ? '' : 's'} you didn't edit (markdown normalization). Untouched files are never
              rewritten.
            </Banner>
          )}
          {doc.status === 'error' && doc.error && <Banner tone="red">{doc.error}</Banner>}

          {doc.path && doc.status !== 'loading' ? (
            <div className="mx-auto w-full max-w-[760px] px-5 pb-[40vh] pt-6 sm:px-10">
              <Editor key={doc.editorKey} ref={editorRef} markdown={doc.initialMarkdown} onChange={onEdit} onReady={onEditorReady} />
            </div>
          ) : doc.status === 'loading' ? (
            <div className="flex h-full items-center justify-center text-sm text-stone-400">Opening…</div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-stone-400">
              {cfg ? 'Pick a file' : 'Connect a WebDAV server to start'}
            </div>
          )}
        </main>
      </div>

      {doc.status === 'conflict' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/25 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl ring-1 ring-stone-200" role="dialog" aria-label="Conflict">
            <h2 className="text-lg font-semibold">This file changed elsewhere</h2>
            <p className="text-sm text-stone-600">
              Someone (another device, Nextcloud, or an AI tool) saved a newer version since you opened it. Nothing has been overwritten.
            </p>
            <div className="flex flex-col gap-2">
              <button className="rounded-lg bg-stone-800 px-4 py-2 text-sm text-white" onClick={() => void resolveConflict('copy')}>
                Keep both: save mine as a copy, load theirs
              </button>
              <button className="rounded-lg px-4 py-2 text-sm ring-1 ring-stone-300 hover:bg-stone-50" onClick={() => void resolveConflict('reload')}>
                Discard mine, load theirs
              </button>
              <button className="rounded-lg px-4 py-2 text-sm text-red-700 ring-1 ring-red-200 hover:bg-red-50" onClick={() => void resolveConflict('overwrite')}>
                Overwrite theirs with mine
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <Settings
          initial={cfg}
          onSave={(c) => {
            saveConfig(c);
            setCfg(c);
            setShowSettings(false);
            setRefreshKey((k) => k + 1);
          }}
          onCancel={cfg ? () => setShowSettings(false) : undefined}
          onForget={() => {
            saveConfig(null);
            lastFile.set(null);
            close();
            setCfg(null);
          }}
        />
      )}
    </div>
  );
}

function Banner({ tone, children }: { tone: 'amber' | 'red' | 'stone'; children: React.ReactNode }) {
  const cls = {
    amber: 'bg-amber-50 text-amber-900 border-amber-200',
    red: 'bg-red-50 text-red-800 border-red-200',
    stone: 'bg-stone-100 text-stone-600 border-stone-200',
  }[tone];
  return <div className={`border-b px-4 py-2 text-sm ${cls}`}>{children}</div>;
}

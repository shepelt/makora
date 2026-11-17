// App shell. Layout and visuals ported from the Meteor version (main: App.jsx);
// document handling (safe saves, drafts, conflicts) is new (useDocument).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { sealCredentials, unsealCredentials } from './dav';
import type { DavConfig } from './dav';
import { Editor } from './Editor';
import type { EditorHandle } from './Editor';
import type { BlockInfo } from './blockCommands';
// @ts-expect-error untyped JSX module ported verbatim from main
import { EditorToolbar } from './EditorToolbar.jsx';
import { FileBrowser } from './FileBrowser';
// @ts-expect-error untyped JSX module ported verbatim from main
import { PullToRefresh } from './PullToRefresh.jsx';
import { Settings } from './Settings';
// @ts-expect-error untyped JSX module ported verbatim from main
import { SplitPanel, useIsMobile } from './SplitPanel.jsx';
import { lastFile, loadConfig, prefs, saveConfig } from './store';
import { useDocument } from './useDocument';

function UserMenu({ name, onOpenSettings, onDisconnect }: { name: string; onOpenSettings: () => void; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const initials = name
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/50" aria-label="Account menu">
        <div className="w-6 h-6 rounded-full bg-warm-gray/30 flex items-center justify-center text-xs text-charcoal">{initials}</div>
        <span className="text-sm text-charcoal hidden sm:inline">{name.split(/[\s@]/)[0]}</span>
        <svg className="w-4 h-4 text-warm-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-cream py-1 z-50">
          <div className="px-3 py-2 border-b border-cream">
            <p className="text-sm font-medium text-charcoal truncate">{name}</p>
            <p className="text-xs text-warm-gray truncate">WebDAV</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            className="w-full px-3 py-2 text-left text-sm text-charcoal hover:bg-cream/50"
          >
            Settings
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
            className="w-full px-3 py-2 text-left text-sm text-charcoal hover:bg-cream/50"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function WelcomeScreen() {
  const isMac = /Mac|iPad|iPhone/.test(navigator.platform) || /Mac/.test(navigator.userAgent);
  const mod = isMac ? '⌘' : 'Ctrl';
  const shortcuts = [
    { keys: `${mod} + S`, action: 'Save file' },
    { keys: `${mod} + 1-6`, action: 'Heading 1-6' },
    { keys: `${mod} + 0`, action: 'Paragraph' },
    { keys: `${mod} + Shift + Q`, action: 'Blockquote' },
    { keys: `${mod} + Shift + K`, action: 'Code block' },
    { keys: `${mod} + Shift + O`, action: 'Ordered list' },
    { keys: `${mod} + Shift + U`, action: 'Bullet list' },
    { keys: `${mod} + B`, action: 'Bold' },
    { keys: `${mod} + I`, action: 'Italic' },
  ];
  return (
    <div className="h-full flex items-center justify-center bg-gray-50">
      <div className="max-w-md text-center">
        <h2 className="text-2xl font-light text-gray-400 mb-8">Makora</h2>
        <div className="text-left bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">Keyboard Shortcuts</h3>
          <div className="space-y-2">
            {shortcuts.map(({ keys, action }) => (
              <div key={keys} className="flex justify-between text-sm">
                <span className="text-gray-600">{action}</span>
                <kbd className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-500">{keys}</kbd>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-6 text-sm text-gray-400">Select a markdown file from the sidebar to start editing</p>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'amber' | 'red' | 'gray'; children: ReactNode }) {
  const cls = {
    amber: 'bg-amber-50 text-amber-900 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
  }[tone];
  return <div className={`border-b px-4 py-2 text-sm ${cls}`}>{children}</div>;
}

function ConflictDialog({ onChoose }: { onChoose: (c: 'copy' | 'reload' | 'overwrite') => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-4 w-96 max-w-[90vw]" role="dialog" aria-label="Conflict">
        <h3 className="text-lg font-medium mb-2">This file changed elsewhere</h3>
        <p className="text-sm text-gray-600 mb-4">
          A newer version was saved since you opened it (another device, Nextcloud, or an AI tool). Nothing has been overwritten.
        </p>
        <div className="flex flex-col gap-2">
          <button onClick={() => onChoose('copy')} className="px-3 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded">
            Keep both: save mine as a copy, load theirs
          </button>
          <button onClick={() => onChoose('reload')} className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded">
            Discard mine, load theirs
          </button>
          <button onClick={() => onChoose('overwrite')} className="px-3 py-2 text-sm text-red-600 bg-gray-100 hover:bg-red-50 rounded">
            Overwrite theirs with mine
          </button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [cfg, setCfg] = useState<DavConfig | null>(() => loadConfig());
  const [showSettings, setShowSettings] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [blockInfo, setBlockInfo] = useState<BlockInfo>({ headingLevel: null, listType: null });
  const isMobile: boolean = useIsMobile();
  const editorRef = useRef<EditorHandle>(null);
  const { doc, open, close, save, onEdit, onEditorReady, resolveConflict, discardStaleDraft, saveStaleDraftAsCopy } = useDocument(cfg, editorRef);
  const basePath = cfg ? prefs.basePath(cfg) : '/';

  // Seal credentials for image requests (also after a server restart), then
  // restore the last open file so its images can load.
  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    void sealCredentials(cfg).then(() => {
      const last = lastFile.get();
      if (!cancelled && last && prefs.rememberLastFile()) void open(last);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  const openFile = useCallback(
    (path: string) => {
      lastFile.set(path);
      void open(path);
    },
    [open],
  );

  const closeFile = useCallback(async () => {
    await save({});
    lastFile.set(null);
    close();
  }, [save, close]);

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

  const disconnect = () => {
    void unsealCredentials();
    saveConfig(null);
    lastFile.set(null);
    close();
    setShowSettings(false);
    setCfg(null);
  };

  if (!cfg) {
    return (
      <Settings
        initial={null}
        isModal={false}
        onSaved={(c) => {
          saveConfig(c);
          setCfg(c);
        }}
      />
    );
  }

  const loading = doc.status === 'loading';
  const fileName = doc.path ? doc.path.split('/').pop() : '';

  return (
    <div className="h-dvh flex flex-col overflow-x-hidden">
      {/* Header */}
      <div className="bg-cream border-b border-cream px-2 sm:px-4 py-1 sm:py-2 flex items-center shrink-0 z-40 pt-[max(0.25rem,env(safe-area-inset-top))]">
        {isMobile && doc.path ? (
          <button onClick={() => void closeFile()} className="p-1 -ml-1 mr-2 text-charcoal hover:bg-gray-100 rounded" aria-label="Back to files">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <h1 className="font-serif text-xl font-light text-charcoal">Makora</h1>
        )}
        <span className="flex-1 text-center text-sm text-warm-gray overflow-hidden text-ellipsis whitespace-nowrap px-4" title={doc.path ?? ''}>
          {fileName}
        </span>
        <UserMenu name={cfg.username} onOpenSettings={() => setShowSettings(true)} onDisconnect={disconnect} />
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <SplitPanel
          showRightPane={!!doc.path}
          left={
            <FileBrowser
              cfg={cfg}
              basePath={basePath}
              selected={doc.path}
              loadingPath={loading ? doc.path : null}
              onOpen={openFile}
              refreshKey={refreshKey}
              onDeleted={(path, isDir) => {
                if (doc.path && (doc.path === path || (isDir && doc.path.startsWith(path + '/')))) {
                  lastFile.set(null);
                  close();
                }
              }}
              onRenamed={(from, to, isDir) => {
                if (!doc.path) return;
                if (doc.path === from) openFile(to);
                else if (isDir && doc.path.startsWith(from + '/')) openFile(to + doc.path.slice(from.length));
              }}
            />
          }
          right={
            <div className="h-full relative">
              {doc.path ? (
                <div className="h-full bg-white flex flex-col">
                  <EditorToolbar
                    editorRef={editorRef}
                    disabled={loading}
                    currentHeading={blockInfo.headingLevel}
                    currentList={blockInfo.listType}
                    saving={doc.status === 'saving'}
                    loading={loading}
                    isDirty={doc.status === 'dirty' || doc.status === 'error' || doc.status === 'conflict'}
                    onSave={() => void save({})}
                    onReload={() => doc.path && void open(doc.path)}
                    onClose={() => void closeFile()}
                  />
                  {doc.remoteChanged && <Banner tone="amber">This file changed on the server while you were editing. Your next save will ask what to do.</Banner>}
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
                  {doc.status === 'error' && doc.error && (
                    <Banner tone="red">
                      Not saved: {doc.error}
                      <button className="ml-2 underline" onClick={() => void save({})}>
                        Retry
                      </button>
                    </Banner>
                  )}
                  <PullToRefresh disabled={loading} onRefresh={() => doc.path && open(doc.path)}>
                    <div className="flex-1 overflow-auto relative h-full" id="editor-scroll">
                      <div
                        className={`absolute inset-0 bg-white z-30 flex items-center justify-center transition-opacity duration-150 ${
                          loading ? 'opacity-100' : 'opacity-0 pointer-events-none'
                        }`}
                      >
                        <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                      </div>
                      {!loading && (
                        <Editor
                          key={doc.editorKey}
                          ref={editorRef}
                          markdown={doc.initialMarkdown}
                          onChange={onEdit}
                          onReady={onEditorReady}
                          onBlockChange={setBlockInfo}
                          preventAutoFocus={isMobile}
                          docPath={doc.path}
                        />
                      )}
                    </div>
                  </PullToRefresh>
                </div>
              ) : (
                <WelcomeScreen />
              )}
              <span className="sr-only" data-testid="status" data-status={doc.status} />
            </div>
          }
        />
      </div>

      {isMobile && loading && (
        <div className="h-1 bg-gray-200 overflow-hidden shrink-0">
          <div className="h-full bg-blue-500 animate-progress-indeterminate" />
        </div>
      )}

      {doc.status === 'conflict' && <ConflictDialog onChoose={(c) => void resolveConflict(c)} />}

      {showSettings && (
        <Settings
          initial={cfg}
          isModal
          onClose={() => setShowSettings(false)}
          onDisconnect={disconnect}
          onSaved={(c) => {
            saveConfig(c);
            setCfg(c);
            setShowSettings(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

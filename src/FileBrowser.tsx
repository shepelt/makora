// File tree. Visuals ported from the Meteor version (main: FileBrowser.jsx);
// data loading is new: lazy per-folder PROPFIND, per-folder errors, missing
// remembered folders dropped silently.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDownIcon,
  ArrowPathIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  DocumentIcon,
  FolderIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { list, mkcol, move, remove, write } from './dav';
import type { DavConfig, DavEntry } from './dav';
import { openDirs } from './store';

const MD_FILE = /\.(md|markdown)$/i;
const visibleEntry = (e: DavEntry) => !e.name.startsWith('.') && (e.isDir || MD_FILE.test(e.name));

type SortOrder = 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc';
const SORT_KEY = 'makora:sortOrder';

const SORT_OPTIONS: Array<{ value: SortOrder; title: string }> = [
  { value: 'name-asc', title: 'Name A→Z' },
  { value: 'name-desc', title: 'Name Z→A' },
  { value: 'date-desc', title: 'Newest first' },
  { value: 'date-asc', title: 'Oldest first' },
];

function sortEntries(entries: DavEntry[], order: SortOrder): DavEntry[] {
  const [type, dir] = order.split('-');
  const sign = dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (type === 'date') return sign * (a.lastmod - b.lastmod);
    return sign * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';
const join = (dir: string, name: string) => (dir === '/' ? '' : dir) + '/' + name;

// --- dialogs (main: Modal / ConfirmDialog / InputDialog) -----------------------

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-4 w-80 max-w-[90vw]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h3 className="text-lg font-medium mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog(props: { title: string; message: string; onConfirm: () => void; onCancel: () => void; loading?: boolean }) {
  const { title, message, onConfirm, onCancel, loading } = props;
  return (
    <Modal title={title} onClose={loading ? () => {} : onCancel}>
      <p className="text-sm text-gray-600 mb-4">{message}</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50" disabled={loading}>
          Cancel
        </button>
        <button onClick={onConfirm} className="px-3 py-1.5 text-sm text-white rounded disabled:opacity-50 bg-red-500 hover:bg-red-600" disabled={loading}>
          {loading ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </Modal>
  );
}

function InputDialog(props: {
  title: string;
  initialValue?: string;
  placeholder: string;
  submitText: string;
  onSubmit: (value: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { title, initialValue = '', placeholder, submitText, onSubmit, onCancel } = props;
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return setError('Name cannot be empty');
    if (value.includes('/')) return setError('Name cannot contain "/"');
    setLoading(true);
    setError(null);
    try {
      await onSubmit(value.trim());
    } catch (err: any) {
      setError(err?.message || String(err));
      setLoading(false);
    }
  };
  return (
    <Modal title={title} onClose={onCancel}>
      <form onSubmit={submit}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          disabled={loading}
        />
        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded" disabled={loading}>
            Cancel
          </button>
          <button type="submit" className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50" disabled={loading || !value.trim()}>
            {loading ? 'Working...' : submitText}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ContextMenu(props: {
  x: number;
  y: number;
  item: DavEntry;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
}) {
  const { x, y, item, onClose, onRename, onDelete, onNewFile, onNewFolder } = props;
  useEffect(() => {
    const close = () => onClose();
    const id = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
    };
  }, [onClose]);
  const style = { left: Math.min(x, window.innerWidth - 160), top: Math.min(y, window.innerHeight - (item.isDir ? 170 : 90)) };
  const btn = 'w-full px-4 py-2 text-left text-sm hover:bg-gray-100';
  return (
    <div className="fixed bg-white border border-gray-200 rounded shadow-lg py-1 z-50 min-w-[140px]" style={style} role="menu">
      {item.isDir && (
        <>
          <button onClick={onNewFile} className={btn}>New file</button>
          <button onClick={onNewFolder} className={btn}>New folder</button>
          <div className="border-t border-gray-200 my-1" />
        </>
      )}
      <button onClick={onRename} className={btn}>Rename</button>
      <button onClick={onDelete} className={`${btn} text-red-600`}>Delete</button>
    </div>
  );
}

// --- sort dropdown (main: SortIcon / SortDropdown) -------------------------------

function SortIcon({ order }: { order: SortOrder }) {
  const [type, dir] = order.split('-');
  const Arrow = dir === 'asc' ? ArrowUpIcon : ArrowDownIcon;
  return type === 'name' ? (
    <span className="inline-flex items-center gap-0.5">
      <span className="text-[10px] font-semibold leading-none">Aa</span>
      <Arrow className="w-3 h-3" />
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5">
      <ClockIcon className="w-3.5 h-3.5" />
      <Arrow className="w-3 h-3" />
    </span>
  );
}

function SortDropdown({ value, onChange }: { value: SortOrder; onChange: (v: SortOrder) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded flex items-center" title="Sort order">
        <SortIcon order={value} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded shadow-lg border border-gray-200 py-1 z-50">
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-gray-100 ${value === o.value ? 'bg-gray-50' : ''}`}
              title={o.title}
            >
              <SortIcon order={o.value} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- tree ------------------------------------------------------------------------

type Props = {
  cfg: DavConfig;
  basePath: string;
  selected: string | null;
  loadingPath: string | null;
  onOpen: (path: string) => void;
  onDeleted: (path: string, isDir: boolean) => void;
  onRenamed: (from: string, to: string, isDir: boolean) => void;
  refreshKey: number;
};

export function FileBrowser({ cfg, basePath, selected, loadingPath, onOpen, onDeleted, onRenamed, refreshKey }: Props) {
  const root = basePath.replace(/\/+$/, '') || '/';
  const [children, setChildren] = useState<Record<string, DavEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      localStorage.removeItem('makora:openDirs'); // pre-per-server key
    } catch {
      /* ignore */
    }
    return new Set([root, ...openDirs.get(cfg)]);
  });
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortOrder>(() => {
    try {
      return (localStorage.getItem(SORT_KEY) as SortOrder) || 'name-asc';
    } catch {
      return 'name-asc';
    }
  });
  const [menu, setMenu] = useState<{ x: number; y: number; item: DavEntry } | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'new-file' | 'new-folder'; dir: string }
    | { kind: 'rename' | 'delete'; item: DavEntry }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  const persistOpen = useCallback((dirs: Set<string>) => openDirs.set(cfg, [...dirs].filter((d) => d !== root)), [cfg, root]);

  const forget = useCallback(
    (dir: string) => {
      setOpen((s) => {
        const n = new Set(s);
        n.delete(dir);
        persistOpen(n);
        return n;
      });
    },
    [persistOpen],
  );

  const load = useCallback(
    async (dir: string) => {
      setLoading((s) => new Set(s).add(dir));
      try {
        const entries = await list(cfg, dir);
        setChildren((c) => ({ ...c, [dir]: entries.filter(visibleEntry) }));
        setErrors(({ [dir]: _, ...rest }) => rest);
      } catch (err: any) {
        if (err?.status === 404 && dir !== root) forget(dir);
        else setErrors((e) => ({ ...e, [dir]: err?.message || String(err) }));
      } finally {
        setLoading((s) => {
          const n = new Set(s);
          n.delete(dir);
          return n;
        });
      }
    },
    [cfg, forget, root],
  );

  const reloadAll = useCallback(() => {
    setErrors({});
    setOpen((s) => {
      const n = new Set(s).add(root);
      for (const d of n) void load(d);
      return n;
    });
  }, [load, root]);

  useEffect(() => {
    setChildren({});
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, root, refreshKey]);

  // Background refresh of expanded folders, as on main.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') for (const d of open) void load(d);
    }, 60_000);
    return () => clearInterval(id);
  }, [open, load]);

  const toggle = (dir: string) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(dir)) n.delete(dir);
      else {
        n.add(dir);
        if (!children[dir]) void load(dir);
      }
      persistOpen(n);
      return n;
    });
  };

  const changeSort = (v: SortOrder) => {
    setSort(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* ignore */
    }
  };

  // Long-press opens the context menu on touch devices.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const touchHandlers = (item: DavEntry) => ({
    onTouchStart: (e: React.TouchEvent) => {
      longPressed.current = false;
      const t = e.touches[0];
      pressTimer.current = setTimeout(() => {
        longPressed.current = true;
        setMenu({ x: t.clientX, y: t.clientY, item });
      }, 550);
    },
    onTouchMove: () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    },
    onTouchEnd: () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    },
  });

  const renderItems = (dir: string, depth: number): ReactNode => {
    if (errors[dir]) {
      return (
        <div className="py-1 px-2 text-xs text-red-600" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
          {errors[dir]}{' '}
          <button className="underline" onClick={() => void load(dir)}>
            Retry
          </button>
        </div>
      );
    }
    const entries = children[dir];
    if (!entries) return null;
    if (entries.length === 0 && dir === root) return <div className="p-4 text-center text-gray-500">Empty</div>;
    return sortEntries(entries, sort).map((item) => {
      const isOpen = open.has(item.path);
      const isActive = selected === item.path;
      const isLoadingDir = item.isDir && loading.has(item.path);
      return (
        <div key={item.path}>
          <div
            onClick={() => {
              if (longPressed.current) return;
              if (item.isDir) toggle(item.path);
              else onOpen(item.path);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, item });
            }}
            {...touchHandlers(item)}
            title={item.name}
            className={`flex items-center gap-1.5 sm:gap-1 py-4 sm:py-1 px-2 cursor-pointer select-none border-b border-gray-100 sm:border-0 ${
              isActive ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 active:bg-gray-200'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px`, WebkitTouchCallout: 'none' }}
          >
            {item.isDir ? (
              <span className="w-4 text-xs text-gray-400 flex items-center justify-center">
                {isLoadingDir && !children[item.path] ? (
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                ) : isOpen ? (
                  <ChevronDownIcon className="w-3 h-3" />
                ) : (
                  <ChevronRightIcon className="w-3 h-3" />
                )}
              </span>
            ) : (
              <span className="w-4" />
            )}
            {item.isDir ? (
              <FolderIcon className={`w-5 h-5 sm:w-4 sm:h-4 ${isActive ? 'text-blue-600' : 'text-gray-500'}`} />
            ) : (
              <DocumentIcon className={`w-5 h-5 sm:w-4 sm:h-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
            )}
            <span className="flex-1 truncate text-base sm:text-sm">{item.name}</span>
            {!item.isDir && loadingPath === item.path && (
              <svg className="w-3 h-3 ml-1 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
          </div>
          {item.isDir && isOpen && renderItems(item.path, depth + 1)}
        </div>
      );
    });
  };

  const rootLoading = !children[root] && !errors[root];

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="p-2 border-b bg-white flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 flex-1 flex items-center gap-1 min-w-0">
          <FolderIcon className="w-4 h-4 text-gray-500 shrink-0" />
          <span className="truncate">{root === '/' ? 'Root' : root.split('/').pop()}</span>
        </span>
        <button onClick={() => setDialog({ kind: 'new-file', dir: root })} className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded" title="New file">
          <PlusIcon className="w-4 h-4" />
        </button>
        <SortDropdown value={sort} onChange={changeSort} />
        <button onClick={reloadAll} className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded" title="Refresh">
          <ArrowPathIcon className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-auto" aria-label="Files">
        {rootLoading && (
          <div className="p-4 flex items-center justify-center gap-2 text-gray-500">
            <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        )}
        {renderItems(root, 0)}
      </nav>

      {menu && (
        <ContextMenu
          {...menu}
          onClose={() => setMenu(null)}
          onRename={() => {
            setDialog({ kind: 'rename', item: menu.item });
            setMenu(null);
          }}
          onDelete={() => {
            setDialog({ kind: 'delete', item: menu.item });
            setMenu(null);
          }}
          onNewFile={() => {
            setDialog({ kind: 'new-file', dir: menu.item.path });
            setMenu(null);
          }}
          onNewFolder={() => {
            setDialog({ kind: 'new-folder', dir: menu.item.path });
            setMenu(null);
          }}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${dialog.item.isDir ? 'folder' : 'file'}?`}
          message={
            dialog.item.isDir
              ? `Are you sure you want to delete "${dialog.item.name}" and all its contents?`
              : `Are you sure you want to delete "${dialog.item.name}"?`
          }
          loading={deleting}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await remove(cfg, dialog.item.path);
              onDeleted(dialog.item.path, dialog.item.isDir);
              await load(parentOf(dialog.item.path));
              setDialog(null);
            } catch (err: any) {
              alert(err?.message || String(err));
            } finally {
              setDeleting(false);
            }
          }}
        />
      )}

      {dialog?.kind === 'rename' && (
        <InputDialog
          title={`Rename ${dialog.item.isDir ? 'folder' : 'file'}`}
          initialValue={dialog.item.name}
          placeholder="New name"
          submitText="Rename"
          onCancel={() => setDialog(null)}
          onSubmit={async (name) => {
            const to = join(parentOf(dialog.item.path), name);
            if (to === dialog.item.path) return setDialog(null);
            await move(cfg, dialog.item.path, to);
            onRenamed(dialog.item.path, to, dialog.item.isDir);
            await load(parentOf(dialog.item.path));
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === 'new-file' && (
        <InputDialog
          title="New file"
          placeholder="filename.md"
          submitText="Create"
          onCancel={() => setDialog(null)}
          onSubmit={async (name) => {
            const fileName = MD_FILE.test(name) ? name : `${name}.md`;
            const path = join(dialog.dir, fileName);
            try {
              await write(cfg, path, '', null);
            } catch (err: any) {
              throw new Error(err?.status === 412 ? 'A file with that name already exists' : err?.message || String(err));
            }
            setOpen((s) => {
              const n = new Set(s).add(dialog.dir);
              persistOpen(n);
              return n;
            });
            await load(dialog.dir);
            setDialog(null);
            onOpen(path);
          }}
        />
      )}

      {dialog?.kind === 'new-folder' && (
        <InputDialog
          title="New folder"
          placeholder="Folder name"
          submitText="Create"
          onCancel={() => setDialog(null)}
          onSubmit={async (name) => {
            await mkcol(cfg, join(dialog.dir, name));
            setOpen((s) => {
              const n = new Set(s).add(dialog.dir);
              persistOpen(n);
              return n;
            });
            await load(dialog.dir);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

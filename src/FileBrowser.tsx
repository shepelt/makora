import { useCallback, useEffect, useState } from 'react';
import { list, write } from './dav';
import type { DavConfig, DavEntry } from './dav';
import { openDirs } from './store';

const TEXT_FILE = /\.(md|markdown|mdown|txt)$/i;
const visibleEntry = (e: DavEntry) => !e.name.startsWith('.') && (e.isDir || TEXT_FILE.test(e.name));

type Sort = 'name' | 'recent';

type Props = {
  cfg: DavConfig;
  selected: string | null;
  onOpen: (path: string) => void;
  refreshKey: number;
};

function sortEntries(entries: DavEntry[], sort: Sort): DavEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (sort === 'recent') return b.lastmod - a.lastmod;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function FileBrowser({ cfg, selected, onOpen, refreshKey }: Props) {
  const [children, setChildren] = useState<Record<string, DavEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      localStorage.removeItem('makora:openDirs'); // pre-per-server key
    } catch {
      /* ignore */
    }
    return new Set(['/', ...openDirs.get(cfg)]);
  });
  const [loading, setLoading] = useState<Set<string>>(new Set());
  // Errors are per folder, shown under the folder they belong to.
  const [errors, setErrors] = useState<Record<string, string>>({});

  const forget = useCallback(
    (dir: string) => {
      setOpen((s) => {
        const n = new Set(s);
        n.delete(dir);
        openDirs.set(cfg, [...n].filter((d) => d !== '/'));
        return n;
      });
    },
    [cfg],
  );
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('makora:sort') as Sort) || 'name');

  const load = useCallback(
    async (dir: string) => {
      setLoading((s) => new Set(s).add(dir));
      try {
        const entries = await list(cfg, dir);
        setChildren((c) => ({ ...c, [dir]: entries.filter(visibleEntry) }));
        setErrors(({ [dir]: _, ...rest }) => rest);
      } catch (err: any) {
        if (err?.status === 404 && dir !== '/') {
          // A remembered folder that no longer exists: forget it quietly.
          forget(dir);
        } else {
          setErrors((e) => ({ ...e, [dir]: err?.message || String(err) }));
        }
      } finally {
        setLoading((s) => {
          const n = new Set(s);
          n.delete(dir);
          return n;
        });
      }
    },
    [cfg, forget],
  );

  useEffect(() => {
    setChildren({});
    setErrors({});
    for (const dir of open) void load(dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, refreshKey]);

  const toggle = (dir: string) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(dir)) n.delete(dir);
      else {
        n.add(dir);
        if (!children[dir]) void load(dir);
      }
      openDirs.set(cfg, [...n].filter((d) => d !== '/'));
      return n;
    });
  };

  const changeSort = (s: Sort) => {
    setSort(s);
    try {
      localStorage.setItem('makora:sort', s);
    } catch {
      /* ignore */
    }
  };

  const newFile = async (dir: string) => {
    const name = prompt('New file name', 'Untitled.md');
    if (!name) return;
    const fileName = TEXT_FILE.test(name) ? name : `${name}.md`;
    if (fileName.includes('/')) return alert('Name cannot contain "/"');
    const path = (dir === '/' ? '' : dir) + '/' + fileName;
    try {
      await write(cfg, path, '', null);
      await load(dir);
      onOpen(path);
    } catch (err: any) {
      alert(err?.status === 412 ? 'A file with that name already exists.' : err?.message || String(err));
    }
  };

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const entries = children[dir];
    if (errors[dir]) {
      return (
        <div className="px-3 py-1 text-xs text-red-700" style={{ paddingLeft: 12 + depth * 14 }}>
          {errors[dir]}{' '}
          <button className="underline" onClick={() => void load(dir)}>
            Retry
          </button>
        </div>
      );
    }
    if (!entries) {
      return loading.has(dir) ? <div className="px-3 py-1 text-xs text-stone-400" style={{ paddingLeft: 12 + depth * 14 }}>Loading…</div> : null;
    }
    if (entries.length === 0) {
      return <div className="px-3 py-1 text-xs text-stone-400" style={{ paddingLeft: 12 + depth * 14 }}>Empty</div>;
    }
    return sortEntries(entries, sort).map((e) => (
      <div key={e.path}>
        <button
          className={`group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[14px] leading-tight ${
            selected === e.path ? 'bg-stone-200/80 text-stone-900' : 'text-stone-600 hover:bg-stone-200/50'
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (e.isDir ? toggle(e.path) : onOpen(e.path))}
          title={e.name}
        >
          {e.isDir ? (
            <svg className={`h-3 w-3 shrink-0 text-stone-400 transition-transform ${open.has(e.path) ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="currentColor">
              <path d="M4 2l5 4-5 4z" />
            </svg>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className={`truncate ${e.isDir ? 'font-medium text-stone-700' : ''}`}>{e.isDir ? e.name : e.name.replace(/\.(md|markdown|mdown)$/i, '')}</span>
          {e.isDir && (
            <span
              role="button"
              aria-label={`New file in ${e.name}`}
              className="ml-auto hidden rounded px-1 text-stone-400 hover:text-stone-700 group-hover:inline"
              onClick={(ev) => {
                ev.stopPropagation();
                void newFile(e.path);
              }}
            >
              +
            </span>
          )}
        </button>
        {e.isDir && open.has(e.path) && renderDir(e.path, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3 text-xs text-stone-500">
        <button className={sort === 'name' ? 'text-stone-800' : 'hover:text-stone-700'} onClick={() => changeSort('name')}>
          Name
        </button>
        <button className={sort === 'recent' ? 'text-stone-800' : 'hover:text-stone-700'} onClick={() => changeSort('recent')}>
          Recent
        </button>
        <span className="ml-auto" />
        <button className="hover:text-stone-800" onClick={() => void newFile('/')} title="New file">
          New
        </button>
        <button className="hover:text-stone-800" onClick={() => {
            setChildren({});
            for (const d of open) void load(d);
          }} title="Refresh">
          Refresh
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-6" aria-label="Files">
        {renderDir('/', 0)}
      </nav>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';

function ContextMenu({ x, y, onClose, onOpenNewTab }) {
  // Close menu when clicking outside
  useEffect(() => {
    const handleClick = () => onClose();
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [onClose]);

  return (
    <div
      className="fixed bg-white border border-gray-200 rounded shadow-lg py-1 z-50"
      style={{ left: x, top: y }}
    >
      <button
        onClick={onOpenNewTab}
        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
      >
        Open in new tab
      </button>
    </div>
  );
}

function TreeItem({ item, depth, onFileSelect, expandedPaths, toggleExpand, loadChildren, children: childItems, onContextMenu }) {
  const isExpanded = expandedPaths.has(item.filename);
  const isDirectory = item.type === 'directory';
  const isLoading = expandedPaths.get(item.filename) === 'loading';

  const handleClick = () => {
    if (isDirectory) {
      toggleExpand(item.filename);
    } else {
      onFileSelect?.(item);
    }
  };

  const handleContextMenu = (e) => {
    if (isDirectory) {
      e.preventDefault();
      onContextMenu?.(e, item);
    }
  };

  return (
    <>
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className="flex items-center gap-1 py-1 px-2 hover:bg-gray-100 cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDirectory ? (
          <span className="w-4 text-xs text-gray-400 flex items-center justify-center">
            {isLoading ? (
              <span className="flex gap-0.5">
                <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            ) : isExpanded ? '▼' : '▶'}
          </span>
        ) : (
          <span className="w-4" />
        )}
        <span className="text-sm">
          {isDirectory ? '📁' : '📄'}
        </span>
        <span className="flex-1 truncate text-sm">{item.basename}</span>
      </div>
      {isExpanded && childItems && childItems.map((child) => (
        <TreeItem
          key={child.filename}
          item={child}
          depth={depth + 1}
          onFileSelect={onFileSelect}
          expandedPaths={expandedPaths}
          toggleExpand={toggleExpand}
          loadChildren={loadChildren}
          children={child.children}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'date-desc', label: 'Date (Newest)' },
  { value: 'date-asc', label: 'Date (Oldest)' },
];

function SortDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const current = SORT_OPTIONS.find(o => o.value === value) || SORT_OPTIONS[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded flex items-center gap-1"
        title="Sort order"
      >
        <span>↕</span>
        <span className="hidden sm:inline">{current.label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded shadow-lg border border-gray-200 py-1 z-50">
          {SORT_OPTIONS.map(option => (
            <button
              key={option.value}
              onClick={() => { onChange(option.value); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-100 ${value === option.value ? 'bg-gray-50 font-medium' : ''}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FileBrowser({ onFileSelect, basePath = '/' }) {
  const [rootItems, setRootItems] = useState([]);
  const [expandedPaths, setExpandedPaths] = useState(new Map());
  const [childrenCache, setChildrenCache] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [sortOrder, setSortOrder] = useState(() => {
    return localStorage.getItem('fileBrowserSort') || 'name-asc';
  });

  // Normalize basePath
  const normalizedBasePath = basePath.startsWith('/') ? basePath : `/${basePath}`;

  // Save sort preference
  const handleSortChange = (value) => {
    setSortOrder(value);
    localStorage.setItem('fileBrowserSort', value);
  };

  // Sort function
  const sortItems = useCallback((items) => {
    const [field, direction] = sortOrder.split('-');
    const sorted = [...items].sort((a, b) => {
      // Folders always first
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }

      let cmp = 0;
      if (field === 'name') {
        cmp = a.basename.localeCompare(b.basename);
      } else if (field === 'date') {
        const dateA = a.lastmod ? new Date(a.lastmod).getTime() : 0;
        const dateB = b.lastmod ? new Date(b.lastmod).getTime() : 0;
        cmp = dateA - dateB;
      }

      return direction === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [sortOrder]);

  // Load root directory on mount or when basePath changes
  useEffect(() => {
    setRootItems([]);
    setExpandedPaths(new Map());
    setChildrenCache(new Map());
    loadDirectory(normalizedBasePath);
  }, [normalizedBasePath]);

  const loadDirectory = async (dirPath) => {
    const isRoot = dirPath === normalizedBasePath;
    if (isRoot) {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await Meteor.callAsync('webdav.list', dirPath);
      // Filter out hidden files
      const filtered = result.filter(item => !item.basename.startsWith('.'));

      if (isRoot) {
        setRootItems(filtered);
      } else {
        setChildrenCache(prev => new Map(prev).set(dirPath, filtered));
      }

      return filtered;
    } catch (err) {
      setError(err.reason || err.message);
      return [];
    } finally {
      if (isRoot) {
        setLoading(false);
      }
    }
  };

  const toggleExpand = useCallback(async (path) => {
    setExpandedPaths(prev => {
      const next = new Map(prev);
      if (next.has(path) && next.get(path) !== 'loading') {
        // Collapse
        next.delete(path);
      } else if (!next.has(path)) {
        // Expand - mark as loading
        next.set(path, 'loading');
      }
      return next;
    });

    // If expanding and not cached, load children
    if (!expandedPaths.has(path) && !childrenCache.has(path)) {
      await loadDirectory(path);
    }

    // Mark as expanded (not loading)
    setExpandedPaths(prev => {
      const next = new Map(prev);
      if (next.get(path) === 'loading') {
        next.set(path, true);
      }
      return next;
    });
  }, [expandedPaths, childrenCache]);

  const refresh = () => {
    setChildrenCache(new Map());
    setExpandedPaths(new Map());
    loadDirectory(normalizedBasePath);
  };

  const handleContextMenu = (e, item) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      item
    });
  };

  const handleOpenNewTab = () => {
    if (contextMenu?.item) {
      window.open(`?path=${encodeURIComponent(contextMenu.item.filename)}`, '_blank');
    }
    setContextMenu(null);
  };

  // Build tree with children (sorted)
  const getItemWithChildren = (item) => {
    if (item.type === 'directory' && childrenCache.has(item.filename)) {
      return {
        ...item,
        children: sortItems(childrenCache.get(item.filename)).map(getItemWithChildren)
      };
    }
    return item;
  };

  const treeItems = sortItems(rootItems).map(getItemWithChildren);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="p-2 border-b bg-white flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 flex-1 flex items-center gap-1">
          <span>📁</span>
          <span className="truncate">{normalizedBasePath === '/' ? 'Root' : normalizedBasePath.split('/').pop()}</span>
        </span>
        <SortDropdown value={sortOrder} onChange={handleSortChange} />
        <button
          onClick={refresh}
          className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="p-4 flex items-center justify-center gap-2 text-gray-500">
            <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        )}
        {error && (
          <div className="p-4 text-center text-red-500">{error}</div>
        )}
        {!loading && !error && rootItems.length === 0 && (
          <div className="p-4 text-center text-gray-500">Empty</div>
        )}
        {!loading && !error && treeItems.map((item) => (
          <TreeItem
            key={item.filename}
            item={item}
            depth={0}
            onFileSelect={onFileSelect}
            expandedPaths={expandedPaths}
            toggleExpand={toggleExpand}
            loadChildren={loadDirectory}
            children={item.children}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onOpenNewTab={handleOpenNewTab}
        />
      )}
    </div>
  );
}

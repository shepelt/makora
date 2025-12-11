import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { FolderIcon, DocumentIcon, PlusIcon, ChevronDownIcon, ChevronRightIcon, ArrowsUpDownIcon, ArrowPathIcon, ArrowUpIcon, ArrowDownIcon, ClockIcon } from '@heroicons/react/24/outline';
import { FileItems } from '../api/collections';

// Cache helpers for localStorage persistence
const CACHE_KEY = 'fileBrowserCache';
const CACHE_VERSION = 1;
const BACKGROUND_REFRESH_INTERVAL = 60000; // 60 seconds

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== CACHE_VERSION) return null;
    return data.items || [];
  } catch {
    return null;
  }
}

function saveCache(items) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      version: CACHE_VERSION,
      items,
      timestamp: Date.now(),
    }));
  } catch {
    // localStorage might be full or disabled
  }
}

// Modal dialog component
function Modal({ title, children, onClose }) {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl p-4 w-80 max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

// Confirmation dialog
function ConfirmDialog({ title, message, onConfirm, onCancel, confirmText = 'Delete', danger = false, loading = false }) {
  return (
    <Modal title={title} onClose={loading ? () => {} : onCancel}>
      <p className="text-sm text-gray-600 mb-4">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50"
          disabled={loading}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`px-3 py-1.5 text-sm text-white rounded disabled:opacity-50 ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'}`}
          disabled={loading}
        >
          {loading ? 'Deleting...' : confirmText}
        </button>
      </div>
    </Modal>
  );
}

// Input dialog for rename/new file
function InputDialog({ title, initialValue = '', placeholder, onSubmit, onCancel, submitText = 'Create' }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!value.trim()) {
      setError('Name cannot be empty');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onSubmit(value.trim());
    } catch (err) {
      setError(err.reason || err.message);
      setLoading(false);
    }
  };

  return (
    <Modal title={title} onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
          disabled={loading}
        />
        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50"
            disabled={loading || !value.trim()}
          >
            {loading ? 'Working...' : submitText}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ContextMenu({ x, y, item, onClose, onOpenNewTab, onRename, onDelete, onNewFile, onNewFolder }) {
  const isDirectory = item?.type === 'directory';

  // Close menu when clicking outside
  useEffect(() => {
    const handleClick = () => onClose();
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [onClose]);

  // Adjust position if menu would go off screen
  const menuStyle = {
    left: Math.min(x, window.innerWidth - 160),
    top: Math.min(y, window.innerHeight - (isDirectory ? 200 : 120)),
  };

  return (
    <div
      className="fixed bg-white border border-gray-200 rounded shadow-lg py-1 z-50 min-w-[140px]"
      style={menuStyle}
    >
      {isDirectory && (
        <>
          <button
            onClick={onOpenNewTab}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
          >
            Open in new tab
          </button>
          <button
            onClick={onNewFile}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
          >
            New file
          </button>
          <button
            onClick={onNewFolder}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
          >
            New folder
          </button>
          <div className="border-t border-gray-200 my-1" />
        </>
      )}
      <button
        onClick={onRename}
        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
      >
        Rename
      </button>
      <button
        onClick={onDelete}
        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 text-red-600"
      >
        Delete
      </button>
    </div>
  );
}

function TreeItem({ item, depth, onFileSelect, expandedPaths, toggleExpand, onContextMenu, currentFilePath, loadingFilePath, children: childItems }) {
  const isExpanded = expandedPaths.has(item.filename);
  const isDirectory = item.type === 'directory';
  const isLoading = expandedPaths.get(item.filename) === 'loading';
  const isActive = currentFilePath === item.filename;
  const isFileLoading = !isDirectory && loadingFilePath === item.filename;

  const handleClick = () => {
    if (isDirectory) {
      toggleExpand(item.filename);
    } else {
      onFileSelect?.(item);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    onContextMenu?.(e, item);
  };

  return (
    <>
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`flex items-center gap-1.5 sm:gap-1 py-4 sm:py-1 px-2 cursor-pointer border-b border-gray-100 sm:border-0 ${isActive ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 active:bg-gray-200'}`}
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
            ) : isExpanded ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
          </span>
        ) : (
          <span className="w-4" />
        )}
        {isDirectory ? (
          <FolderIcon className={`w-5 h-5 sm:w-4 sm:h-4 ${isActive ? 'text-blue-600' : 'text-gray-500'}`} />
        ) : (
          <DocumentIcon className={`w-5 h-5 sm:w-4 sm:h-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
        )}
        <span className="flex-1 truncate text-base sm:text-sm">{item.basename}</span>
        {isFileLoading && (
          <svg className="w-3 h-3 ml-1 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
      </div>
      {isExpanded && childItems && childItems.map((child) => (
        <TreeItem
          key={child.filename}
          item={child}
          depth={depth + 1}
          onFileSelect={onFileSelect}
          expandedPaths={expandedPaths}
          toggleExpand={toggleExpand}
          children={child.children}
          onContextMenu={onContextMenu}
          currentFilePath={currentFilePath}
          loadingFilePath={loadingFilePath}
        />
      ))}
    </>
  );
}

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A-Z)', title: 'Name A→Z' },
  { value: 'name-desc', label: 'Name (Z-A)', title: 'Name Z→A' },
  { value: 'date-desc', label: 'Date (Newest)', title: 'Newest first' },
  { value: 'date-asc', label: 'Date (Oldest)', title: 'Oldest first' },
];

// Compact icon for sort option
function SortIcon({ type, direction }) {
  const isAsc = direction === 'asc';
  const Arrow = isAsc ? ArrowUpIcon : ArrowDownIcon;

  if (type === 'name') {
    return (
      <span className="inline-flex items-center gap-0.5">
        <span className="text-[10px] font-semibold leading-none">Aa</span>
        <Arrow className="w-3 h-3" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      <ClockIcon className="w-3.5 h-3.5" />
      <Arrow className="w-3 h-3" />
    </span>
  );
}

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

  const [currentType, currentDir] = value.split('-');
  const current = SORT_OPTIONS.find(o => o.value === value) || SORT_OPTIONS[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded flex items-center"
        title="Sort order"
      >
        <SortIcon type={currentType} direction={currentDir} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded shadow-lg border border-gray-200 py-1 z-50">
          {SORT_OPTIONS.map(option => {
            const [type, dir] = option.value.split('-');
            return (
              <button
                key={option.value}
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-gray-100 ${value === option.value ? 'bg-gray-50' : ''}`}
                title={option.title}
              >
                <SortIcon type={type} direction={dir} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Helper to get parent directory of a path
function getParentDir(filePath) {
  const parts = filePath.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

// Build sort object for Meteor collection query
function getSortObject(sortOrder) {
  const [field, direction] = sortOrder.split('-');
  const dir = direction === 'desc' ? -1 : 1;

  // Always sort directories first (type: 1 puts 'directory' before 'file')
  if (field === 'name') {
    return { type: 1, basename: dir };
  } else {
    return { type: 1, lastmod: dir };
  }
}

const EXPANDED_PATHS_KEY = 'fileBrowserExpanded';

function loadExpandedPaths() {
  try {
    const saved = localStorage.getItem(EXPANDED_PATHS_KEY);
    if (saved) {
      const arr = JSON.parse(saved);
      return new Map(arr.map(path => [path, true]));
    }
  } catch {}
  return new Map();
}

function saveExpandedPaths(paths) {
  try {
    // Only save paths that are truly expanded (not 'loading')
    const arr = [...paths.entries()]
      .filter(([, value]) => value === true)
      .map(([path]) => path);
    localStorage.setItem(EXPANDED_PATHS_KEY, JSON.stringify(arr));
  } catch {}
}

export function FileBrowser({ onFileSelect, basePath = '/', currentFilePath, onFileDelete, loadingFilePath }) {
  const [expandedPaths, setExpandedPaths] = useState(() => loadExpandedPaths());
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [error, setError] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [sortOrder, setSortOrder] = useState(() => {
    return localStorage.getItem('fileBrowserSort') || 'name-asc';
  });

  // Save expanded paths to localStorage when they change
  useEffect(() => {
    saveExpandedPaths(expandedPaths);
  }, [expandedPaths]);

  // Dialog states
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [renameDialog, setRenameDialog] = useState(null);
  const [newFileDialog, setNewFileDialog] = useState(null);
  const [newFolderDialog, setNewFolderDialog] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Normalize basePath
  const normalizedBasePath = basePath.startsWith('/') ? basePath : `/${basePath}`;

  // Compute sort object for queries
  const sortObject = useMemo(() => getSortObject(sortOrder), [sortOrder]);

  // Save sort preference
  const handleSortChange = (value) => {
    setSortOrder(value);
    localStorage.setItem('fileBrowserSort', value);
  };

  // Use reactive query for root items
  const rootItems = useTracker(() => {
    return FileItems.find(
      { parent: normalizedBasePath },
      { sort: sortObject }
    ).fetch();
  }, [normalizedBasePath, sortObject]);

  // Load directory from server and populate collection
  // If isBackground is true, don't show loading spinner or error states
  const loadDirectory = useCallback(async (dirPath, isBackground = false) => {
    const isRoot = dirPath === normalizedBasePath;
    if (isRoot && !isBackground) {
      // Only show loading if we have no cached data
      const hasCachedData = FileItems.find({ parent: normalizedBasePath }).count() > 0;
      if (!hasCachedData) {
        setLoading(true);
      }
    }
    if (!isBackground) {
      setError(null);
    }

    try {
      const result = await Meteor.callAsync('webdav.list', dirPath);
      // Filter out hidden files and non-markdown files (keep directories)
      const filtered = result.filter(item => {
        if (item.basename.startsWith('.')) return false;
        if (item.type === 'directory') return true;
        return item.basename.endsWith('.md');
      });

      // Upsert items into collection
      filtered.forEach(item => {
        // Convert lastmod to Date object for proper sorting
        // WebDAV returns RFC 2822 format: "Sat, 30 Nov 2024 10:30:00 GMT"
        const lastmodDate = item.lastmod ? new Date(item.lastmod) : null;
        FileItems.upsert(
          { filename: item.filename },
          {
            $set: {
              filename: item.filename,
              basename: item.basename,
              type: item.type,
              lastmod: lastmodDate,
              parent: dirPath,
            }
          }
        );
      });

      // Remove items that no longer exist on server
      const serverFilenames = new Set(filtered.map(item => item.filename));
      FileItems.find({ parent: dirPath }).forEach(item => {
        if (!serverFilenames.has(item.filename)) {
          FileItems.remove({ filename: item.filename });
        }
      });

      // Mark directory as loaded
      if (dirPath !== normalizedBasePath) {
        FileItems.update(
          { filename: dirPath },
          { $set: { loaded: true } }
        );
      }

      // Save entire collection to cache after successful fetch
      saveCache(FileItems.find().fetch());

      return filtered;
    } catch (err) {
      if (!isBackground) {
        setError(err.reason || err.message);
      }
      return [];
    } finally {
      if (isRoot && !isBackground) {
        setLoading(false);
        setInitialLoadComplete(true);
      }
    }
  }, [normalizedBasePath]);

  // Load root directory on mount or when basePath changes
  useEffect(() => {
    // Clear collection and expanded paths when basePath changes
    FileItems.remove({});
    setExpandedPaths(new Map());
    setInitialLoadComplete(false);

    // Load from cache first for instant UI
    const cached = loadCache();
    if (cached && cached.length > 0) {
      // Filter cache to only include items for current basePath
      const relevantItems = cached.filter(item =>
        item.parent === normalizedBasePath ||
        item.parent?.startsWith(normalizedBasePath + '/') ||
        item.filename?.startsWith(normalizedBasePath)
      );
      relevantItems.forEach(item => {
        // Remove _id and restore Date objects from cached strings
        const { _id, ...rest } = item;
        FileItems.insert({
          ...rest,
          lastmod: item.lastmod ? new Date(item.lastmod) : null,
        });
      });
      // Don't show loading spinner since we have cached data
      setLoading(false);
    }

    // Fetch fresh data (will update cache when done)
    loadDirectory(normalizedBasePath);
  }, [normalizedBasePath, loadDirectory]);

  // Periodic background refresh
  useEffect(() => {
    const refreshExpanded = () => {
      // Refresh root directory
      loadDirectory(normalizedBasePath, true);
      // Refresh all expanded directories
      expandedPaths.forEach((value, path) => {
        if (value === true) { // Only if fully loaded, not 'loading'
          loadDirectory(path, true);
        }
      });
    };

    const interval = setInterval(refreshExpanded, BACKGROUND_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [normalizedBasePath, expandedPaths, loadDirectory]);

  const toggleExpand = useCallback(async (path) => {
    const wasExpanded = expandedPaths.has(path) && expandedPaths.get(path) !== 'loading';

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

    // If expanding, always refresh directory contents
    if (!wasExpanded) {
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
  }, [expandedPaths, loadDirectory]);

  const refresh = useCallback(() => {
    FileItems.remove({});
    setExpandedPaths(new Map());
    loadDirectory(normalizedBasePath);
  }, [normalizedBasePath, loadDirectory]);

  // Track if we've done the initial auto-expand for the current file
  const [autoExpandedForFile, setAutoExpandedForFile] = useState(null);

  // Auto-expand folders to reveal the currently active file (only on initial load)
  useEffect(() => {
    if (!currentFilePath || !currentFilePath.startsWith(normalizedBasePath)) return;

    // Only auto-expand once per file path (not on every render)
    if (autoExpandedForFile === currentFilePath) return;

    // Get all ancestor directories between basePath and the file
    const relativePath = currentFilePath.slice(normalizedBasePath.length);
    const parts = relativePath.split('/').filter(Boolean);
    parts.pop(); // Remove the filename itself

    if (parts.length === 0) {
      setAutoExpandedForFile(currentFilePath);
      return; // File is in root, no folders to expand
    }

    // Build list of ancestor paths to expand
    const ancestorPaths = [];
    let currentPath = normalizedBasePath === '/' ? '' : normalizedBasePath;
    for (const part of parts) {
      currentPath = currentPath + '/' + part;
      ancestorPaths.push(currentPath);
    }

    // Expand each ancestor sequentially (need to load children)
    const expandAncestors = async () => {
      for (const ancestorPath of ancestorPaths) {
        // Load children if not loaded
        const item = FileItems.findOne({ filename: ancestorPath });
        if (!item || !item.loaded) {
          await loadDirectory(ancestorPath);
        }

        // Mark as expanded (preserve loading state if currently loading)
        setExpandedPaths(prev => {
          const next = new Map(prev);
          if (prev.get(ancestorPath) !== 'loading') {
            next.set(ancestorPath, true);
          }
          return next;
        });
      }
      setAutoExpandedForFile(currentFilePath);
    };

    expandAncestors();
  }, [currentFilePath, normalizedBasePath, autoExpandedForFile, loadDirectory]);

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

  const handleDelete = async () => {
    const item = deleteDialog;
    if (!item || deleting) return;

    setDeleting(true);
    try {
      await Meteor.callAsync('webdav.delete', item.filename);
      setDeleteDialog(null);

      // Remove from collection
      FileItems.remove({ filename: item.filename });
      // Also remove children if it's a directory
      if (item.type === 'directory') {
        FileItems.remove({ parent: { $regex: `^${item.filename}` } });
      }

      // Notify parent that file was deleted
      if (onFileDelete) {
        onFileDelete(item.filename, item.type);
      }
    } catch (err) {
      alert(`Failed to delete: ${err.reason || err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleRename = async (newName) => {
    const item = renameDialog;
    if (!item) return;

    // Get parent directory
    const parentDir = getParentDir(item.filename);
    const newPath = `${parentDir}/${newName}`;

    await Meteor.callAsync('webdav.move', item.filename, newPath);
    setRenameDialog(null);

    // Update in collection
    FileItems.update(
      { filename: item.filename },
      {
        $set: {
          filename: newPath,
          basename: newName,
          lastmod: new Date()
        }
      }
    );
  };

  const handleNewFile = async (name) => {
    const parentDir = newFileDialog;
    if (parentDir === null) return;

    // Ensure .md extension
    const filename = name.endsWith('.md') ? name : `${name}.md`;
    const newPath = `${parentDir}/${filename}`;

    await Meteor.callAsync('webdav.createFile', newPath, `# ${name.replace('.md', '')}\n\n`);
    setNewFileDialog(null);

    // Add to collection
    const now = new Date();
    FileItems.insert({
      filename: newPath,
      basename: filename,
      type: 'file',
      lastmod: now,
      parent: parentDir || normalizedBasePath,
    });

    // Update parent folder(s) lastmod so folders sort by newest content
    let path = newPath;
    while (path.includes('/')) {
      const lastSlash = path.lastIndexOf('/');
      path = path.substring(0, lastSlash) || '/';
      if (path !== '/' && path !== '') {
        FileItems.update(
          { filename: path },
          { $set: { lastmod: now } }
        );
      }
      if (path === '/' || path === '') break;
    }

    // Open the new file
    onFileSelect?.({ filename: newPath, basename: filename, type: 'file' });
  };

  const handleNewFolder = async (name) => {
    const parentDir = newFolderDialog;
    if (parentDir === null) return;

    const newPath = `${parentDir}/${name}`;
    await Meteor.callAsync('webdav.createDirectory', newPath);
    setNewFolderDialog(null);

    // Add to collection
    FileItems.insert({
      filename: newPath,
      basename: name,
      type: 'directory',
      lastmod: new Date(),
      parent: parentDir || normalizedBasePath,
      loaded: false,
    });
  };

  const handleNewFileInRoot = () => {
    setNewFileDialog(normalizedBasePath === '/' ? '' : normalizedBasePath);
  };

  // Build tree with children reactively
  // Using useTracker ensures the tree rebuilds when any FileItems change
  const treeItems = useTracker(() => {
    const buildTree = (items) => {
      return items.map(item => {
        if (item.type === 'directory' && expandedPaths.has(item.filename)) {
          const children = FileItems.find(
            { parent: item.filename },
            { sort: sortObject }
          ).fetch();
          return {
            ...item,
            children: buildTree(children)
          };
        }
        return item;
      });
    };
    return buildTree(rootItems);
  }, [expandedPaths, sortObject, rootItems]);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="p-2 border-b bg-white flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 flex-1 flex items-center gap-1">
          {!loading && (
            <>
              <FolderIcon className="w-4 h-4 text-gray-500" />
              <span className="truncate">{normalizedBasePath === '/' ? 'Root' : normalizedBasePath.split('/').pop()}</span>
            </>
          )}
        </span>
        <button
          onClick={handleNewFileInRoot}
          className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
          title="New file"
        >
          <PlusIcon className="w-4 h-4" />
        </button>
        <SortDropdown value={sortOrder} onChange={handleSortChange} />
        <button
          onClick={refresh}
          className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
          title="Refresh"
        >
          <ArrowPathIcon className="w-4 h-4" />
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
        {!loading && !error && initialLoadComplete && rootItems.length === 0 && (
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
            children={item.children}
            onContextMenu={handleContextMenu}
            currentFilePath={currentFilePath}
            loadingFilePath={loadingFilePath}
          />
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          onClose={() => setContextMenu(null)}
          onOpenNewTab={handleOpenNewTab}
          onRename={() => {
            setRenameDialog(contextMenu.item);
            setContextMenu(null);
          }}
          onDelete={() => {
            setDeleteDialog(contextMenu.item);
            setContextMenu(null);
          }}
          onNewFile={() => {
            setNewFileDialog(contextMenu.item.filename);
            setContextMenu(null);
          }}
          onNewFolder={() => {
            setNewFolderDialog(contextMenu.item.filename);
            setContextMenu(null);
          }}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteDialog && (
        <ConfirmDialog
          title={`Delete ${deleteDialog.type === 'directory' ? 'folder' : 'file'}?`}
          message={
            deleteDialog.type === 'directory'
              ? `Are you sure you want to delete "${deleteDialog.basename}" and all its contents?`
              : `Are you sure you want to delete "${deleteDialog.basename}"?`
          }
          onConfirm={handleDelete}
          onCancel={() => setDeleteDialog(null)}
          danger
          loading={deleting}
        />
      )}

      {/* Rename dialog */}
      {renameDialog && (
        <InputDialog
          title={`Rename ${renameDialog.type === 'directory' ? 'folder' : 'file'}`}
          initialValue={renameDialog.basename}
          placeholder="New name"
          onSubmit={handleRename}
          onCancel={() => setRenameDialog(null)}
          submitText="Rename"
        />
      )}

      {/* New file dialog */}
      {newFileDialog !== null && (
        <InputDialog
          title="New file"
          placeholder="filename.md"
          onSubmit={handleNewFile}
          onCancel={() => setNewFileDialog(null)}
          submitText="Create"
        />
      )}

      {/* New folder dialog */}
      {newFolderDialog !== null && (
        <InputDialog
          title="New folder"
          placeholder="Folder name"
          onSubmit={handleNewFolder}
          onCancel={() => setNewFolderDialog(null)}
          submitText="Create"
        />
      )}
    </div>
  );
}

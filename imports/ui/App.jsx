import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { MuyaEditor } from './MuyaEditor';
import { FileBrowser } from './FileBrowser';
import { SplitPanel, useIsMobile } from './SplitPanel';
import { Login } from './Login';
import { Settings } from './Settings';
import { EditorToolbar } from './EditorToolbar';
import { PullToRefresh } from './PullToRefresh';
import { FileItems } from '../api/collections';

// File content cache helpers
const FILE_CACHE_KEY = 'fileContentCache';
const FILE_CACHE_VERSION = 1;
const LAST_FILE_KEY = 'lastOpenedFile';
const DOM_CACHE_PREFIX = 'domCache:';
const REMEMBER_LAST_FILE_KEY = 'makora:rememberLastFile';

function getLastFile() {
  try {
    return localStorage.getItem(LAST_FILE_KEY);
  } catch {
    return null;
  }
}

function getRememberLastFile() {
  try {
    return localStorage.getItem(REMEMBER_LAST_FILE_KEY) === 'true';
  } catch {
    return false;
  }
}

function setLastFile(path) {
  try {
    if (path) {
      localStorage.setItem(LAST_FILE_KEY, path);
    } else {
      localStorage.removeItem(LAST_FILE_KEY);
    }
  } catch {
    // localStorage might be disabled
  }
}

function getFileCache(path) {
  try {
    const raw = localStorage.getItem(FILE_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (cache.version !== FILE_CACHE_VERSION) return null;
    return cache.files?.[path] || null;
  } catch {
    return null;
  }
}

function setFileCache(path, data) {
  try {
    const raw = localStorage.getItem(FILE_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : { version: FILE_CACHE_VERSION, files: {} };
    if (cache.version !== FILE_CACHE_VERSION) {
      cache.version = FILE_CACHE_VERSION;
      cache.files = {};
    }
    cache.files[path] = { ...data, cachedAt: Date.now() };
    localStorage.setItem(FILE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage might be full
  }
}

function getDomCache(path) {
  try {
    return localStorage.getItem(DOM_CACHE_PREFIX + path);
  } catch {
    return null;
  }
}

function setDomCache(path, html) {
  try {
    localStorage.setItem(DOM_CACHE_PREFIX + path, html);
  } catch {
    // localStorage might be full
  }
}

function UserMenu({ onOpenSettings }) {
  const [open, setOpen] = useState(false);
  const user = Meteor.user();
  const menuRef = React.useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const name = user?.profile?.name || user?.emails?.[0]?.address || 'User';
  const picture = user?.profile?.picture;
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/50"
      >
        {picture ? (
          <img src={picture} alt="" className="w-6 h-6 rounded-full" />
        ) : (
          <div className="w-6 h-6 rounded-full bg-warm-gray/30 flex items-center justify-center text-xs text-charcoal">
            {initials}
          </div>
        )}
        <span className="text-sm text-charcoal hidden sm:inline">{name.split(' ')[0]}</span>
        <svg className="w-4 h-4 text-warm-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-cream py-1 z-50">
          <div className="px-3 py-2 border-b border-cream">
            <p className="text-sm font-medium text-charcoal truncate">{name}</p>
            <p className="text-xs text-warm-gray truncate">{user?.emails?.[0]?.address}</p>
          </div>
          <button
            onClick={() => { setOpen(false); onOpenSettings?.(); }}
            className="w-full px-3 py-2 text-left text-sm text-charcoal hover:bg-cream/50"
          >
            Settings
          </button>
          <button
            onClick={() => { setOpen(false); Meteor.logout(); }}
            className="w-full px-3 py-2 text-left text-sm text-charcoal hover:bg-cream/50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// Test user for when auth is disabled
const TEST_USER = {
  _id: 'test-user-id',
  emails: [{ address: 'test@example.com', verified: true }],
  profile: { name: 'Test User' },
};

function WelcomeScreen() {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
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
    { keys: 'Alt + Shift + 5', action: 'Strikethrough' },
  ];

  return (
    <div className="h-full flex items-center justify-center bg-gray-50">
      <div className="max-w-md text-center">
        <h2 className="text-2xl font-light text-gray-400 mb-8">Makora</h2>

        <div className="text-left bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
            Keyboard Shortcuts
          </h3>
          <div className="space-y-2">
            {shortcuts.map(({ keys, action }) => (
              <div key={keys} className="flex justify-between text-sm">
                <span className="text-gray-600">{action}</span>
                <kbd className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-500">
                  {keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-6 text-sm text-gray-400">
          Select a markdown file from the sidebar to start editing
        </p>
      </div>
    </div>
  );
}

function EditorPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const basePath = searchParams.get('path') || '/';
  const currentFile = searchParams.get('file');
  const isMobile = useIsMobile();

  console.log('[EditorPage] currentFile:', currentFile, 'isMobile:', isMobile);

  const [selectedFile, setSelectedFile] = useState(null);
  const [fileDir, setFileDir] = useState('/');
  const [editorKey, setEditorKey] = useState(0);
  // Start loading if we have a file to load from URL, or if we might restore a last file
  const [loading, setLoading] = useState(() => {
    if (searchParams.get('file')) return true;
    // Check if we might restore a last file (we'll verify settings async)
    const lastFile = getLastFile();
    return !!lastFile;
  });
  // Track which file is being loaded (for file browser spinner)
  const [loadingFilePath, setLoadingFilePath] = useState(searchParams.get('file'));
  // Track if we're reloading (vs initial load) - keeps editor visible on mobile
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [blockInfo, setBlockInfo] = useState({ headingLevel: null, listType: null });
  // Track if Muya editor has finished initializing (separate from file loading)
  const [editorReady, setEditorReady] = useState(false);
  // Cached DOM preview HTML (shown while Muya initializes)
  const [domPreview, setDomPreview] = useState(null);
  const editorRef = React.useRef(null);
  const pendingContentRef = React.useRef('');
  // Track if basePath has been resolved from settings
  const [basePathReady, setBasePathReady] = useState(() => {
    const ready = !!searchParams.get('path');
    console.log('[Init] basePathReady initial:', ready);
    return ready;
  });

  console.log('[Render] basePathReady:', basePathReady, 'basePath:', basePath, 'loading:', loading);

  // Load saved basePath and optionally last file on mount
  useEffect(() => {
    console.log('[Effect:Mount] Starting...');
    const hasPath = searchParams.get('path');
    const hasFile = searchParams.get('file');
    console.log('[Mount] hasPath:', hasPath, 'hasFile:', hasFile, 'URL:', window.location.href);

    // If we already have both path and file in URL, we're done
    if (hasPath && hasFile) {
      console.log('[Mount] Already have path and file');
      setBasePathReady(true);
      return;
    }

    // Check localStorage for rememberLastFile (no server call needed)
    const rememberLastFile = getRememberLastFile();
    const lastFile = getLastFile();
    console.log('[Mount] rememberLastFile:', rememberLastFile, 'lastFile:', lastFile);

    // Restore last file immediately if enabled (from localStorage)
    if (!hasFile && rememberLastFile && lastFile) {
      const updates = new URLSearchParams(searchParams);
      updates.set('file', lastFile);
      // Also set path from localStorage cache if available
      const cachedBasePath = localStorage.getItem('makora:basePath');
      if (!hasPath && cachedBasePath) {
        updates.set('path', cachedBasePath);
      }
      console.log('[Mount] Restoring last file:', lastFile);
      setSearchParams(updates);
      setBasePathReady(true);
    } else {
      // No file to restore - stop loading
      setLoading(false);
    }

    // Load settings from server (for basePath only - rememberLastFile is now localStorage)
    const loadSettings = async () => {
      try {
        const settings = await Meteor.callAsync('settings.getWebdav');

        // Cache basePath for next cold start
        if (settings?.basePath) {
          localStorage.setItem('makora:basePath', settings.basePath);
        }

        // Re-read current params
        const currentParams = new URLSearchParams(window.location.search);
        const currentHasPath = currentParams.get('path');

        // Set basePath if not already set
        if (!currentHasPath && settings?.basePath && settings.basePath !== '/') {
          const updates = new URLSearchParams(currentParams);
          updates.set('path', settings.basePath);
          setSearchParams(updates);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setBasePathReady(true);
      }
    };
    loadSettings();
  }, []);


  // Track currently loaded file to avoid unnecessary reloads
  const loadedFileRef = useRef(null);

  // Load file from URL on mount or when file param changes
  useEffect(() => {
    if (currentFile) {
      // Skip reload if same file (e.g., closing and reopening)
      if (currentFile === loadedFileRef.current) {
        // File already loaded - just clear loading state
        setLoading(false);
        setLoadingFilePath(null);
        setReloading(false);
        return;
      }
      loadedFileRef.current = currentFile;
      loadFile(currentFile);
    }
  }, [currentFile]);

  // Keyboard shortcut for save (Cmd+S / Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFile, fileDir]);

  // Transform image URLs for display
  const transformContent = (rawContent, dir) => {
    const normalizedContent = rawContent?.replace(/\r\n/g, '\n') || '';

    const transformSrc = (src) => {
      const token = Meteor._localStorage.getItem('Meteor.loginToken');
      const tokenParam = token ? `?token=${token}` : '';

      // Route external URLs through proxy with query params
      if (src.startsWith('http://') || src.startsWith('https://')) {
        const params = new URLSearchParams();
        params.set('url', src);
        if (token) params.set('token', token);
        return `${window.location.origin}/image-proxy?${params.toString()}`;
      }
      // Skip if already a proxy URL (but ensure it's absolute for Muya)
      if (src.startsWith('/image-proxy') || src.startsWith('/webdav-proxy') || src.startsWith('/external-proxy')) {
        return window.location.origin + src;
      }
      // Decode URL-encoded paths and resolve relative path
      const decodedSrc = decodeURIComponent(src);
      const cleanSrc = decodedSrc.replace(/^\.\//, '');
      const absolutePath = `${dir}/${cleanSrc}`.replace(/\/+/g, '/');
      // Encode path segments but keep slashes
      const encodedPath = absolutePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
      // Use unified proxy for WebDAV paths too
      return `${window.location.origin}/image-proxy${encodedPath}${tokenParam}`;
    };

    return normalizedContent
      // Convert HTML img tags to markdown syntax first
      .replace(/<img\s+[^>]*?src=["']([^"']+)["'][^>]*?alt=["']([^"']*)["'][^>]*>/gi, (match, src, alt) => {
        return `![${alt}](${transformSrc(src)})`;
      })
      .replace(/<img\s+[^>]*?alt=["']([^"']*)["'][^>]*?src=["']([^"']+)["'][^>]*>/gi, (match, alt, src) => {
        return `![${alt}](${transformSrc(src)})`;
      })
      // Handle img tags without alt attribute
      .replace(/<img\s+[^>]*?src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
        return `![](${transformSrc(src)})`;
      })
      // Transform markdown images: ![alt](src)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
        // Only transform if not already transformed (check both relative and absolute proxy URLs)
        if (src.startsWith('/image-proxy') || src.startsWith('/webdav-proxy') || src.startsWith('/external-proxy') ||
            src.includes('/image-proxy') || src.includes('/webdav-proxy') || src.includes('/external-proxy')) {
          return match;
        }
        return `![${alt}](${transformSrc(src)})`;
      });
  };

  const loadFile = async (filePath, forceReload = false) => {
    const basename = filePath.split('/').pop();
    const dir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';

    // Load DOM cache for instant preview
    const cachedHtml = getDomCache(filePath);
    if (cachedHtml) {
      setDomPreview(cachedHtml);
    } else {
      setDomPreview(null);
    }

    // Update loading state immediately
    setLoading(true);
    setLoadingFilePath(filePath);
    setSelectedFile({ filename: filePath, basename });
    setFileDir(dir);

    // Reset editorReady so DOM preview shows during reload
    if (forceReload) {
      setEditorReady(false);
    }

    // Check for cached content first (skip if forcing reload)
    const cached = forceReload ? null : getFileCache(filePath);
    let usedCache = false;

    if (cached?.content) {
      // Show cached content immediately while we fetch fresh data
      pendingContentRef.current = transformContent(cached.content, dir);
      setEditorReady(false); // Reset - Muya needs to initialize
      setEditorKey(k => k + 1);
      // Hide spinner immediately - cached content will render
      // Server fetch continues in background to check for updates
      setLoading(false);
      setLoadingFilePath(null);
      usedCache = true;

      // Fetch fresh data in background (non-blocking)
      const options = { etag: cached.etag, lastModified: cached.lastModified };
      Meteor.callAsync('webdav.read', filePath, options).then(result => {
        if (result.notModified) {
          console.log('Cache still valid (304):', filePath);
          return;
        }
        console.log('Got fresh content, length:', result.content?.length);
        setFileCache(filePath, {
          content: result.content,
          etag: result.etag,
          lastModified: result.lastModified,
        });
        // Only update editor if content actually changed
        if (cached.content !== result.content) {
          pendingContentRef.current = transformContent(result.content, dir);
          setEditorReady(false);
          setEditorKey(k => k + 1);
        }
      }).catch(err => {
        console.error('Background refresh failed:', err);
      });
      return;
    }
    // If no cache: don't mount editor yet - wait for server response
    // This prevents showing empty editor with blinking cursor

    try {
      // Fetch from server (with conditional headers if we have cache metadata)
      const options = cached ? { etag: cached.etag, lastModified: cached.lastModified } : {};
      const result = await Meteor.callAsync('webdav.read', filePath, options);

      if (result.notModified) {
        // Cache is still valid, nothing to update
        setLoading(false);
        setLoadingFilePath(null);
        setReloading(false);
        return;
      }

      // Update cache
      setFileCache(filePath, {
        content: result.content,
        etag: result.etag,
        lastModified: result.lastModified,
      });

      // If we already showed cached content, check if it actually changed
      if (usedCache && cached.content === result.content) {
        // Content is the same, no need to update editor
        setLoading(false);
        setLoadingFilePath(null);
        setReloading(false);
        return;
      }

      // Update editor with new content
      pendingContentRef.current = transformContent(result.content, dir);
      setEditorReady(false);
      setEditorKey(k => k + 1);
    } catch (err) {
      console.error('Failed to load file:', err);
      if (!usedCache) {
        // Only show error if we didn't have cached content
        pendingContentRef.current = `Error loading file: ${err.message}`;
        setEditorReady(false);
        setEditorKey(k => k + 1);
      }
      setLoading(false);
      setLoadingFilePath(null);
      setReloading(false);
    }
    // Note: setLoading(false) is called by MuyaEditor's onReady callback
    // to ensure spinner shows until editor is fully rendered
  };

  // Reverse transform proxy URLs back to relative paths for saving
  const prepareForSave = (text) => {
    // Encode fileDir segments for comparison
    const encodedFileDir = fileDir.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const imageProxyPrefix = `/image-proxy${encodedFileDir}/`;
    const webdavProxyPrefix = `/webdav-proxy${encodedFileDir}/`;

    const reverseSrc = (src) => {
      // Handle external URLs via unified image-proxy with base64url encoding
      try {
        const url = new URL(src);
        // Check for /image-proxy/ext/<base64url> format
        if (url.pathname.includes('/image-proxy/ext/')) {
          const base64Part = url.pathname.split('/image-proxy/ext/')[1];
          if (base64Part) {
            // Decode base64url back to original URL
            const padded = base64Part.replace(/-/g, '+').replace(/_/g, '/');
            const originalUrl = atob(padded);
            return originalUrl;
          }
        }
        // Also handle query param format (legacy)
        if (url.pathname === '/image-proxy' || url.pathname.endsWith('/image-proxy')) {
          const originalUrl = url.searchParams.get('url');
          if (originalUrl) {
            return originalUrl;
          }
        }
        // Also handle legacy external-proxy URLs
        if (url.pathname === '/external-proxy' || url.pathname.endsWith('/external-proxy')) {
          const originalUrl = url.searchParams.get('url');
          if (originalUrl) {
            return originalUrl;
          }
        }
      } catch (e) {
        // Not a valid URL, continue processing
      }

      // Strip query params (like ?token=...) before processing
      const srcWithoutQuery = src.split('?')[0];

      // Strip origin if present (we now use absolute URLs for Muya compatibility)
      let cleanSrc = srcWithoutQuery;
      try {
        const url = new URL(srcWithoutQuery);
        // If it's from the same origin, strip it
        if (url.origin === window.location.origin) {
          cleanSrc = url.pathname;
        }
      } catch (e) {
        // Not a valid URL, use as-is
      }

      // Decode the src for comparison and output
      const decodedSrc = decodeURIComponent(cleanSrc);
      const decodedImageProxyPrefix = decodeURIComponent(imageProxyPrefix);
      const decodedWebdavProxyPrefix = decodeURIComponent(webdavProxyPrefix);

      // Handle unified image-proxy paths
      if (decodedSrc.startsWith(decodedImageProxyPrefix)) {
        return './' + decodedSrc.slice(decodedImageProxyPrefix.length);
      }
      if (decodedSrc.startsWith('/image-proxy/')) {
        // Absolute path within image-proxy - keep as relative from root
        return decodedSrc.slice('/image-proxy'.length);
      }

      // Handle legacy webdav-proxy paths
      if (decodedSrc.startsWith(decodedWebdavProxyPrefix)) {
        return './' + decodedSrc.slice(decodedWebdavProxyPrefix.length);
      }
      if (decodedSrc.startsWith('/webdav-proxy/')) {
        // Absolute path within webdav - keep as relative from root
        return decodedSrc.slice('/webdav-proxy'.length);
      }
      return src;
    };

    // Only need to handle markdown images now since we normalize to ![]() syntax
    return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
      return `![${alt}](${reverseSrc(src)})`;
    });
  };

  const saveFile = async () => {
    if (!selectedFile || saving) return;

    setSaving(true);
    try {
      // Get content from editor (async to wait for IME composition to end)
      const currentContent = await editorRef.current?.getContentAsync() || '';
      // Just restore relative image paths
      const saveContent = prepareForSave(currentContent);
      await Meteor.callAsync('webdav.write', selectedFile.filename, saveContent);
      console.log('File saved successfully');
      // Mark editor as clean after successful save
      editorRef.current?.markClean();
      // Update lastmod in FileItems collection for proper date sorting
      const now = new Date();
      FileItems.update(
        { filename: selectedFile.filename },
        { $set: { lastmod: now } }
      );
      // Also update parent folder(s) lastmod so folders sort by newest content
      let path = selectedFile.filename;
      while (path.includes('/')) {
        const lastSlash = path.lastIndexOf('/');
        path = path.substring(0, lastSlash) || '/';
        if (path !== '/') {
          FileItems.update(
            { filename: path },
            { $set: { lastmod: now } }
          );
        }
        if (path === '/') break;
      }
      // Hide keyboard on mobile after save
      if (isMobile && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    } catch (err) {
      console.error('Failed to save file:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (file) => {
    // Set loading immediately so spinner shows in file browser
    setLoading(true);
    setLoadingFilePath(file.filename);
    // Save as last opened file for "remember last file" feature
    setLastFile(file.filename);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('file', file.filename);
      return next;
    });
  };

  const handleFileDelete = (deletedPath, type) => {
    // Check if the deleted file or folder contains the currently open file
    const shouldClose = type === 'directory'
      ? currentFile?.startsWith(deletedPath + '/')
      : currentFile === deletedPath;

    if (shouldClose) {
      // Clear the file from URL to close the editor
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('file');
        return next;
      });
      setSelectedFile(null);
    }
  };

  return (
    <div className="h-dvh flex flex-col overflow-x-hidden">
      {/* Header */}
      <div className="bg-cream border-b border-cream px-2 sm:px-4 py-1 sm:py-2 flex items-center shrink-0 z-40">
        {isMobile && currentFile ? (
          <button
            onClick={() => {
              setSearchParams(prev => {
                const next = new URLSearchParams(prev);
                next.delete('file');
                return next;
              });
            }}
            className="p-1 -ml-1 mr-2 text-charcoal hover:bg-gray-100 rounded"
            aria-label="Back to files"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <h1 className="font-serif text-xl font-light text-charcoal">Makora</h1>
        )}
        <span className="flex-1 text-center text-sm text-warm-gray overflow-hidden text-ellipsis whitespace-nowrap px-4">
          {currentFile ? currentFile.split('/').pop() : ''}
        </span>
        <UserMenu onOpenSettings={() => setShowSettings(true)} />
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {console.log('[Render:SplitPanel] basePathReady:', basePathReady, '→ showing:', basePathReady ? 'FileBrowser' : 'Spinner')}
        <SplitPanel
          showRightPane={!!currentFile}
          left={
            basePathReady ? (
              <FileBrowser
                basePath={basePath}
                onFileSelect={handleFileSelect}
                onFileDelete={handleFileDelete}
                currentFilePath={currentFile}
                loadingFilePath={loadingFilePath}
              />
            ) : (
              <div className="fixed inset-0 bg-white z-50 flex items-center justify-center">
                <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              </div>
            )
          }
          right={
            <div className="h-full relative">
              {/* Editor - stays mounted, hidden when no file selected */}
              <div className={`h-full bg-white flex flex-col ${currentFile ? '' : 'invisible'}`}>
                {/* Toolbar */}
                <EditorToolbar
                  editorRef={editorRef}
                  disabled={loading}
                  currentHeading={blockInfo.headingLevel}
                  currentList={blockInfo.listType}
                  saving={saving}
                  loading={loading}
                  isDirty={isDirty}
                  onSave={saveFile}
                  onReload={() => {
                    if (currentFile) {
                      // Force reload from server, bypassing cache
                      setReloading(true);
                      loadedFileRef.current = currentFile;
                      loadFile(currentFile, true);
                    }
                  }}
                  onClose={() => {
                    setSearchParams(prev => {
                      const next = new URLSearchParams(prev);
                      next.delete('file');
                      return next;
                    });
                    setSelectedFile(null);
                  }}
                />

                {/* Editor area */}
                <PullToRefresh
                  disabled={loading || !currentFile}
                  onRefresh={() => {
                    if (currentFile) {
                      // Trigger reload - shows DOM preview with spinner
                      setReloading(true);
                      loadedFileRef.current = currentFile;
                      loadFile(currentFile, true);
                    }
                  }}
                >
                <div className="flex-1 overflow-auto relative h-full">
                  {/* Loading overlay with spinner - contained to editor panel */}
                  <div
                    className={`absolute inset-0 bg-white z-30 flex items-center justify-center transition-opacity duration-150 ${loading && !reloading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                  >
                    <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                  {/* Only render editor once we have content (editorKey > 0) */}
                  {editorKey > 0 && (
                    <MuyaEditor
                        ref={editorRef}
                        key={editorKey}
                        initialValue={pendingContentRef.current}
                        onDirtyChange={setIsDirty}
                        onReady={() => {
                          console.log('[Editor] onReady called, currentFile:', currentFile);
                          setEditorReady(true);
                          setDomPreview(null); // Clear preview, show live editor
                          setLoading(false);
                          setLoadingFilePath(null);
                          setReloading(false);
                          // Save DOM cache for next load
                          if (currentFile) {
                            const editorEl = document.querySelector('.mu-editor');
                            if (editorEl) {
                              setDomCache(currentFile, editorEl.innerHTML);
                            }
                          }
                        }}
                        onBlockChange={setBlockInfo}
                        preventAutoFocus={isMobile}
                      />
                  )}
                  {/* Show cached DOM preview while Muya initializes */}
                  {domPreview && !editorReady && (
                    <div className="absolute inset-0 z-20 overflow-auto bg-white">
                      {/* Cached HTML preview - reuse Muya's CSS classes */}
                      <div className="muya-editor-wrapper">
                        <style>{`
                          .dom-preview .mu-hide,
                          .dom-preview .mu-remove {
                            display: none !important;
                          }
                          .dom-preview .mu-content,
                          .dom-preview .mu-atx-heading .mu-content,
                          .dom-preview h1 .mu-content,
                          .dom-preview h2 .mu-content,
                          .dom-preview h3 .mu-content,
                          .dom-preview h4 .mu-content,
                          .dom-preview h5 .mu-content,
                          .dom-preview h6 .mu-content {
                            display: block !important;
                            visibility: visible !important;
                            opacity: 1 !important;
                          }
                          .dom-preview .mu-plain-text {
                            display: inline !important;
                            visibility: visible !important;
                            opacity: 1 !important;
                          }
                        `}</style>
                        <div
                          className="mu-editor dom-preview opacity-60"
                          dangerouslySetInnerHTML={{ __html: domPreview }}
                        />
                      </div>
                      {/* Dimmed overlay with spinner - shifted up to align with full-screen spinner */}
                      <div className="absolute inset-0 bg-white/40 flex items-center justify-center pb-24">
                        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                      </div>
                    </div>
                  )}
                </div>
                </PullToRefresh>
              </div>

              {/* Welcome screen - shown when no file selected */}
              {!currentFile && <WelcomeScreen />}
            </div>
          }
        />
      </div>

      {/* Mobile loading progress bar */}
      {isMobile && loading && (
        <div className="h-1 bg-gray-200 overflow-hidden shrink-0">
          <div className="h-full bg-blue-500 animate-progress-indeterminate" />
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center" style={{ transition: 'none' }}>
          <div className="relative w-full max-w-md mx-4" style={{ transition: 'none' }}>
            <button
              onClick={() => setShowSettings(false)}
              className="absolute -top-10 right-0 text-white/80 hover:text-white text-sm"
            >
              Close
            </button>
            <Settings onSaved={() => setShowSettings(false)} isModal={true} />
          </div>
        </div>
      )}
    </div>
  );
}

function AuthGate({ children }) {
  const { user, isLoading, authDisabled } = useTracker(() => {
    const authDisabled = Meteor.settings?.public?.disableAuth === true;

    if (authDisabled) {
      return { user: TEST_USER, isLoading: false, authDisabled: true };
    }

    const loggingIn = Meteor.loggingIn();
    const user = Meteor.user();

    return {
      user,
      isLoading: loggingIn,
      authDisabled: false,
    };
  }, []);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-white z-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return children;
}

function WebDAVConfigGate({ children }) {
  const [webdavConfigured, setWebdavConfigured] = useState(null);
  const [checkKey, setCheckKey] = useState(0);
  const authDisabled = Meteor.settings?.public?.disableAuth === true;

  useEffect(() => {
    // In test mode with disableAuth, skip the check (uses global settings fallback)
    if (authDisabled) {
      setWebdavConfigured(true);
      return;
    }
    checkWebDAVConfig();
  }, [checkKey, authDisabled]);

  const checkWebDAVConfig = async () => {
    try {
      const settings = await Meteor.callAsync('settings.getWebdav');
      setWebdavConfigured(settings?.hasPassword === true);
    } catch (err) {
      console.error('Failed to check WebDAV config:', err);
      setWebdavConfigured(false);
    }
  };

  if (webdavConfigured === null) {
    return (
      <div className="fixed inset-0 bg-white z-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!webdavConfigured) {
    return <Settings onSaved={() => setCheckKey(k => k + 1)} />;
  }

  return children;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <WebDAVConfigGate>
          <Routes>
            <Route path="/*" element={<EditorPage />} />
          </Routes>
        </WebDAVConfigGate>
      </AuthGate>
    </BrowserRouter>
  );
}

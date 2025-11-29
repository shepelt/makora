import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { WysiwygEditor } from './Editor';
import { FileBrowser } from './FileBrowser';
import { SplitPanel } from './SplitPanel';
import { Login } from './Login';
import { Settings } from './Settings';

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
            WebDAV Settings
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

  const [content, setContent] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileDir, setFileDir] = useState('/');
  const [editorKey, setEditorKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Load saved basePath into URL on mount (if no path param already)
  useEffect(() => {
    if (searchParams.get('path')) return; // Already have a path
    const loadBasePath = async () => {
      try {
        const settings = await Meteor.callAsync('settings.getWebdav');
        if (settings?.basePath && settings.basePath !== '/') {
          setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('path', settings.basePath);
            return next;
          });
        }
      } catch (err) {
        console.error('Failed to load basePath:', err);
      }
    };
    loadBasePath();
  }, []);


  // Load file from URL on mount or when file param changes
  useEffect(() => {
    if (currentFile) {
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
  }, [selectedFile, content, fileDir]);

  const loadFile = async (filePath) => {
    console.log('Loading file:', filePath);
    setLoading(true);

    try {
      const fileContent = await Meteor.callAsync('webdav.read', filePath);
      console.log('Got content, length:', fileContent?.length);
      const basename = filePath.split('/').pop();
      const dir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
      setSelectedFile({ filename: filePath, basename });
      setFileDir(dir);

      const transformSrc = (src) => {
        // Skip absolute URLs
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/webdav-proxy')) {
          return src;
        }
        // Decode URL-encoded paths and resolve relative path
        const decodedSrc = decodeURIComponent(src);
        const cleanSrc = decodedSrc.replace(/^\.\//, '');
        const absolutePath = `${dir}/${cleanSrc}`.replace(/\/+/g, '/');
        // Encode path segments but keep slashes
        const encodedPath = absolutePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
        return `/webdav-proxy${encodedPath}`;
      };

      let transformedContent = fileContent
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
          // Only transform if not already transformed
          if (src.startsWith('/webdav-proxy')) return match;
          return `![${alt}](${transformSrc(src)})`;
        });

      // Pass raw markdown to editor - tiptap-markdown handles parsing
      setContent(transformedContent);
      setEditorKey(k => k + 1);
    } catch (err) {
      console.error('Failed to load file:', err);
      setContent(`Error loading file: ${err.message}`);
      setEditorKey(k => k + 1);
    } finally {
      setLoading(false);
    }
  };

  // Reverse transform proxy URLs back to relative paths for saving
  const prepareForSave = (text) => {
    // Encode fileDir segments for comparison
    const encodedFileDir = fileDir.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const proxyPrefix = `/webdav-proxy${encodedFileDir}/`;

    const reverseSrc = (src) => {
      // Decode the src for comparison and output
      const decodedSrc = decodeURIComponent(src);
      const decodedPrefix = decodeURIComponent(proxyPrefix);

      if (decodedSrc.startsWith(decodedPrefix)) {
        return './' + decodedSrc.slice(decodedPrefix.length);
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
      // content is already markdown from tiptap-markdown
      // Just restore relative image paths
      const saveContent = prepareForSave(content);
      await Meteor.callAsync('webdav.write', selectedFile.filename, saveContent);
      console.log('File saved successfully');
    } catch (err) {
      console.error('Failed to save file:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (file) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('file', file.filename);
      return next;
    });
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-cream border-b border-cream px-4 py-2 flex items-center shrink-0 z-40">
        <h1 className="font-serif text-xl font-light text-charcoal">Makora</h1>
        <span className="flex-1 text-center text-sm text-warm-gray">
          {selectedFile ? (loading ? 'Loading...' : selectedFile.basename) : ''}
        </span>
        <div className="flex items-center gap-3">
          {selectedFile && (
            <button
              onClick={saveFile}
              disabled={loading || saving}
              className="px-3 py-1.5 text-sm bg-charcoal text-white rounded-lg hover:bg-charcoal/90 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && (
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {saving ? 'Saving' : 'Save'}
            </button>
          )}
          <UserMenu onOpenSettings={() => setShowSettings(true)} />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <SplitPanel
          left={
            <FileBrowser
              basePath={basePath}
              onFileSelect={handleFileSelect}
            />
          }
          right={
            currentFile ? (
              <div className="h-full bg-white overflow-auto relative">
                {loading && (
                  <div className="sticky top-0 left-0 right-0 h-full bg-white/80 flex items-center justify-center z-10" style={{ marginBottom: '-100%' }}>
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                      <span className="text-sm text-gray-500">Loading...</span>
                    </div>
                  </div>
                )}
                <WysiwygEditor
                  key={editorKey}
                  initialValue={content}
                  onChange={setContent}
                />
              </div>
            ) : (
              <WelcomeScreen />
            )
          }
        />
      </div>

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
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm text-gray-500">Loading...</span>
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
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm text-gray-500">Loading...</span>
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

import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import { Meteor } from 'meteor/meteor';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { WysiwygEditor } from './Editor';
import { FileBrowser } from './FileBrowser';
import { SplitPanel } from './SplitPanel';

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

  // Initialize Turndown for HTML to Markdown conversion
  const turndownService = useMemo(() => {
    const service = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    return service;
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

      // Convert markdown to HTML for the editor
      const htmlContent = await marked.parse(transformedContent);
      setContent(htmlContent);
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
      // Convert HTML to Markdown first
      const markdownContent = turndownService.turndown(content);
      // Then restore relative image paths
      const saveContent = prepareForSave(markdownContent);
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
      <div className="bg-white border-b px-4 py-2 flex items-center shrink-0 z-40">
        <h1 className="text-xl font-bold text-gray-800">Makora</h1>
        {selectedFile && (
          <>
            <span className="flex-1 text-center text-sm text-gray-500">
              {loading ? 'Loading...' : selectedFile.basename}
            </span>
            <button
              onClick={saveFile}
              disabled={loading || saving}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {saving ? 'Saving' : 'Save'}
            </button>
          </>
        )}
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
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<EditorPage />} />
      </Routes>
    </BrowserRouter>
  );
}

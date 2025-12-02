import React, { memo, useCallback, useState, useRef, useEffect } from 'react';

// Toolbar icons as simple SVG components
const icons = {
  bold: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/>
    </svg>
  ),
  italic: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/>
    </svg>
  ),
  underline: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/>
    </svg>
  ),
  code: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  heading: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M5 4v3h5.5v12h3V7H19V4z"/>
    </svg>
  ),
  chevronDown: (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  ),
  check: (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  bulletList: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="2" cy="6" r="1" fill="currentColor" />
      <circle cx="2" cy="12" r="1" fill="currentColor" />
      <circle cx="2" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  orderedList: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/>
    </svg>
  ),
  taskList: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3" y="5" width="4" height="4" rx="1" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 7h11" />
      <rect x="3" y="13" width="4" height="4" rx="1" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 15h11" />
    </svg>
  ),
  indent: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 9l3 3-3 3" />
    </svg>
  ),
  outdent: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9l-3 3 3 3" />
    </svg>
  ),
};

function ToolbarButton({ icon, title, onClick, disabled, active, testId }) {
  // Prevent focus loss from editor when clicking toolbar buttons (issue #26)
  // On iPad, tapping a button steals focus before onClick fires, clearing the selection
  const handleMouseDown = (e) => {
    e.preventDefault();
  };

  return (
    <button
      onMouseDown={handleMouseDown}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={`p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
        active ? 'bg-gray-200' : ''
      }`}
    >
      {icon}
    </button>
  );
}

function HeadingDropdown({ onSelect, currentHeading, disabled }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const headings = [
    { level: 0, label: 'Paragraph' },
    { level: 1, label: 'Heading 1' },
    { level: 2, label: 'Heading 2' },
    { level: 3, label: 'Heading 3' },
    { level: 4, label: 'Heading 4' },
    { level: 5, label: 'Heading 5' },
    { level: 6, label: 'Heading 6' },
  ];

  // Prevent focus loss from editor when clicking toolbar buttons (issue #26)
  const handleMouseDown = (e) => {
    e.preventDefault();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onMouseDown={handleMouseDown}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        title="Heading"
        data-testid="toolbar-heading"
        className="flex items-center gap-0.5 p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {icons.heading}
        {icons.chevronDown}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded shadow-lg border border-gray-200 py-1 z-50 min-w-[130px]">
          {headings.map(({ level, label }) => (
            <button
              key={level}
              onMouseDown={handleMouseDown}
              onClick={() => {
                // If clicking the current heading (non-paragraph), toggle to paragraph
                if (currentHeading === level && level !== 0) {
                  onSelect(0); // Convert to paragraph
                } else {
                  onSelect(level);
                }
                setOpen(false);
              }}
              data-testid={`toolbar-heading-${level}`}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 transition-colors flex items-center justify-between"
            >
              <span>{label}</span>
              {currentHeading === level && (
                <span className="text-blue-500">{icons.check}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ListDropdown({ onSelect, currentList, disabled }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const lists = [
    { type: 'bullet-list', label: 'Unordered List', icon: icons.bulletList },
    { type: 'order-list', label: 'Ordered List', icon: icons.orderedList },
    { type: 'task-list', label: 'Task List', icon: icons.taskList },
  ];

  // Prevent focus loss from editor when clicking toolbar buttons (issue #26)
  const handleMouseDown = (e) => {
    e.preventDefault();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onMouseDown={handleMouseDown}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        title="List"
        data-testid="toolbar-list"
        className="flex items-center gap-0.5 p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {icons.bulletList}
        {icons.chevronDown}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded shadow-lg border border-gray-200 py-1 z-50 min-w-[140px]">
          {lists.map(({ type, label, icon }) => (
            <button
              key={type}
              onMouseDown={handleMouseDown}
              onClick={() => {
                // If clicking the current list type, toggle OFF to paragraph
                if (currentList === type) {
                  onSelect('paragraph');
                } else {
                  onSelect(type);
                }
                setOpen(false);
              }}
              data-testid={`toolbar-list-${type}`}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 transition-colors flex items-center gap-2"
            >
              <span className="text-gray-500">{icon}</span>
              <span className="flex-1">{label}</span>
              {currentList === type && (
                <span className="text-blue-500">{icons.check}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Save/status icon with loading and dirty states
function SaveStatusIcon({ saving, loading, isDirty, onSave, disabled }) {
  // Prevent focus loss from editor when clicking toolbar buttons
  const handleMouseDown = (e) => {
    e.preventDefault();
  };

  const isSpinning = saving || loading;

  return (
    <button
      onMouseDown={handleMouseDown}
      onClick={onSave}
      disabled={disabled || isSpinning}
      title={loading ? 'Loading...' : saving ? 'Saving...' : isDirty ? 'Save changes (Ctrl+S)' : 'No unsaved changes'}
      data-testid="toolbar-save"
      className="relative p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {isSpinning ? (
        <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {isDirty && !isSpinning && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full" />
      )}
    </button>
  );
}

export const EditorToolbar = memo(function EditorToolbar({ editorRef, disabled, currentHeading, currentList, saving, loading, isDirty, onSave, onReload, onClose }) {
  const handleBold = useCallback(() => {
    editorRef.current?.format?.('strong');
  }, [editorRef]);

  const handleItalic = useCallback(() => {
    editorRef.current?.format?.('em');
  }, [editorRef]);

  const handleUnderline = useCallback(() => {
    editorRef.current?.format?.('u');
  }, [editorRef]);

  const handleCode = useCallback(() => {
    editorRef.current?.format?.('inline_code');
  }, [editorRef]);

  const handleHeading = useCallback((level) => {
    // Level 0 means paragraph (remove heading)
    editorRef.current?.setHeading?.(level);
  }, [editorRef]);

  const handleList = useCallback((type) => {
    editorRef.current?.setList?.(type);
  }, [editorRef]);

  const handleIndent = useCallback(() => {
    editorRef.current?.indent?.();
  }, [editorRef]);

  const handleOutdent = useCallback(() => {
    editorRef.current?.outdent?.();
  }, [editorRef]);

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 bg-gray-50 border-b border-gray-200"
      data-testid="editor-toolbar"
    >
      {/* Text formatting */}
      <ToolbarButton
        icon={icons.bold}
        title="Bold (Ctrl+B)"
        onClick={handleBold}
        disabled={disabled}
        testId="toolbar-bold"
      />
      <ToolbarButton
        icon={icons.italic}
        title="Italic (Ctrl+I)"
        onClick={handleItalic}
        disabled={disabled}
        testId="toolbar-italic"
      />
      <ToolbarButton
        icon={icons.underline}
        title="Underline (Ctrl+U)"
        onClick={handleUnderline}
        disabled={disabled}
        testId="toolbar-underline"
      />

      {/* Divider */}
      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Heading dropdown */}
      <HeadingDropdown onSelect={handleHeading} disabled={disabled} currentHeading={currentHeading} />

      {/* List dropdown */}
      <ListDropdown onSelect={handleList} disabled={disabled} currentList={currentList} />

      {/* Divider */}
      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Indent/Outdent */}
      <ToolbarButton
        icon={icons.outdent}
        title="Decrease Indent"
        onClick={handleOutdent}
        disabled={disabled}
        testId="toolbar-outdent"
      />
      <ToolbarButton
        icon={icons.indent}
        title="Increase Indent"
        onClick={handleIndent}
        disabled={disabled}
        testId="toolbar-indent"
      />

      {/* Divider */}
      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Code */}
      <ToolbarButton
        icon={icons.code}
        title="Code (Ctrl+`)"
        onClick={handleCode}
        disabled={disabled}
        testId="toolbar-code"
      />

      {/* Spacer to push save to the right */}
      <div className="flex-1" />

      {/* Reload button */}
      <ToolbarButton
        icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        }
        title="Reload file"
        onClick={onReload}
        disabled={disabled}
        testId="toolbar-reload"
      />

      {/* Save/status icon */}
      <SaveStatusIcon
        saving={saving}
        loading={loading}
        isDirty={isDirty}
        onSave={onSave}
        disabled={disabled}
      />

      {/* Close button */}
      <ToolbarButton
        icon={
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        }
        title="Close file"
        onClick={onClose}
        disabled={disabled}
        testId="toolbar-close"
      />
    </div>
  );
});

import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { Markdown } from 'tiptap-markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';

// Typora-style keyboard shortcuts
const TyporaShortcuts = Extension.create({
  name: 'typoraShortcuts',

  addKeyboardShortcuts() {
    return {
      // Headings: Ctrl/Cmd + 1-6
      'Mod-1': () => this.editor.chain().focus().toggleHeading({ level: 1 }).run(),
      'Mod-2': () => this.editor.chain().focus().toggleHeading({ level: 2 }).run(),
      'Mod-3': () => this.editor.chain().focus().toggleHeading({ level: 3 }).run(),
      'Mod-4': () => this.editor.chain().focus().toggleHeading({ level: 4 }).run(),
      'Mod-5': () => this.editor.chain().focus().toggleHeading({ level: 5 }).run(),
      'Mod-6': () => this.editor.chain().focus().toggleHeading({ level: 6 }).run(),

      // Paragraph: Ctrl/Cmd + 0
      'Mod-0': () => this.editor.chain().focus().setParagraph().run(),

      // Blockquote: Ctrl + Shift + Q
      'Mod-Shift-q': () => this.editor.chain().focus().toggleBlockquote().run(),

      // Code block: Ctrl + Shift + K
      'Mod-Shift-k': () => this.editor.chain().focus().toggleCodeBlock().run(),

      // Ordered list: Ctrl + Shift + O
      'Mod-Shift-o': () => this.editor.chain().focus().toggleOrderedList().run(),

      // Unordered list: Ctrl + Shift + U
      'Mod-Shift-u': () => this.editor.chain().focus().toggleBulletList().run(),

      // Strikethrough: Alt + Shift + 5
      'Alt-Shift-5': () => this.editor.chain().focus().toggleStrike().run(),
    };
  },
});

export function WysiwygEditor({ initialValue = '', onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
      TyporaShortcuts,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Markdown.configure({
        html: true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content: initialValue, // Raw markdown - tiptap-markdown handles parsing
    onUpdate: ({ editor }) => {
      // Output markdown directly via tiptap-markdown
      onChange?.(editor.storage.markdown.getMarkdown());
    },
  });

  return (
    <div className="tiptap-editor">
      <EditorContent editor={editor} />
      <style>{`
        .tiptap-editor .ProseMirror {
          min-height: 400px;
          padding: 2rem 15%;
          outline: none;
        }
        @media (max-width: 900px) {
          .tiptap-editor .ProseMirror {
            padding: 1.5rem 5%;
          }
        }
        .tiptap-editor .ProseMirror p {
          margin: 0.5em 0;
        }
        .tiptap-editor .ProseMirror ul {
          padding-left: 1.5rem;
          list-style: disc outside !important;
          margin-left: 1rem;
        }
        .tiptap-editor .ProseMirror ol {
          padding-left: 1.5rem;
          list-style: decimal outside !important;
          margin-left: 1rem;
        }
        .tiptap-editor .ProseMirror li {
          margin: 0.25em 0;
          display: list-item !important;
        }
        .tiptap-editor .ProseMirror h1 { font-size: 2em; font-weight: bold; margin: 0.5em 0; }
        .tiptap-editor .ProseMirror h2 { font-size: 1.5em; font-weight: bold; margin: 0.5em 0; }
        .tiptap-editor .ProseMirror h3 { font-size: 1.25em; font-weight: bold; margin: 0.5em 0; }
        .tiptap-editor .ProseMirror h4 { font-size: 1.1em; font-weight: bold; margin: 0.5em 0; }
        .tiptap-editor .ProseMirror h5 { font-size: 1em; font-weight: bold; margin: 0.5em 0; }
        .tiptap-editor .ProseMirror h6 { font-size: 0.9em; font-weight: bold; margin: 0.5em 0; }
        .tiptap-editor .ProseMirror code {
          background: #f0f0f0;
          padding: 0.2em 0.4em;
          border-radius: 3px;
          font-family: monospace;
        }
        .tiptap-editor .ProseMirror pre {
          background: #f3f4f6;
          color: #1f2937;
          padding: 1rem;
          border-radius: 6px;
          overflow-x: auto;
          margin: 0.5em 0;
          border: 1px solid #e5e7eb;
        }
        .tiptap-editor .ProseMirror pre code {
          background: none;
          padding: 0;
          color: inherit;
          font-size: 0.9em;
        }
        .tiptap-editor .ProseMirror blockquote {
          border-left: 3px solid #ccc;
          padding-left: 1rem;
          margin-left: 0;
          color: #666;
        }
        .tiptap-editor .ProseMirror s {
          text-decoration: line-through;
        }
        .tiptap-editor .ProseMirror a {
          color: #2563eb;
          text-decoration: underline;
        }
        .tiptap-editor .ProseMirror hr {
          border: none;
          border-top: 2px solid #e5e7eb;
          margin: 1em 0;
        }
        .tiptap-editor .ProseMirror ul[data-type="taskList"] {
          list-style: none !important;
          padding-left: 0 !important;
          margin-left: 0 !important;
        }
        .tiptap-editor .ProseMirror ul[data-type="taskList"] > li {
          display: flex !important;
          flex-direction: row !important;
          align-items: baseline !important;
          gap: 0.5rem;
          margin: 0.25em 0;
        }
        .tiptap-editor .ProseMirror ul[data-type="taskList"] > li > label {
          display: inline-flex;
          flex-shrink: 0;
          user-select: none;
        }
        .tiptap-editor .ProseMirror ul[data-type="taskList"] > li > label input[type="checkbox"] {
          width: 1rem;
          height: 1rem;
          cursor: pointer;
        }
        .tiptap-editor .ProseMirror ul[data-type="taskList"] > li > div {
          flex: 1;
          display: inline;
        }
        .tiptap-editor .ProseMirror ul[data-type="taskList"] > li > div > p {
          margin: 0;
          display: inline;
        }
        .tiptap-editor .ProseMirror ul[data-type="taskList"] > li[data-checked="true"] > div {
          text-decoration: line-through;
          color: #9ca3af;
        }
        .tiptap-editor .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
          display: inline;
          vertical-align: bottom;
        }
        .tiptap-editor .ProseMirror img.ProseMirror-selectednode {
          outline: 2px solid #2563eb;
        }
      `}</style>
    </div>
  );
}

import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Muya, InlineFormatToolbar, EmojiSelector, CodeBlockLanguageSelector, replaceBlockByLabel } from '@muyajs/core';
import '@muyajs/core/lib/core.css';

// Register plugins once at module load
if (!Muya.plugins?.length) {
  Muya.use(InlineFormatToolbar);
  Muya.use(EmojiSelector);
  Muya.use(CodeBlockLanguageSelector);
}

export const MuyaEditor = forwardRef(function MuyaEditor({ initialValue = '', onDirtyChange, onReady, onBlockChange }, ref) {
  const containerRef = useRef(null);
  const muyaRef = useRef(null);
  const lastDirtyRef = useRef(false);
  // Track clean point using undo/redo stack lengths
  const cleanUndoLengthRef = useRef(0);
  const cleanRedoLengthRef = useRef(0);
  const initializedRef = useRef(false);
  const keyDownHandlerRef = useRef(null);

  // Initialize Muya
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    // Create wrapper div (Muya replaces the container element)
    const wrapperDiv = document.createElement('div');
    containerRef.current.appendChild(wrapperDiv);

    const muya = new Muya(wrapperDiv, {
      markdown: initialValue || '',
      hideQuickInsertHint: true, // Disable "Type / to insert..." placeholder
    });

    muya.init();
    muyaRef.current = muya;

    // Record initial history state
    cleanUndoLengthRef.current = muya.editor.history._stack?.undo?.length || 0;
    cleanRedoLengthRef.current = muya.editor.history._stack?.redo?.length || 0;

    // Notify parent of initial dirty state (no serialization needed)
    onDirtyChange?.(false);

    // Signal that editor is ready after content has actually rendered
    // For large documents, the browser needs multiple frames to paint all content
    const waitForContent = () => {
      // Check if content has been rendered by looking for paragraph elements
      const editorEl = muya.domNode;
      const hasContent = editorEl && (
        // Either editor has visible text content
        editorEl.textContent?.trim().length > 0 ||
        // Or it has paragraph elements (even if empty - for empty documents)
        editorEl.querySelector('.mu-paragraph')
      );

      if (hasContent) {
        // Content exists, wait one more frame for paint to complete
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            onReady?.();
          });
        });
      } else {
        // Content not yet rendered, check again next frame
        requestAnimationFrame(waitForContent);
      }
    };

    // Start checking after init completes
    requestAnimationFrame(waitForContent);

    // Helper to get current block info and notify parent
    const notifyBlockChange = () => {
      if (!onBlockChange || !muyaRef.current) return;

      const selection = muya.editor.selection.getSelection();
      const anchorBlock = selection?.anchorBlock;
      const block = anchorBlock?.parent;

      if (!block) {
        onBlockChange({ headingLevel: null, listType: null });
        return;
      }

      // Determine heading level
      let headingLevel = null;
      if (block.blockName === 'paragraph') {
        headingLevel = 0;
      } else if (block.blockName === 'atx-heading') {
        // Get heading level from meta or block properties
        headingLevel = block.meta?.level || parseInt(block.children?.[0]?.text?.match(/^#{1,6}/)?.[0]?.length) || 1;
      }

      // Determine list type by checking parent hierarchy
      let listType = null;
      let current = block;
      while (current) {
        if (current.blockName === 'bullet-list') {
          listType = 'bullet-list';
          break;
        } else if (current.blockName === 'order-list') {
          listType = 'order-list';
          break;
        } else if (current.blockName === 'task-list') {
          listType = 'task-list';
          break;
        }
        current = current.parent;
      }

      onBlockChange({ headingLevel, listType });
    };

    // Listen for selection changes
    muya.on('selection-change', notifyBlockChange);

    // Listen for content changes - O(1) dirty check using history stack lengths
    // (no serialization needed - content is fetched on-demand via getContent())
    muya.on('json-change', () => {
      // Also notify of block change (block type may have changed)
      notifyBlockChange();
      if (!muyaRef.current) return;

      // O(1) dirty check: compare history stack lengths
      const undoLen = muya.editor.history._stack?.undo?.length || 0;
      const redoLen = muya.editor.history._stack?.redo?.length || 0;
      const isDirty = undoLen !== cleanUndoLengthRef.current || redoLen !== cleanRedoLengthRef.current;

      if (isDirty !== lastDirtyRef.current) {
        lastDirtyRef.current = isDirty;
        onDirtyChange?.(isDirty);
      }
    });

    // Handle undo/redo through both beforeinput AND keydown
    // beforeinput is the standard way, but Playwright may only trigger keydown
    const handleBeforeInput = (e) => {
      if (!muyaRef.current) return;
      if (!containerRef.current?.contains(e.target)) return;

      if (e.inputType === 'historyUndo') {
        e.preventDefault();
        muyaRef.current.undo();
      } else if (e.inputType === 'historyRedo') {
        e.preventDefault();
        muyaRef.current.redo();
      }
    };

    // Handle keydown for Ctrl+Z and Ctrl+Y
    const handleKeyDown = (e) => {
      if (!muyaRef.current) return;

      // Accept both Ctrl and Cmd for cross-platform support
      const modKey = e.ctrlKey || e.metaKey;

      // Typora-style heading shortcuts: Cmd+1-6 for headings, Cmd+0 for paragraph
      if (modKey && !e.shiftKey && !e.altKey) {
        const key = e.key;
        let label = null;

        if (key >= '1' && key <= '6') {
          label = `atx-heading ${key}`;
        } else if (key === '0') {
          label = 'paragraph';
        }

        if (label) {
          e.preventDefault();
          e.stopPropagation();

          // Get the current block
          const muya = muyaRef.current;

          // Flush any pending operations to ensure we get the latest content
          // (operations are batched with requestAnimationFrame, so typing may not be reflected yet)
          muya.editor.jsonState.flush?.();

          const selection = muya.editor.selection.getSelection();
          const anchorBlock = selection?.anchorBlock;
          const block = anchorBlock?.parent;

          if (block) {
            // Preserve text content by stripping markdown prefixes
            // Try to get text from the block's children first, fallback to DOM content
            let rawText = block.children[0]?.text || '';

            // If rawText is empty, try to get content from the DOM node
            if (!rawText && anchorBlock?.domNode) {
              rawText = anchorBlock.domNode.textContent || '';
            }

            const text = block.blockName === 'paragraph'
              ? rawText
              : rawText.replace(/^ {0,3}#{1,6}(?:\s+|$)/, '');

            // Convert the block to the target type
            replaceBlockByLabel({ block, muya, label, text });
          }
          return;
        }
      }

      // Handle Ctrl+Z / Cmd+Z for undo, Ctrl+Shift+Z / Cmd+Shift+Z for redo
      if (modKey && (e.key === 'z' || e.key === 'Z')) {
        // Only skip if focus is on a different input element (not our editor)
        const activeEl = document.activeElement;
        const focusOnOtherInput = (activeEl?.tagName === 'INPUT' ||
                                   activeEl?.tagName === 'TEXTAREA') &&
                                  !containerRef.current?.contains(activeEl);

        // Skip if focus is on another input/textarea
        if (focusOnOtherInput) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          muyaRef.current.redo();
        } else {
          muyaRef.current.undo();
        }
        // Explicitly check dirty state after undo/redo
        // (json-change fires but we want to ensure immediate dirty check)
        setTimeout(() => {
          const muya = muyaRef.current;
          if (!muya) return;
          const undoLen = muya.editor.history._stack?.undo?.length || 0;
          const redoLen = muya.editor.history._stack?.redo?.length || 0;
          const isDirty = undoLen !== cleanUndoLengthRef.current || redoLen !== cleanRedoLengthRef.current;
          if (isDirty !== lastDirtyRef.current) {
            lastDirtyRef.current = isDirty;
            onDirtyChange?.(isDirty);
          }
        }, 0);
      }
      // Ctrl+Y for redo on Windows/Linux (also works on Mac via Ctrl)
      if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
        const activeEl = document.activeElement;
        const focusOnOtherInput = (activeEl?.tagName === 'INPUT' ||
                                   activeEl?.tagName === 'TEXTAREA') &&
                                  !containerRef.current?.contains(activeEl);

        if (focusOnOtherInput) return;

        e.preventDefault();
        e.stopPropagation();
        muyaRef.current.redo();
        // Explicitly check dirty state after redo
        setTimeout(() => {
          const muya = muyaRef.current;
          if (!muya) return;
          const undoLen = muya.editor.history._stack?.undo?.length || 0;
          const redoLen = muya.editor.history._stack?.redo?.length || 0;
          const isDirty = undoLen !== cleanUndoLengthRef.current || redoLen !== cleanRedoLengthRef.current;
          if (isDirty !== lastDirtyRef.current) {
            lastDirtyRef.current = isDirty;
            onDirtyChange?.(isDirty);
          }
        }, 0);
      }

      // Handle End/Home keys for mobile compatibility (issue #26)
      // Mobile browsers don't always handle these keys correctly in contentEditable
      if (e.key === 'End' || e.key === 'Home') {
        const muya = muyaRef.current;
        if (!muya) return;

        const selection = muya.editor.selection.getSelection();
        const anchorBlock = selection?.anchorBlock;
        if (!anchorBlock) return;

        e.preventDefault();
        e.stopPropagation();

        const textLength = anchorBlock.text?.length || 0;
        if (e.key === 'End') {
          // Move cursor to end of current content block
          anchorBlock.setCursor(textLength, textLength, true);
        } else {
          // Move cursor to start of current content block
          anchorBlock.setCursor(0, 0, true);
        }
      }
    };

    keyDownHandlerRef.current = { handleBeforeInput, handleKeyDown };
    document.addEventListener('beforeinput', handleBeforeInput, true);
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      if (muya) {
        muya.destroy();
      }
      if (keyDownHandlerRef.current) {
        document.removeEventListener('beforeinput', keyDownHandlerRef.current.handleBeforeInput, true);
        document.removeEventListener('keydown', keyDownHandlerRef.current.handleKeyDown, true);
      }
    };
  }, []); // Only run once on mount

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    markClean: () => {
      if (muyaRef.current) {
        const muya = muyaRef.current;
        cleanUndoLengthRef.current = muya.editor.history._stack?.undo?.length || 0;
        cleanRedoLengthRef.current = muya.editor.history._stack?.redo?.length || 0;
        // Reset history delay timer so next change starts a new undo entry
        // (prevents new typing from being composed with pre-save operations)
        muya.editor.history.cutoff?.();
        lastDirtyRef.current = false;
        onDirtyChange?.(false);
      }
    },
    getContent: () => {
      if (muyaRef.current) {
        const muya = muyaRef.current;

        // WORKAROUND for iPad (issue #26): Force blur/focus to commit any pending iOS input
        // iOS holds predictive/autocorrect text in a composition buffer until blur
        const activeEl = document.activeElement;
        if (activeEl && muya.domNode?.contains(activeEl)) {
          activeEl.blur();
          activeEl.focus();
        }

        // Flush any pending operations to ensure we get the latest content
        muya.editor.jsonState.flush?.();

        // WORKAROUND for iPad: Force sync text from DOM to internal state
        // On iPad, input events sometimes don't update Muya's internal state
        const syncContentFromDOM = (block) => {
          if (!block) return;
          if (block.domNode && typeof block._text !== 'undefined') {
            const domText = block.domNode.textContent || '';
            if (block._text !== domText) {
              block._text = domText;
            }
          }
          if (block.children) {
            let child = block.children.head;
            while (child) {
              syncContentFromDOM(child);
              child = child.next;
            }
          }
        };
        syncContentFromDOM(muya.editor.scrollPage);

        return muya.getMarkdown();
      }
      return '';
    },
    // Force a dirty state check (useful after undo/redo)
    checkDirty: () => {
      if (muyaRef.current) {
        const muya = muyaRef.current;
        const undoLen = muya.editor.history._stack?.undo?.length || 0;
        const redoLen = muya.editor.history._stack?.redo?.length || 0;
        const isDirty = undoLen !== cleanUndoLengthRef.current || redoLen !== cleanRedoLengthRef.current;
        if (isDirty !== lastDirtyRef.current) {
          lastDirtyRef.current = isDirty;
          onDirtyChange?.(isDirty);
        }
      }
    },
    // Toolbar methods
    format: (type) => {
      // Apply inline format to current selection/word
      // type can be: 'strong', 'em', 'u', 'inline_code', 'del'
      const muya = muyaRef.current;
      if (!muya) return;

      const selection = muya.editor.selection.getSelection();
      const block = selection?.anchorBlock;
      if (block && typeof block.format === 'function') {
        block.format(type);
      }
    },
    setHeading: (level) => {
      // Convert current block to heading of specified level (1-6) or paragraph (0)
      const muya = muyaRef.current;
      if (!muya) return;

      // Flush any pending operations
      muya.editor.jsonState.flush?.();

      const selection = muya.editor.selection.getSelection();
      const anchorBlock = selection?.anchorBlock;
      const block = anchorBlock?.parent;

      if (block) {
        // Level 0 means paragraph
        const label = level === 0 ? 'paragraph' : `atx-heading ${level}`;
        // Get text content, stripping any existing heading markers
        let rawText = block.children[0]?.text || '';
        if (!rawText && anchorBlock?.domNode) {
          rawText = anchorBlock.domNode.textContent || '';
        }
        const text = block.blockName === 'paragraph'
          ? rawText
          : rawText.replace(/^ {0,3}#{1,6}(?:\s+|$)/, '');

        replaceBlockByLabel({ block, muya, label, text });
      }
    },
    setList: (type) => {
      // Convert current block to list (bullet-list, order-list, task-list) or paragraph
      const muya = muyaRef.current;
      if (!muya) return;

      muya.editor.jsonState.flush?.();

      const selection = muya.editor.selection.getSelection();
      const anchorBlock = selection?.anchorBlock;
      let block = anchorBlock?.parent;

      if (!block) return;

      // If converting to paragraph from a list, we need to find the list block
      if (type === 'paragraph') {
        // Find the list wrapper (bullet-list, order-list, task-list)
        let list = block;
        while (list && !['bullet-list', 'order-list', 'task-list'].includes(list.blockName)) {
          list = list.parent;
        }

        if (list) {
          // Get text from the current paragraph/content block
          let text = block.children?.[0]?.text || '';
          if (!text && anchorBlock?.domNode) {
            text = anchorBlock.domNode.textContent || '';
          }
          // Replace the list with a paragraph
          replaceBlockByLabel({ block: list, muya, label: 'paragraph', text });
        }
        return;
      }

      // Get text content
      let rawText = block.children[0]?.text || '';
      if (!rawText && anchorBlock?.domNode) {
        rawText = anchorBlock.domNode.textContent || '';
      }
      // Strip heading markers if any
      const text = block.blockName === 'paragraph'
        ? rawText
        : rawText.replace(/^ {0,3}#{1,6}(?:\s+|$)/, '');

      replaceBlockByLabel({ block, muya, label: type, text });
    },
    indent: () => {
      // Increase indent of current list item
      const muya = muyaRef.current;
      if (!muya) return;

      const selection = muya.editor.selection.getSelection();
      const anchorBlock = selection?.anchorBlock;

      // indentListItem is a method on paragraph content blocks inside list items
      if (anchorBlock && typeof anchorBlock._indentListItem === 'function') {
        anchorBlock._indentListItem();
      }
    },
    outdent: () => {
      // Decrease indent of current list item
      const muya = muyaRef.current;
      if (!muya) return;

      const selection = muya.editor.selection.getSelection();
      const anchorBlock = selection?.anchorBlock;

      // unindentListItem is a method on paragraph content blocks inside list items
      if (anchorBlock && typeof anchorBlock._unindentListItem === 'function') {
        anchorBlock._unindentListItem();
      }
    },
    removeList: () => {
      // Convert list item to paragraph
      const muya = muyaRef.current;
      if (!muya) return;

      muya.editor.jsonState.flush?.();

      const selection = muya.editor.selection.getSelection();
      const anchorBlock = selection?.anchorBlock;
      const block = anchorBlock?.parent;

      if (!block) return;

      // Find the list (not list-item) to get proper replacement
      let list = block;
      while (list && !['bullet-list', 'order-list', 'task-list'].includes(list.blockName)) {
        list = list.parent;
      }

      if (list) {
        // Get text from the current paragraph/content block
        let text = block.children?.[0]?.text || '';
        if (!text && anchorBlock?.domNode) {
          text = anchorBlock.domNode.textContent || '';
        }
        // Replace the list with a paragraph
        replaceBlockByLabel({ block: list, muya, label: 'paragraph', text });
      }
    },
  }), [onDirtyChange]);

  return (
    <div className="muya-editor-wrapper" ref={containerRef}>
      <style>{`
        .muya-editor-wrapper {
          width: 100%;
          min-height: 400px;
        }
        .muya-editor-wrapper .mu-editor {
          padding: 2rem 15%;
          outline: none;
        }
        @media (max-width: 900px) {
          .muya-editor-wrapper .mu-editor {
            padding: 1.5rem 5%;
          }
        }
      `}</style>
    </div>
  );
});

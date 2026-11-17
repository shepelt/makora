import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { CodeBlockLanguageSelector, InlineFormatToolbar, Muya } from '@muyajs/core';
import '@muyajs/core/lib/core.css';
import { patchMuyaPerformance } from './muyaPatches';

let pluginsRegistered = false;
function registerPlugins() {
  if (pluginsRegistered) return;
  pluginsRegistered = true;
  Muya.use(InlineFormatToolbar);
  Muya.use(CodeBlockLanguageSelector);
}

export type EditorHandle = {
  // Current markdown. Async because Muya batches edits per animation frame,
  // and iOS may still hold text in an uncommitted composition.
  getMarkdown: () => Promise<string>;
  focus: () => void;
};

type Props = {
  markdown: string;
  onChange: () => void; // signal only; no serialization on keystrokes
  onReady?: () => void;
};

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ markdown, onChange, onReady }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const muyaRef = useRef<Muya | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    registerPlugins();
    const host = hostRef.current!;
    const mount = document.createElement('div'); // Muya replaces its element
    host.appendChild(mount);

    performance.mark('muya:start');
    const muya = new Muya(mount, {
      markdown,
      hideQuickInsertHint: true,
      preferLooseListItem: false,
      spellcheckEnabled: false,
      autoPairMarkdownSyntax: false,
    });
    patchMuyaPerformance(muya);
    muya.init();
    performance.mark('muya:init');
    muyaRef.current = muya;

    // `json-change` also fires for the initial render; only count user edits.
    const handler = ({ source }: { source?: string }) => {
      if (source === 'user') onChangeRef.current();
    };
    muya.on('json-change', handler);

    // Tab / Shift+Tab: indent list items without losing focus (#34 on main).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !host.contains(e.target as Node)) return;
      const block: any = (muya.editor as any).selection.getSelection()?.anchorBlock;
      if (block && typeof block.tabHandler === 'function') {
        e.preventDefault();
        block.tabHandler(e);
      }
    };
    host.addEventListener('keydown', onKeyDown, true);

    requestAnimationFrame(() => {
      performance.mark('muya:painted');
      onReady?.();
    });

    return () => {
      host.removeEventListener('keydown', onKeyDown, true);
      muya.off('json-change', handler);
      muya.destroy();
      muyaRef.current = null;
      host.innerHTML = '';
    };
    // The editor is keyed by file in the parent; markdown is initial content only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    async getMarkdown() {
      const muya = muyaRef.current;
      if (!muya) return markdown;
      // iOS keeps text in the composition buffer until it's committed; make
      // sure the active block's model matches what's on screen before saving.
      const block: any = (muya.editor as any).activeContentBlock;
      if (block?.domNode && block.isComposed === false) {
        const domText = block.domNode.textContent ?? '';
        if (block.text !== domText) block.text = domText;
      }
      // Let Muya apply its batched operations (flushed on the next frame).
      const state: any = (muya.editor as any).jsonState;
      for (let i = 0; i < 5 && (i < 2 || state?._isGoing); i++) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return muyaRef.current ? muya.getMarkdown() : markdown;
    },
    focus() {
      muyaRef.current?.focus();
    },
  }));

  return <div ref={hostRef} className="makora-editor" />;
});

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { CodeBlockLanguageSelector, InlineFormatToolbar, Muya } from '@muyajs/core';
import '@muyajs/core/lib/core.css';
import { patchMuyaPerformance } from './muyaPatches';
import * as cmd from './blockCommands';
import type { BlockInfo } from './blockCommands';

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
  format: (type: string) => void;
  setHeading: (level: number) => void;
  setList: (type: string) => void;
  indent: () => void;
  outdent: () => void;
};

type Props = {
  markdown: string;
  onChange: () => void; // signal only; no serialization on keystrokes
  onReady?: () => void;
  onBlockChange?: (info: BlockInfo) => void;
  preventAutoFocus?: boolean;
};

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { markdown, onChange, onReady, onBlockChange, preventAutoFocus },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const muyaRef = useRef<Muya | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBlockChangeRef = useRef(onBlockChange);
  onBlockChangeRef.current = onBlockChange;

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

    if (preventAutoFocus) {
      // Don't pop up the on-screen keyboard just because a file opened.
      requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.blur?.());
    }

    const notifyBlock = () => onBlockChangeRef.current?.(cmd.getBlockInfo(muya));

    // `json-change` also fires for the initial render; only count user edits.
    const handler = ({ source }: { source?: string }) => {
      if (source === 'user') onChangeRef.current();
      notifyBlock();
    };
    muya.on('json-change', handler);
    muya.on('selection-change', notifyBlock);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!host.contains(e.target as Node)) return;
      const mod = e.metaKey || e.ctrlKey;
      // Tab / Shift+Tab: indent list items without losing focus (#34 on main).
      if (e.key === 'Tab') {
        const block: any = (muya.editor as any).selection.getSelection()?.anchorBlock;
        if (block && typeof block.tabHandler === 'function') {
          e.preventDefault();
          block.tabHandler(e);
        }
        return;
      }
      if (!mod || e.altKey) return;
      // Typora-style block shortcuts, as on main.
      if (!e.shiftKey && /^[0-6]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        cmd.setHeading(muya, Number(e.key));
        return;
      }
      if (e.shiftKey) {
        const k = e.key.toLowerCase();
        const action: Record<string, () => void> = {
          q: () => cmd.setBlockType(muya, 'block-quote'),
          k: () => cmd.setBlockType(muya, 'code-block'),
          o: () => cmd.setList(muya, 'order-list'),
          u: () => cmd.setList(muya, 'bullet-list'),
        };
        if (action[k]) {
          e.preventDefault();
          e.stopPropagation();
          action[k]();
        }
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
      muya.off('selection-change', notifyBlock);
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
    format: (type) => muyaRef.current && cmd.format(muyaRef.current, type),
    setHeading: (level) => muyaRef.current && cmd.setHeading(muyaRef.current, level),
    setList: (type) => muyaRef.current && cmd.setList(muyaRef.current, type),
    indent: () => muyaRef.current && cmd.indent(muyaRef.current),
    outdent: () => muyaRef.current && cmd.outdent(muyaRef.current),
  }));

  return <div ref={hostRef} className="muya-editor-wrapper makora-editor" />;
});

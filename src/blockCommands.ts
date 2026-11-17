// Block-level editing commands for the toolbar and keyboard shortcuts, on
// upstream Muya's public API (develop): format() and updateParagraph(), the
// same entry points MarkText's own menus use.
import type { Muya } from '@muyajs/core';

export type BlockInfo = { headingLevel: number | null; listType: string | null };

const LIST_TYPES = ['bullet-list', 'order-list', 'task-list'];
const LIST_COMMAND: Record<string, string> = {
  'bullet-list': 'ul-bullet',
  'order-list': 'ol-order',
  'task-list': 'ul-task',
};

function active(muya: Muya): any {
  return (muya.editor as any).activeContentBlock ?? null;
}

export function getBlockInfo(muya: Muya): BlockInfo {
  const block = active(muya)?.parent;
  if (!block) return { headingLevel: null, listType: null };
  let headingLevel: number | null = null;
  if (block.blockName === 'paragraph') headingLevel = 0;
  else if (block.blockName === 'atx-heading' || block.blockName === 'setext-heading') headingLevel = block.meta?.level ?? 1;
  let listType: string | null = null;
  for (let cur = block; cur; cur = cur.parent) {
    if (LIST_TYPES.includes(cur.blockName)) {
      listType = cur.blockName;
      break;
    }
  }
  return { headingLevel, listType };
}

export function setHeading(muya: Muya, level: number) {
  if (level === 0) {
    const info = getBlockInfo(muya);
    if (info.headingLevel) muya.updateParagraph(`heading ${info.headingLevel}`); // toggles back to paragraph
    return;
  }
  muya.updateParagraph(`heading ${level}`);
}

export function setBlockType(muya: Muya, label: 'block-quote' | 'code-block') {
  muya.updateParagraph(label === 'block-quote' ? 'blockquote' : 'pre');
}

// `type` is a list block name, or 'paragraph' to turn the current list off.
export function setList(muya: Muya, type: string) {
  if (type === 'paragraph') {
    const current = getBlockInfo(muya).listType;
    if (current) muya.updateParagraph(LIST_COMMAND[current]); // same type toggles off
    return;
  }
  const command = LIST_COMMAND[type];
  if (command) muya.updateParagraph(command);
}

export function format(muya: Muya, type: string) {
  muya.format(type);
}

export function indent(muya: Muya) {
  const a = active(muya);
  if (a && typeof a._indentListItem === 'function') {
    if (typeof a._canIndentListItem === 'function' && !a._canIndentListItem()) return;
    muya.transact(() => a._indentListItem());
  }
}

export function outdent(muya: Muya) {
  const a = active(muya);
  if (a && typeof a._unindentListItem === 'function') {
    const type = a._getUnindentType?.();
    if (type != null) muya.transact(() => a._unindentListItem(type));
  }
}

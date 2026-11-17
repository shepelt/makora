// Block-level editing commands for the toolbar and keyboard shortcuts.
// Ported from the Meteor version's MuyaEditor (main branch). The fork it used
// exported `replaceBlockByLabel`; upstream doesn't, so this rebuilds it from
// public pieces (ScrollPage.loadBlock + Block.replaceWith) using the same
// block templates Muya uses internally.
import type { Muya } from '@muyajs/core';

export type BlockInfo = { headingLevel: number | null; listType: string | null };

const LIST_TYPES = ['bullet-list', 'order-list', 'task-list'];

function anchor(muya: Muya): any {
  return (muya.editor as any).selection.getSelection()?.anchorBlock ?? null;
}

export function getBlockInfo(muya: Muya): BlockInfo {
  const block = anchor(muya)?.parent;
  if (!block) return { headingLevel: null, listType: null };
  let headingLevel: number | null = null;
  if (block.blockName === 'paragraph') headingLevel = 0;
  else if (block.blockName === 'atx-heading') headingLevel = block.meta?.level ?? 1;
  let listType: string | null = null;
  for (let cur = block; cur; cur = cur.parent) {
    if (LIST_TYPES.includes(cur.blockName)) {
      listType = cur.blockName;
      break;
    }
  }
  return { headingLevel, listType };
}

function template(label: string, text: string, muya: Muya): any {
  const opts: any = muya.options;
  const item = (name: string) =>
    name === 'task-list'
      ? { name: 'task-list-item', meta: { checked: false }, children: [{ name: 'paragraph', text }] }
      : { name: 'list-item', children: [{ name: 'paragraph', text }] };
  const heading = label.match(/^atx-heading (\d)$/);
  if (heading) {
    const level = Number(heading[1]);
    return { name: 'atx-heading', meta: { level }, text: `${'#'.repeat(level)} ${text}` };
  }
  switch (label) {
    case 'paragraph':
      return { name: 'paragraph', text };
    case 'block-quote':
      return { name: 'block-quote', children: [{ name: 'paragraph', text }] };
    case 'code-block':
      return { name: 'code-block', meta: { type: 'fenced', lang: '' }, text };
    case 'order-list':
      return { name: 'order-list', meta: { start: 1, loose: opts.preferLooseListItem, delimiter: opts.orderListDelimiter || '.' }, children: [item(label)] };
    case 'bullet-list':
    case 'task-list':
      return { name: label, meta: { marker: opts.bulletListMarker || '-', loose: opts.preferLooseListItem }, children: [item(label)] };
    default:
      return null;
  }
}

function replaceBlock(muya: Muya, block: any, label: string, text: string) {
  const state = template(label, text, muya);
  if (!state || !block) return;
  const ScrollPage = (muya.editor as any).scrollPage.constructor;
  const name = state.name;
  const next = ScrollPage.loadBlock(name).create(muya, state);
  block.replaceWith(next);
  const content = next.firstContentInDescendant();
  const end = content.text.length;
  content.setCursor(end, end, true);
}

function currentText(block: any, anchorBlock: any): string {
  let text: string = block.children?.[0]?.text ?? block.children?.head?.text ?? '';
  if (!text && anchorBlock?.domNode) text = anchorBlock.domNode.textContent ?? '';
  return text;
}

export function setHeading(muya: Muya, level: number) {
  const a = anchor(muya);
  const block = a?.parent;
  if (!block) return;
  const raw = a?.text ?? currentText(block, a);
  const text = block.blockName === 'atx-heading' ? raw.replace(/^ {0,3}#{1,6}(?:\s+|$)/, '') : raw;
  replaceBlock(muya, block, level === 0 ? 'paragraph' : `atx-heading ${level}`, text);
}

export function setBlockType(muya: Muya, label: 'block-quote' | 'code-block') {
  const a = anchor(muya);
  const block = a?.parent;
  if (!block) return;
  const raw = a?.text ?? '';
  replaceBlock(muya, block, label, block.blockName === 'atx-heading' ? raw.replace(/^ {0,3}#{1,6}(?:\s+|$)/, '') : raw);
}

export function setList(muya: Muya, type: string) {
  const a = anchor(muya);
  const block = a?.parent;
  if (!block) return;
  const text = a?.text ?? '';
  if (type === 'paragraph') {
    let list = block;
    while (list && !LIST_TYPES.includes(list.blockName)) list = list.parent;
    if (list) replaceBlock(muya, list, 'paragraph', text);
    return;
  }
  const plain = block.blockName === 'atx-heading' ? text.replace(/^ {0,3}#{1,6}(?:\s+|$)/, '') : text;
  let list = block;
  while (list && !LIST_TYPES.includes(list.blockName)) list = list.parent;
  if (!list) {
    replaceBlock(muya, block, type, plain);
    return;
  }
  if (list.blockName === type) return;
  // Inside a list of another type: convert the whole list, keeping all items.
  const state = list.getState();
  const opts: any = muya.options;
  const converted = {
    name: type,
    meta:
      type === 'order-list'
        ? { start: 1, loose: state.meta?.loose ?? false, delimiter: opts.orderListDelimiter || '.' }
        : { marker: state.meta?.marker || opts.bulletListMarker || '-', loose: state.meta?.loose ?? false },
    children: state.children.map((child: any) =>
      type === 'task-list'
        ? { name: 'task-list-item', meta: { checked: child.meta?.checked ?? false }, children: child.children }
        : { name: 'list-item', children: child.children },
    ),
  };
  const ScrollPage = (muya.editor as any).scrollPage.constructor;
  const next = ScrollPage.loadBlock(type).create(muya, converted);
  list.replaceWith(next);
  const content = next.firstContentInDescendant();
  content.setCursor(content.text.length, content.text.length, true);
}

export function format(muya: Muya, type: string) {
  const a = anchor(muya);
  if (a && typeof a.format === 'function') a.format(type);
}

export function indent(muya: Muya) {
  const a = anchor(muya);
  if (a && typeof a._indentListItem === 'function') {
    if (typeof a._canIndentListItem === 'function' && !a._canIndentListItem()) return;
    a._indentListItem();
  }
}

export function outdent(muya: Muya) {
  const a = anchor(muya);
  if (a && typeof a._unindentListItem === 'function') {
    const type = a._getUnindentType?.();
    if (type != null) a._unindentListItem(type);
  }
}

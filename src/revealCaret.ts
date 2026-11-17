// Keep the caret visible. Muya leaves scrolling to the host (MarkText's
// desktop app does it there); moving the caret between blocks with the
// keyboard is programmatic, so the browser won't scroll for us.
const MARGIN = 48;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let cur = el?.parentElement ?? null; cur; cur = cur.parentElement) {
    const { overflowY } = getComputedStyle(cur);
    if (overflowY === 'auto' || overflowY === 'scroll') return cur;
  }
  return null;
}

function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(sel.focusNode === range.endContainer && sel.focusOffset === range.endOffset ? false : true);
  const rects = range.getClientRects();
  if (rects.length) return rects[rects.length - 1];
  // Empty block / collapsed at a boundary: use the containing element.
  const node = sel.focusNode;
  const el = node instanceof HTMLElement ? node : node?.parentElement;
  return el ? el.getBoundingClientRect() : null;
}

export function revealCaret(host: HTMLElement) {
  const sel = window.getSelection();
  if (!sel?.focusNode || !host.contains(sel.focusNode)) return;
  const scroller = scrollParent(host);
  const rect = caretRect();
  if (!scroller || !rect) return;
  const view = scroller.getBoundingClientRect();
  if (rect.bottom > view.bottom - MARGIN) scroller.scrollTop += rect.bottom - (view.bottom - MARGIN);
  else if (rect.top < view.top + MARGIN) scroller.scrollTop -= view.top + MARGIN - rect.top;
}

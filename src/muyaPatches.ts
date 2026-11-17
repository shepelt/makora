import type { Muya } from '@muyajs/core';

// Performance fix for upstream Muya (to be sent upstream, see #43):
// InlineRenderer.patch() calls collectReferenceDefinitions() for every block
// it renders, and that deep-clones the whole document (structuredClone via
// jsonState.getState()) just to find `[label]: url` definitions. That is
// O(blocks²) on load (80s for a 4.5k-block log at 4x CPU throttle) and O(doc)
// per keystroke. Read the internal state without cloning, and rescan only
// when the state object changed (ot-json1 apply returns a new root).
let referencePatched = false;
export function patchMuyaPerformance(muya: Muya) {
  patchStateChange(muya);
  if (referencePatched) return;
  const proto = Object.getPrototypeOf((muya.editor as any).inlineRenderer);
  if (typeof proto?.collectReferenceDefinitions !== 'function' || typeof proto.getLabelInfo !== 'function') return;
  referencePatched = true;
  proto.collectReferenceDefinitions = function (this: any) {
    const state = this.muya.editor.jsonState._state;
    if (state && state === this.__labelsFor && this.labels) return;
    const labels = new Map();
    const walk = (blocks: any[]) => {
      for (const b of blocks) {
        if (b.name === 'paragraph') {
          const { label, info } = this.getLabelInfo(b);
          if (label && info) labels.set(label, info);
        } else if (Array.isArray(b.children) && b.children.length) {
          walk(b.children);
        }
      }
    };
    if (Array.isArray(state)) walk(state);
    this.labels = labels;
    this.__labelsFor = state;
  };
}

// Second fix: JSONState emits `json-change` with prevDoc/doc built by
// getState(), i.e. two whole-document structuredClones per edited frame.
// ot-json1's apply() never mutates its input (verified with deep-frozen
// documents), so the previous and next state objects can be passed as-is.
// The only consumer of prevDoc is History, which reads it.
let stateChangePatched = false;
function patchStateChange(muya: Muya) {
  if (stateChangePatched) return;
  const proto = Object.getPrototypeOf((muya.editor as any).jsonState);
  const ctor = proto?.constructor;
  if (typeof proto?._emitStateChange !== 'function' || typeof ctor?.compose !== 'function') return;
  stateChangePatched = true;
  proto._emitStateChange = function (this: any) {
    if (this._isGoing) return;
    this._isGoing = true;
    requestAnimationFrame(() => {
      const ops = this._operationCache;
      this._operationCache = [];
      this._isGoing = false;
      if (!ops.length) return;
      const op = ops.reduce((a: any, b: any) => ctor.compose(a, b));
      const prevDoc = this._state;
      this.apply(op);
      this.muya.eventCenter.emit('json-change', { op, source: 'user', prevDoc, doc: this._state });
    });
  };
  proto.dispatch = function (this: any, op: any, source = 'user') {
    const prevDoc = this._state;
    this.apply(op);
    this.muya.eventCenter.emit('json-change', { op, source, prevDoc, doc: this._state });
  };
}


// Third fix: Enter at the start of an ATX heading inserts a paragraph above
// but doesn't preventDefault, so the browser also splits the contenteditable
// and the heading text gets duplicated (main #27; upstream marktext/muya#240,
// merged after 0.2.0 was published).
let headingEnterPatched = false;
export function patchHeadingEnter(muya: Muya) {
  if (headingEnterPatched) return;
  const ScrollPage = (muya.editor as any).scrollPage?.constructor;
  const Heading = ScrollPage?.loadBlock?.('atxheading.content');
  const original = Heading?.prototype?.enterHandler;
  if (typeof original !== 'function') return;
  headingEnterPatched = true;
  Heading.prototype.enterHandler = function (this: any, event: Event) {
    event.preventDefault();
    return original.call(this, event);
  };
}

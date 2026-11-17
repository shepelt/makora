// @vitest-environment happy-dom
// Does upstream Muya reproduce files byte-for-byte when nothing was edited?
// Failures here are a record of normalizations, not necessarily bugs (#40).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Muya } from '@muyajs/core';
import { fromEditor, shapeOf, toEditor } from '../../src/useDocument.ts';
import { patchMuyaPerformance } from '../../src/muyaPatches.ts';

const FIXTURES = join(process.cwd(), 'tests/fixtures/webdav');
const CORPUS = process.env.ROUNDTRIP_DIR || FIXTURES;

function mdFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return mdFiles(p);
    return /\.md$/i.test(n) ? [p] : [];
  });
}

function roundTrip(text: string): string {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const muya = new Muya(el, { markdown: toEditor(text), preferLooseListItem: false, hideQuickInsertHint: true });
  patchMuyaPerformance(muya);
  muya.init();
  const md = muya.getMarkdown();
  muya.destroy();
  return fromEditor(md, shapeOf(text));
}

// Known upstream normalizations (tracked in #40). `it.fails` flips to a
// failure if upstream stops normalizing, so we notice and can drop the entry.
const KNOWN: Record<string, string> = {
  'large-test.md': 'table delimiter row re-padded: |----| -> | -- |',
  'test2.md': 'empty list item gains a trailing space',
};

describe('markdown round-trip', () => {
  for (const file of mdFiles(CORPUS)) {
    const name = file.slice(CORPUS.length + 1);
    const test = CORPUS === FIXTURES && KNOWN[name] ? it.fails : it;
    test(KNOWN[name] && CORPUS === FIXTURES ? `${name} (known: ${KNOWN[name]})` : name, () => {
      const original = readFileSync(file, 'utf8');
      expect(roundTrip(original)).toBe(original);
    });
  }
});

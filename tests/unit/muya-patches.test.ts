// @vitest-environment happy-dom
// The runtime patches in src/muyaPatches.ts target @muyajs/core 0.2.0
// internals. Upstream `develop` already contains equivalent fixes
// (ReferenceDefinitionIndex, lazy change payloads); when upgrading past
// 0.2.0, verify the fixes shipped and delete the patches (#43).
import { describe, expect, it } from 'vitest';
import { Muya } from '@muyajs/core';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('node_modules/@muyajs/core/package.json', 'utf8'));
import { patchMuyaPerformance } from '../../src/muyaPatches.ts';

describe('Muya performance patches', () => {
  it('target the pinned Muya version', () => {
    expect(pkg.version).toBe('0.2.0');
  });

  it('apply to the internals they replace', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const muya = new Muya(el, { markdown: '# a\n\n[x]: https://example.com\n' });
    patchMuyaPerformance(muya);
    muya.init();
    const renderer = (muya.editor as any).inlineRenderer;
    const state = (muya.editor as any).jsonState;
    expect(String(renderer.collectReferenceDefinitions)).toContain('__labelsFor');
    expect(String(state._emitStateChange)).toContain('prevDoc');
    expect(String(state._emitStateChange)).not.toContain('getState');
    expect(renderer.labels.get('x')?.href).toBe('https://example.com');
    muya.destroy();
  });
});

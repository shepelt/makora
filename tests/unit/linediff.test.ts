import { describe, expect, it } from 'vitest';
import { lineHunks } from '../../src/lineDiff.ts';

describe('lineHunks', () => {
  it('reports changed lines with original line numbers', () => {
    const a = 'a\n|-|-|\nb\nc  \nd\n';
    const b = 'a\n| - | - |\nb\nc\nd\n';
    const { hunks, changedLines } = lineHunks(a, b);
    expect(changedLines).toBe(2);
    expect(hunks).toEqual([
      { line: 2, before: ['|-|-|'], after: ['| - | - |'] },
      { line: 4, before: ['c  '], after: ['c'] },
    ]);
  });
  it('counts pure insertions', () => {
    const { hunks, changedLines } = lineHunks('a\nb\n', 'a\n\nb\n');
    expect(changedLines).toBe(1);
    expect(hunks[0]).toEqual({ line: 2, before: [], after: [''] });
  });
  it('no changes', () => expect(lineHunks('x\n', 'x\n')).toEqual({ hunks: [], changedLines: 0 }));
});

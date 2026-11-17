import { describe, expect, it } from 'vitest';
import { losslessMerge } from '../../src/losslessMerge.ts';

describe('losslessMerge', () => {
  it('keeps extra blank lines the editor would collapse', () => {
    const O = '# A\n\n\n\npara one\n\npara two\n';
    const R = '# A\n\npara one\n\npara two\n';
    const E = '# A\n\npara one\n\npara two edited\n';
    expect(losslessMerge(O, R, E)).toBe('# A\n\n\n\npara one\n\npara two edited\n');
  });

  it('keeps an untouched table even when the edit is on the next line', () => {
    const O = '|a|b|\n|-|-|\n|1|2|\nnext\n';
    const R = '| a | b |\n| - | - |\n| 1 | 2 |\nnext\n';
    const E = '| a | b |\n| - | - |\n| 1 | 2 |\nnext edited\n';
    expect(losslessMerge(O, R, E)).toBe('|a|b|\n|-|-|\n|1|2|\nnext edited\n');
  });

  it('keeps trailing spaces (hard breaks) on untouched lines', () => {
    const O = 'line one  \nline two\nline three\n';
    const R = 'line one\nline two\nline three\n';
    const E = 'line one\nline two!\nline three\n';
    expect(losslessMerge(O, R, E)).toBe('line one  \nline two!\nline three\n');
  });

  it('applies insertions and deletions', () => {
    const O = '- a\n- b\n\n\n- c\n';
    const R = '- a\n- b\n\n- c\n';
    const E = '- a\n- new\n- b\n\n- c\n';
    expect(losslessMerge(O, R, E)).toBe('- a\n- new\n- b\n\n\n- c\n');
    const E2 = '- a\n\n- c\n';
    expect(losslessMerge(O, R, E2)).toBe('- a\n\n\n- c\n');
  });

  it('an edited line takes the editor style', () => {
    const O = '|a|b|\n|-|-|\n|1|2|\n';
    const R = '| a | b |\n| - | - |\n| 1 | 2 |\n';
    const E = '| a | b |\n| - | - |\n| 1 | 3 |\n';
    expect(losslessMerge(O, R, E)).toBe('|a|b|\n|-|-|\n| 1 | 3 |\n');
  });

  it('no normalization or no edit: trivial', () => {
    expect(losslessMerge('x\n', 'x\n', 'y\n')).toBe('y\n');
    expect(losslessMerge('x  \n', 'x\n', 'x\n')).toBe('x  \n');
  });
});

describe('losslessMerge: edits next to uneven normalizations', () => {
  it('keeps collapsed blank lines and table right above an edited line', () => {
    const O = '|a|b|\n|-|-|\n\n\n\nfirst\n\nsecond\n';
    const R = '| a | b |\n| --- | --- |\n\nfirst\n\nsecond\n';
    const E = '| a | b |\n| --- | --- |\n\nfirst 1\n\nsecond\n';
    expect(losslessMerge(O, R, E)).toBe('|a|b|\n|-|-|\n\n\n\nfirst 1\n\nsecond\n');
  });
  it('deleting a line next to a normalized region', () => {
    const O = '|a|b|\n|-|-|\n\n\n\nfirst\n\nsecond\n';
    const R = '| a | b |\n| --- | --- |\n\nfirst\n\nsecond\n';
    const E = '| a | b |\n| --- | --- |\n\nsecond\n';
    expect(losslessMerge(O, R, E)).toBe('|a|b|\n|-|-|\n\n\n\nsecond\n');
  });
});

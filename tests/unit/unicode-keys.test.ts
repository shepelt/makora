import { describe, expect, it } from 'vitest';
import { quoteUnicodeKeys } from '../../muya-unicode-keys.ts';

describe('quoteUnicodeKeys', () => {
  it('quotes non-ASCII keys and leaves the rest alone', () => {
    const src = 'const t = {a: 1, Ꟍ: `ꟍ`, ꟎: "꟏", "x": 2,\n\t꟒: `ꟓ`}; const s = "ꟍ: no";';
    const out = quoteUnicodeKeys(src);
    expect(out).toBe('const t = {a: 1, "Ꟍ": `ꟍ`, "꟎": "꟏", "x": 2,\n\t"꟒": `ꟓ`}; const s = "ꟍ: no";');
    expect(() => new Function(out)).not.toThrow();
  });
});

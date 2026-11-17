// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { normalizeEtag } from '../../src/dav.ts';

describe('normalizeEtag', () => {
  it.each([
    ['"abc"', '"abc"'],
    ['"abc-gzip"', '"abc"'],
    ['"abc-br"', '"abc"'],
    ['W/"abc"', '"abc"'],
    ['W/"abc-gzip"', '"abc"'],
    [' "abc" ', '"abc"'],
  ])('%s -> %s', (input, out) => expect(normalizeEtag(input)).toBe(out));
  it('handles missing', () => {
    expect(normalizeEtag(null)).toBeNull();
    expect(normalizeEtag('')).toBeNull();
  });
});

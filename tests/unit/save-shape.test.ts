import { describe, expect, it } from 'vitest';
import { fromEditor, shapeOf, toEditor } from '../../src/useDocument.ts';

const shape = shapeOf;

describe('file shape preservation', () => {
  it.each([
    '# Title\n\nbody\n',
    '# Title\n\nbody',
    '# Title\r\n\r\nbody\r\n',
    '﻿# BOM\n',
    '﻿# BOM CRLF\r\nline\r\n',
  ])('round-trips %j', (original) => {
    const md = toEditor(original);
    expect(md).not.toMatch(/\r|﻿/);
    expect(fromEditor(md, shape(original))).toBe(original);
  });

  it('normalizes extra trailing newlines from the editor', () => {
    expect(fromEditor('a\n\n\n', shapeOf('x\n'))).toBe('a\n');
  });
});

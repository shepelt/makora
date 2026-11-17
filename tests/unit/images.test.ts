import { describe, expect, it } from 'vitest';
import { resolveImageSrc } from '../../src/images.ts';
import { imageTypeFor } from '../../server/relay.ts';

describe('resolveImageSrc', () => {
  const doc = '/Notes/2025/day.md';
  it.each([
    ['file://images/a.png', '/api/img/Notes/2025/images/a.png'],
    ['file://./images/a.png', '/api/img/Notes/2025/images/a.png'],
    ['file://../shared/b.jpg', '/api/img/Notes/shared/b.jpg'],
    ['file:///images/c.gif', '/api/img/images/c.gif'],
    ['file://my%20pic.png', '/api/img/Notes/2025/my%20pic.png'],
    ['file://사진.png', '/api/img/Notes/2025/%EC%82%AC%EC%A7%84.png'],
    ['file://../../../../etc/x.png', '/api/img/etc/x.png'], // clamped at the WebDAV root
  ])('%s -> %s', (src, out) => expect(resolveImageSrc(src, doc)).toBe(out));

  it('leaves remote and inline images alone', () => {
    expect(resolveImageSrc('https://example.com/a.png', doc)).toBeNull();
    expect(resolveImageSrc('data:image/png;base64,AAAA', doc)).toBeNull();
  });
});

describe('imageTypeFor', () => {
  it('accepts image types', () => {
    expect(imageTypeFor('/a.png', 'image/png')).toBe('image/png');
    expect(imageTypeFor('/a.svg', 'image/svg+xml; charset=utf-8')).toBe('image/svg+xml');
  });
  it('falls back to the extension only for generic types', () => {
    expect(imageTypeFor('/a.jpg', 'application/octet-stream')).toBe('image/jpeg');
    expect(imageTypeFor('/a.jpg', null)).toBe('image/jpeg');
  });
  it('refuses non-images even with an image extension', () => {
    expect(imageTypeFor('/evil.png', 'text/html')).toBeNull();
    expect(imageTypeFor('/notes.md', 'application/octet-stream')).toBeNull();
    expect(imageTypeFor('/x.html', 'text/html')).toBeNull();
  });
});

// Images stored on the WebDAV server are served through /api/img (sealed
// credentials in an HttpOnly cookie; see server/seal.ts). Muya hands relative
// paths over as "file://<path>"; we resolve them against the note's folder.
import type { Muya } from '@muyajs/core';
import { encodePath } from './dav';

function normalize(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out;
}

export function resolveImageSrc(src: string, docPath: string): string | null {
  if (!src.startsWith('file://')) return null; // http(s), data: and blob: load directly
  let p = src.slice('file://'.length).split(/[?#]/)[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep as is */
  }
  const docDir = docPath.split('/').slice(0, -1);
  const parts = p.startsWith('/') ? p.split('/') : [...docDir, ...p.split('/')];
  const resolved = '/' + normalize(parts).join('/');
  return '/api/img' + encodePath(resolved);
}

// Route Muya's image loading through the relay for this editor instance.
// Muya builds a fresh Renderer per render call, but they all share one image
// resource cache; mapping sources there covers every render. A loaded image
// resolves to the mapped URL, which is what the rendered <img> points at.
export function patchImageLoading(muya: Muya, docPath: string) {
  const images: any = (muya.editor as any).inlineEngine?.renderer?.images;
  if (!images || typeof images.request !== 'function' || typeof images.get !== 'function') return;
  const map = (src: string) => (src && resolveImageSrc(src, docPath)) || src;
  const { get, request } = images;
  images.get = (src: string) => get.call(images, map(src));
  images.request = (src: string, detectContentType: boolean) => {
    const mapped = map(src);
    return request.call(images, mapped, mapped === src ? detectContentType : false);
  };
}

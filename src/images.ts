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
export function patchImageLoading(muya: Muya, docPath: string) {
  const renderer: any = (muya.editor as any).inlineRenderer?.renderer;
  if (!renderer || typeof renderer.loadImageAsync !== 'function' || !(renderer.urlMap instanceof Map)) return;
  const original = renderer.loadImageAsync;
  renderer.loadImageAsync = function (info: { src: string; isUnknownType: boolean }, ...rest: unknown[]) {
    const mapped = info?.src ? resolveImageSrc(info.src, docPath) : null;
    if (!mapped) return original.call(this, info, ...rest);
    // urlMap makes the rendered <img> use the mapped URL instead of file://.
    this.urlMap.set(info.src, mapped);
    return original.call(this, { src: mapped, isUnknownType: false }, ...rest);
  };
}

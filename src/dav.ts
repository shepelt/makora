// Minimal WebDAV client that talks to the server's stateless relay.
// Credentials live in the browser and are sent per request.

export type DavConfig = {
  url: string; // e.g. https://cloud.example.com/remote.php/dav/files/me
  username: string;
  password: string;
};

export type DavEntry = {
  path: string; // relative to the configured base, starts with "/"
  name: string;
  isDir: boolean;
  lastmod: number; // ms since epoch, 0 if unknown
  size: number;
  etag: string | null;
};

export class DavError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class ConflictError extends DavError {
  constructor() {
    super(412, 'The file changed on the server since it was opened');
  }
}

// Servers and proxies decorate ETags of compressed responses (Apache adds
// "-gzip", some add W/). Normalize to the strong form the server compares
// If-Match against.
export function normalizeEtag(etag: string | null | undefined): string | null {
  if (!etag) return null;
  return etag.trim().replace(/^W\//, '').replace(/-(gzip|br|deflate|zstd)"$/, '"');
}

function basicAuth(cfg: DavConfig): string {
  const bytes = new TextEncoder().encode(`${cfg.username}:${cfg.password}`);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return 'Basic ' + btoa(bin);
}

export function encodePath(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

async function request(
  cfg: DavConfig,
  method: string,
  path: string,
  init: { headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const res = await fetch('/api/dav' + encodePath(path), {
    method,
    headers: {
      'X-Dav-Target': cfg.url,
      Authorization: basicAuth(cfg),
      ...init.headers,
    },
    body: init.body,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 401) {
    // Either the relay session or the WebDAV credentials were rejected.
    const relayAuth = res.headers.get('content-type')?.includes('application/json');
    const body = relayAuth ? await res.clone().json().catch(() => null) : null;
    if (body?.error === 'Not authorized') throw new DavError(401, 'Makora session expired. Reload the page.');
    throw new DavError(401, 'WebDAV server rejected the username or password');
  }
  if (res.status >= 400 && res.headers.get('content-type')?.includes('application/json')) {
    const body = await res.json().catch(() => null);
    if (body?.error) throw new DavError(res.status, body.error);
  }
  return res;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop>
<d:resourcetype/><d:getlastmodified/><d:getcontentlength/><d:getetag/>
</d:prop></d:propfind>`;

export function parseMultistatus(xml: string, basePathname: string): DavEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const NS = 'DAV:';
  const base = decodeURIComponent(basePathname).replace(/\/+$/, '');
  const out: DavEntry[] = [];
  for (const r of Array.from(doc.getElementsByTagNameNS(NS, 'response'))) {
    const hrefRaw = r.getElementsByTagNameNS(NS, 'href')[0]?.textContent ?? '';
    let href: string;
    try {
      href = decodeURIComponent(new URL(hrefRaw, 'http://x').pathname);
    } catch {
      continue;
    }
    let rel = href.startsWith(base) ? href.slice(base.length) : href;
    if (!rel.startsWith('/')) rel = '/' + rel;
    const isDir = r.getElementsByTagNameNS(NS, 'collection').length > 0;
    const path = rel.length > 1 ? rel.replace(/\/+$/, '') : '/';
    const lm = r.getElementsByTagNameNS(NS, 'getlastmodified')[0]?.textContent;
    const size = r.getElementsByTagNameNS(NS, 'getcontentlength')[0]?.textContent;
    const etag = r.getElementsByTagNameNS(NS, 'getetag')[0]?.textContent;
    out.push({
      path,
      name: path === '/' ? '' : path.split('/').pop()!,
      isDir,
      lastmod: lm ? Date.parse(lm) || 0 : 0,
      size: size ? Number(size) : 0,
      etag: etag || null,
    });
  }
  return out;
}

export async function list(cfg: DavConfig, dir: string): Promise<DavEntry[]> {
  const path = dir.endsWith('/') ? dir : dir + '/';
  const res = await request(cfg, 'PROPFIND', path, {
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: PROPFIND_BODY,
  });
  if (res.status !== 207) throw new DavError(res.status, `Could not list folder (HTTP ${res.status})`);
  const entries = parseMultistatus(await res.text(), new URL(cfg.url).pathname);
  const self = dir.replace(/\/+$/, '') || '/';
  return entries.filter((e) => e.path !== self);
}

export async function read(cfg: DavConfig, path: string): Promise<{ text: string; etag: string | null }> {
  const res = await request(cfg, 'GET', path);
  if (!res.ok) throw new DavError(res.status, `Could not open file (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buf);
  return { text, etag: normalizeEtag(res.headers.get('etag')) };
}

export async function stat(cfg: DavConfig, path: string): Promise<{ etag: string | null; exists: boolean }> {
  const res = await request(cfg, 'PROPFIND', path, {
    headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body: PROPFIND_BODY,
  });
  if (res.status === 404) return { etag: null, exists: false };
  if (res.status !== 207) throw new DavError(res.status, `Could not check file (HTTP ${res.status})`);
  const [entry] = parseMultistatus(await res.text(), new URL(cfg.url).pathname);
  return { etag: normalizeEtag(entry?.etag), exists: true };
}

// Writes only if the file still has the ETag we last saw. `etag: null` means
// "create, but don't overwrite an existing file".
export async function write(
  cfg: DavConfig,
  path: string,
  text: string,
  etag: string | null,
): Promise<{ etag: string | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'text/markdown; charset=utf-8' };
  if (etag) headers['If-Match'] = etag;
  else headers['If-None-Match'] = '*';
  const res = await request(cfg, 'PUT', path, { headers, body: text });
  if (res.status === 412) throw new ConflictError();
  if (!res.ok) throw new DavError(res.status, `Save failed (HTTP ${res.status})`);
  let newEtag = normalizeEtag(res.headers.get('etag'));
  if (!newEtag) newEtag = (await stat(cfg, path)).etag;
  return { etag: newEtag };
}

export async function testConnection(cfg: DavConfig): Promise<void> {
  await list(cfg, '/');
}

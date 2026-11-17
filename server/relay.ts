// Stateless WebDAV relay.
//
// The browser keeps the user's WebDAV credentials and sends them with each
// request; the server only checks the destination and forwards. Browsers
// can't talk to most WebDAV servers directly (CORS), which is the only reason
// this relay exists.
//
// Destination safety (SSRF): only public addresses are reachable. The check
// runs at connect time inside the DNS lookup, so DNS rebinding can't slip a
// private address past it, and redirects are never followed.

import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

export const ALLOWED_METHODS = new Set([
  'GET', 'HEAD', 'PUT', 'DELETE', 'PROPFIND', 'MKCOL', 'MOVE', 'COPY',
]);

const FORWARD_REQUEST_HEADERS = [
  'authorization', 'content-type', 'depth', 'if-match', 'if-none-match',
  'if-modified-since', 'overwrite',
];

const FORWARD_RESPONSE_HEADERS = [
  'content-type', 'etag', 'last-modified', 'dav',
];

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 60_000;

export type RelayOptions = {
  // Allow loopback/private destinations and plain http. Local tests only.
  allowPrivate?: boolean;
};

// --- address classification -------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT (also Tailscale)
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d)
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (lower === '::' || lower === '::1') return true;
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  return true; // not an IP at all: treat as unsafe
}

// --- target validation ------------------------------------------------------

export class RelayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function parseTarget(raw: string | undefined, opts: RelayOptions = {}): URL {
  if (!raw) throw new RelayError(400, 'Missing X-Dav-Target header');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RelayError(400, 'Invalid WebDAV URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RelayError(400, 'WebDAV URL must be http(s)');
  }
  if (url.username || url.password) {
    throw new RelayError(400, 'Put credentials in settings, not in the URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!opts.allowPrivate) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      throw new RelayError(403, 'Destination not allowed');
    }
    if (isIP(host) && isPrivateAddress(host)) {
      throw new RelayError(403, 'Destination not allowed');
    }
  }
  return url;
}

// Joins the WebDAV base URL with a client path, refusing to escape the base.
export function joinTarget(base: URL, path: string): URL {
  const segments = path.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new RelayError(400, 'Invalid path');
  }
  const basePath = base.pathname.replace(/\/+$/, '');
  const joined = new URL(base.toString());
  // Segments arrive already percent-encoded from the client.
  joined.pathname = basePath + '/' + segments.join('/') + (path.endsWith('/') && segments.length ? '/' : '');
  joined.search = '';
  joined.hash = '';
  return joined;
}

// --- connect-time address check ---------------------------------------------

function safeLookup(
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void,
) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: any) => {
    if (err) return callback(err, undefined);
    const list = (addresses as Array<{ address: string; family: number }>);
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      const e: NodeJS.ErrnoException = new Error(`Destination not allowed (${hostname})`);
      e.code = 'EDESTINATION';
      return callback(e, undefined);
    }
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const publicAgent = new Agent({
  connect: { lookup: safeLookup as any, timeout: CONNECT_TIMEOUT_MS },
});
const anyAgent = new Agent({ connect: { timeout: CONNECT_TIMEOUT_MS } });

// --- relay ------------------------------------------------------------------

async function upstreamFetch(
  target: URL,
  method: string,
  headers: Record<string, string>,
  body: ArrayBuffer | undefined,
  opts: RelayOptions,
) {
  let upstream: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    upstream = await undiciFetch(target, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      dispatcher: opts.allowPrivate ? anyAgent : publicAgent,
    });
  } catch (err: any) {
    const code = err?.cause?.code || err?.code;
    if (code === 'EDESTINATION') throw new RelayError(403, 'Destination not allowed');
    if (err?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new RelayError(504, 'WebDAV server did not respond');
    }
    throw new RelayError(502, `Could not reach WebDAV server (${code || err?.message || 'error'})`);
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    throw new RelayError(502, 'WebDAV server redirected; use the final URL in settings');
  }
  return upstream;
}

export async function relay(req: Request, davPath: string, opts: RelayOptions = {}): Promise<Response> {
  const method = req.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new RelayError(405, 'Method not allowed');

  const base = parseTarget(req.headers.get('x-dav-target') ?? undefined, opts);
  const target = joinTarget(base, davPath);

  const headers = new Headers();
  // Ask for uncompressed responses: Apache's mod_deflate rewrites the ETag of
  // compressed responses ("abc" -> "abc-gzip"), which then never matches
  // If-Match and makes every save look like a conflict.
  headers.set('accept-encoding', 'identity');
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  // MOVE/COPY: the client sends a path; we build the absolute Destination on
  // the same server so it can't point anywhere else.
  if (method === 'MOVE' || method === 'COPY') {
    const dest = req.headers.get('x-dav-destination');
    if (!dest) throw new RelayError(400, 'Missing X-Dav-Destination');
    headers.set('destination', joinTarget(base, dest).toString());
  }

  let body: ArrayBuffer | undefined;
  if (method === 'PUT' || method === 'PROPFIND') {
    const len = Number(req.headers.get('content-length') || 0);
    if (len > MAX_BODY_BYTES) throw new RelayError(413, 'Body too large');
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) throw new RelayError(413, 'Body too large');
  }

  const upstream = await upstreamFetch(target, method, Object.fromEntries(headers), body, opts);

  const out = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) out.set(name, v);
  }
  out.set('cache-control', 'no-store');
  // Never forward WWW-Authenticate: it would pop the browser's native login dialog.
  return new Response(method === 'HEAD' ? null : (upstream.body as any), {
    status: upstream.status,
    headers: out,
  });
}

// --- images ---------------------------------------------------------------
// <img> can't send headers, so images use sealed credentials from a cookie
// (see seal.ts). Only image types are served, inside a sandbox CSP, so a file
// on the WebDAV server can never run as script on Makora's origin.

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};
const ALLOWED_IMAGE_TYPES = new Set(Object.values(IMAGE_TYPES));

export function imageTypeFor(path: string, upstreamType: string | null): string | null {
  const t = (upstreamType || '').split(';')[0].trim().toLowerCase();
  if (ALLOWED_IMAGE_TYPES.has(t)) return t;
  // Some servers label everything application/octet-stream; trust a known
  // image extension in that case only.
  if (!t || t === 'application/octet-stream' || t === 'binary/octet-stream') {
    const ext = decodeURIComponent(path).split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_TYPES[ext] ?? null;
  }
  return null;
}

export async function relayImage(
  creds: { url: string; username: string; password: string },
  davPath: string,
  opts: RelayOptions = {},
): Promise<Response> {
  const base = parseTarget(creds.url, opts);
  const target = joinTarget(base, davPath);
  const auth = 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  const upstream = await upstreamFetch(target, 'GET', { authorization: auth, 'accept-encoding': 'identity' }, undefined, opts);
  const headers = new Headers({
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'x-content-type-options': 'nosniff',
  });
  if (!upstream.ok) {
    await upstream.body?.cancel();
    headers.set('cache-control', 'no-store');
    return new Response(null, { status: upstream.status === 401 ? 401 : upstream.status === 404 ? 404 : 502, headers });
  }
  const type = imageTypeFor(davPath, upstream.headers.get('content-type'));
  if (!type) {
    await upstream.body?.cancel();
    throw new RelayError(415, 'Not an image');
  }
  const len = Number(upstream.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) {
    await upstream.body?.cancel();
    throw new RelayError(413, 'Image too large');
  }
  headers.set('content-type', type);
  headers.set('cache-control', 'private, max-age=300');
  const etag = upstream.headers.get('etag');
  if (etag) headers.set('etag', etag);
  return new Response(upstream.body as any, { status: 200, headers });
}

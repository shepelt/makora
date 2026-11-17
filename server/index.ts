import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { parseTarget, relay, relayImage, RelayError } from './relay.ts';
import { seal, SEAL_COOKIE, SEAL_MAX_AGE, unseal } from './seal.ts';

const PORT = Number(process.env.PORT || 4100);
const ALLOW_PRIVATE = process.env.MAKORA_ALLOW_PRIVATE === '1';
const DIST = process.env.MAKORA_DIST || './dist';

// Prototype auth: one shared access key. Opening the share link
// (?key=...) sets a long-lived HttpOnly cookie. Google login replaces this
// once the app has a stable URL (see #42).
const ACCESS_KEY = process.env.MAKORA_ACCESS_KEY || randomBytes(18).toString('base64url');
const COOKIE = 'makora_access';
const keyDigest = createHash('sha256').update(ACCESS_KEY).digest();

function validKey(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const d = createHash('sha256').update(candidate).digest();
  return timingSafeEqual(d, keyDigest);
}

// Cookie holds a digest of the key, not the key itself.
const cookieValue = createHash('sha256').update('cookie:' + ACCESS_KEY).digest('base64url');
function validCookie(v: string | undefined): boolean {
  if (!v || v.length !== cookieValue.length) return false;
  return timingSafeEqual(Buffer.from(v), Buffer.from(cookieValue));
}

// Tiny per-IP limiter for failed key attempts.
const failures = new Map<string, { count: number; until: number }>();
function clientIp(c: any): string {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';
}
function blocked(ip: string): boolean {
  const f = failures.get(ip);
  return !!f && f.count >= 10 && Date.now() < f.until;
}
function recordFailure(ip: string) {
  const f = failures.get(ip) ?? { count: 0, until: 0 };
  f.count += 1;
  f.until = Date.now() + 15 * 60_000;
  failures.set(ip, f);
}

const app = new Hono();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
});

app.get('/healthz', (c) => c.text('ok'));

function grantAccess(c: any) {
  const https = c.req.header('x-forwarded-proto') === 'https' || c.req.url.startsWith('https:');
  setCookie(c, COOKIE, cookieValue, {
    httpOnly: true,
    secure: https,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
}

const LOCKED_PAGE = (msg = '') => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Makora</title>
<style>body{font-family:system-ui,sans-serif;background:#fafaf9;color:#3c3c3b;display:grid;place-items:center;min-height:100vh;margin:0}
form{display:flex;flex-direction:column;gap:12px;width:min(320px,90vw)}input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #d6d3d1}
button{background:#3c3c3b;color:#fff;border:0}p{color:#b91c1c;margin:0}</style></head>
<body><form method="post" action="/login"><strong>Makora</strong>
<input name="key" type="password" placeholder="Access key" autofocus autocomplete="current-password">
${msg ? `<p>${msg}</p>` : ''}<button>Open</button></form></body></html>`;

app.post('/login', async (c) => {
  const ip = clientIp(c);
  if (blocked(ip)) return c.html(LOCKED_PAGE('Too many attempts. Try later.'), 429);
  const form = await c.req.parseBody();
  if (!validKey(String(form.key || ''))) {
    recordFailure(ip);
    return c.html(LOCKED_PAGE('Wrong key.'), 401);
  }
  grantAccess(c);
  return c.redirect('/');
});

// Access gate for everything else.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const key = url.searchParams.get('key');
  if (key !== null) {
    const ip = clientIp(c);
    if (!blocked(ip) && validKey(key)) {
      grantAccess(c);
      url.searchParams.delete('key');
      return c.redirect(url.pathname + url.search);
    }
    recordFailure(ip);
  }
  if (validCookie(getCookie(c, COOKIE))) return next();
  if (url.pathname.startsWith('/api/')) return c.json({ error: 'Not authorized' }, 401);
  // The host's health probe hits GET /; answer without side effects.
  return c.html(LOCKED_PAGE(), 401);
});

function sameOrigin(c: any): boolean {
  const origin = c.req.header('origin');
  const host = c.req.header('x-forwarded-host') || c.req.header('host');
  try {
    return !!origin && new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Seal the browser's WebDAV credentials into an HttpOnly cookie for <img>.
app.post('/api/seal', async (c) => {
  if (!sameOrigin(c)) return c.json({ error: 'Bad origin' }, 403);
  const body = await c.req.json().catch(() => null);
  const { url, username, password } = body ?? {};
  if (typeof url !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
    return c.json({ error: 'url, username, password required' }, 400);
  }
  try {
    parseTarget(url, { allowPrivate: ALLOW_PRIVATE });
  } catch (err) {
    if (err instanceof RelayError) return c.json({ error: err.message }, err.status as any);
    throw err;
  }
  const https = c.req.header('x-forwarded-proto') === 'https' || c.req.url.startsWith('https:');
  setCookie(c, SEAL_COOKIE, seal({ url, username, password }), {
    httpOnly: true,
    secure: https,
    sameSite: 'Strict',
    path: '/api/img',
    maxAge: SEAL_MAX_AGE,
  });
  return c.json({ ok: true });
});

app.post('/api/unseal', (c) => {
  if (!sameOrigin(c)) return c.json({ error: 'Bad origin' }, 403);
  deleteCookie(c, SEAL_COOKIE, { path: '/api/img' });
  return c.json({ ok: true });
});

app.get('/api/img/*', async (c) => {
  const creds = unseal(getCookie(c, SEAL_COOKIE));
  if (!creds) return c.body(null, 401);
  const davPath = new URL(c.req.url).pathname.slice('/api/img'.length) || '/';
  try {
    return await relayImage(creds, davPath, { allowPrivate: ALLOW_PRIVATE });
  } catch (err) {
    if (err instanceof RelayError) return c.body(null, err.status as any);
    console.error('image relay error', err);
    return c.body(null, 500);
  }
});

app.all('/api/dav/*', async (c) => {
  const method = c.req.method.toUpperCase();
  // CSRF: state-changing requests must come from our own origin.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = c.req.header('origin');
    const host = c.req.header('x-forwarded-host') || c.req.header('host');
    if (!origin || new URL(origin).host !== host) {
      return c.json({ error: 'Bad origin' }, 403);
    }
  }
  const davPath = new URL(c.req.url).pathname.slice('/api/dav'.length) || '/';
  try {
    return await relay(c.req.raw, davPath, { allowPrivate: ALLOW_PRIVATE });
  } catch (err) {
    if (err instanceof RelayError) return c.json({ error: err.message }, err.status as any);
    console.error('relay error', err);
    return c.json({ error: 'Relay failed' }, 500);
  }
});

// Static client. Hashed assets are immutable; index.html is never cached.
app.use('/assets/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
});
app.use('*', serveStatic({ root: DIST }));
app.get('*', async (c) => {
  c.header('Cache-Control', 'no-cache');
  return c.html(await readFile(`${DIST}/index.html`, 'utf8'));
});

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, () => {
  console.log(`makora listening on :${PORT}${ALLOW_PRIVATE ? ' (private destinations ALLOWED — test mode)' : ''}`);
  if (!process.env.MAKORA_ACCESS_KEY) console.log(`access key (generated): ${ACCESS_KEY}`);
});

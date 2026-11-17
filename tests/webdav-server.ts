// Minimal WebDAV server for tests and local development, with the semantics
// Makora relies on: strong ETags, If-Match / If-None-Match (412), PROPFIND
// depth 0/1, MKCOL, DELETE, MOVE. Basic auth: test / test.
//
// Usage: node tests/webdav-server.ts [port] [dir]

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';

const AUTH = 'Basic ' + Buffer.from('test:test').toString('base64');

function etagOf(full: string): string {
  const st = statSync(full);
  if (st.isDirectory()) return `"d-${st.mtimeMs.toString(36)}"`;
  return '"' + createHash('sha1').update(readFileSync(full)).digest('hex').slice(0, 20) + '"';
}

const TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  html: 'text/html',
};
const typeOf = (p: string) => TYPES[p.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

function xmlEscape(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export type TestWebdav = { dir: string; port: number; server: Server; stop: () => Promise<void> };

export function startWebdav(
  port = 4080,
  dir?: string,
  opts: { prefix?: string; apacheGzipEtags?: boolean } = {},
): Promise<TestWebdav> {
  const root = dir ?? mkdtempSync(join(tmpdir(), 'makora-webdav-'));
  if (!dir) cpSync(new URL('./fixtures/webdav', import.meta.url).pathname, root, { recursive: true });
  const prefix = (opts.prefix ?? '').replace(/\/+$/, ''); // e.g. /remote.php/dav/files/test

  const resolvePath = (urlPath: string): string | null => {
    let p = decodeURIComponent(urlPath.split('?')[0]);
    if (prefix) {
      if (!p.startsWith(prefix)) return null;
      p = p.slice(prefix.length) || '/';
    }
    const full = normalize(join(root, p));
    if (!full.startsWith(normalize(root))) return null;
    return full;
  };

  const hrefOf = (full: string, isDir: boolean) => {
    const rel = full.slice(normalize(root).length).split('/').filter(Boolean);
    return prefix + '/' + rel.map(encodeURIComponent).join('/') + (isDir && rel.length ? '/' : '');
  };

  const propResponse = (full: string) => {
    const st = statSync(full);
    const isDir = st.isDirectory();
    return `<d:response><d:href>${xmlEscape(hrefOf(full, isDir))}</d:href><d:propstat><d:prop>
<d:resourcetype>${isDir ? '<d:collection/>' : ''}</d:resourcetype>
<d:getlastmodified>${st.mtime.toUTCString()}</d:getlastmodified>
${isDir ? '' : `<d:getcontentlength>${st.size}</d:getcontentlength>`}
<d:getetag>${xmlEscape(etagOf(full))}</d:getetag>
</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body = '', headers: Record<string, string> = {}) => {
      res.writeHead(status, headers);
      res.end(body);
    };
    if (req.headers.authorization !== AUTH) {
      return send(401, 'Unauthorized', { 'WWW-Authenticate': 'Basic realm="test"' });
    }
    const full = resolvePath(req.url || '/');
    if (!full) return send(403);
    const exists = existsSync(full);
    const method = req.method || 'GET';

    // Preconditions
    const ifMatch = req.headers['if-match'];
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifMatch && (!exists || (ifMatch !== '*' && ifMatch !== etagOf(full)))) return send(412);
    if (ifNoneMatch === '*' && exists && method === 'PUT') return send(412);

    switch (method) {
      case 'GET':
      case 'HEAD': {
        if (!exists || statSync(full).isDirectory()) return send(404);
        const body = readFileSync(full);
        // Apache mod_deflate (DeflateAlterETag AddSuffix, the default) tags
        // compressed responses with a different ETag, which then never
        // matches If-Match. We only emulate the ETag change, not the gzip.
        const gz = opts.apacheGzipEtags && /gzip/.test(String(req.headers['accept-encoding'] ?? ''));
        const etag = gz ? etagOf(full).replace(/"$/, '-gzip"') : etagOf(full);
        res.writeHead(200, { 'Content-Type': typeOf(full), ETag: etag, 'Content-Length': String(body.length) });
        return res.end(method === 'HEAD' ? undefined : body);
      }
      case 'PUT': {
        if (!existsSync(dirname(full))) return send(409);
        writeFileSync(full, await readBody(req));
        return send(exists ? 204 : 201, '', { ETag: etagOf(full) });
      }
      case 'PROPFIND': {
        await readBody(req);
        if (!exists) return send(404);
        const depth = req.headers.depth ?? '1';
        const parts = [propResponse(full)];
        if (statSync(full).isDirectory() && depth !== '0') {
          for (const name of readdirSync(full)) {
            parts.push(propResponse(join(full, name)));
          }
        }
        return send(207, `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${parts.join('')}</d:multistatus>`, {
          'Content-Type': 'application/xml; charset=utf-8',
        });
      }
      case 'MKCOL':
        if (exists) return send(405);
        mkdirSync(full);
        return send(201);
      case 'DELETE':
        if (!exists) return send(404);
        rmSync(full, { recursive: true });
        return send(204);
      case 'MOVE': {
        const dest = req.headers.destination;
        if (!dest || !exists) return send(400);
        const target = resolvePath(new URL(String(dest)).pathname);
        if (!target) return send(403);
        if (existsSync(target) && req.headers.overwrite === 'F') return send(412);
        renameSync(full, target);
        return send(201);
      }
      default:
        return send(405);
    }
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, () =>
      resolve({
        dir: root,
        port,
        server,
        stop: () => new Promise((r) => server.close(() => r())),
      }),
    );
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 4080);
  startWebdav(port, process.argv[3], { prefix: process.env.DAV_PREFIX, apacheGzipEtags: process.env.APACHE_GZIP === '1' }).then(({ dir }) =>
    console.log(`webdav on :${port}${process.env.DAV_PREFIX ?? ''} serving ${dir} (user test/test)`),
  );
}

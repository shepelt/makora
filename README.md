# Makora (next)

A fast, minimal Typora-style markdown editor for files on your own WebDAV server (Nextcloud, Synology, …). Built for iPad first, works on phones and desktop.

> This is the `next` branch: a fresh rewrite. The original Meteor app lives on `main` for reference. See #45 for the plan.

## Principles
- **Your files stay plain `.md` files** on your server. Untouched files are never rewritten; Makora keeps line endings, BOM and trailing newlines as they were.
- **Never lose or clobber work.** Saves are conditional (`If-Match` ETag); if a file changed elsewhere (another device, Nextcloud, an AI tool), Makora asks instead of overwriting. Unsaved edits are kept on the device until the server confirms them. Auto-save after a short pause.
- **Credentials stay in the browser.** Images use the same credentials sealed (AES-GCM) into an HttpOnly cookie, since `<img>` can't send headers; only image types are served, under a sandbox CSP. The server is a stateless WebDAV relay (needed only because browsers can't call most WebDAV servers directly). It refuses private/loopback destinations at connect time and never follows redirects.

## Stack
- Client: Vite + React + TypeScript + Tailwind v3, editor: upstream [Muya](https://github.com/marktext/marktext/tree/develop/packages/muya) `develop`, pinned and vendored (see `vendor/README.md`)
- Server: Node 24 (runs TypeScript directly) + Hono
- Tests: Vitest (unit, round-trip), Playwright (Chromium, WebKit, iPad)

## Run
```bash
npm install
npm run build
MAKORA_ACCESS_KEY=choose-a-key npm start     # http://localhost:4100/?key=choose-a-key
```
Development: `npm run dev` (Vite on :4000, API on :4100). Local WebDAV for testing: `DAV_PREFIX=/remote.php/dav/files/test node tests/webdav-server.ts 4080` (user `test` / `test`; run the server with `MAKORA_ALLOW_PRIVATE=1` to reach it).

## Configuration
| Variable | Meaning |
|---|---|
| `PORT` | Listen port (default 4100) |
| `MAKORA_ACCESS_KEY` | Shared access key for the prototype (printed at startup if unset) |
| `MAKORA_SECRET` | Key for sealing credentials into the image cookie. Set it so seals survive restarts (random per process otherwise) |
| `MAKORA_ALLOW_PRIVATE` | `1` allows private/loopback WebDAV targets. **Tests only.** |

## Test
```bash
npm test            # unit + markdown round-trip
npm run test:e2e    # Playwright: Chromium, WebKit, iPad
ROUNDTRIP_DIR=~/notes npm test -- roundtrip   # check your own files round-trip
```

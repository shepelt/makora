# AI Development Rules for Makora

## Project Overview
Makora is a WYSIWYG markdown editor with WebDAV backend support. It provides a clean, distraction-free editing experience for markdown files stored on any WebDAV-compatible server (Nextcloud, ownCloud, etc.).

## Technology Stack (`next` branch)
- **Client**: Vite + React 18 + TypeScript + Tailwind v4 (build-time)
- **Editor**: upstream Muya (`@muyajs/core`), no fork
- **Server**: Node 24 running TypeScript directly (erasable syntax only: no enums, no parameter properties) + Hono
- **Storage**: WebDAV via a stateless relay (`server/relay.ts`); credentials stay in the browser
- **Testing**: Vitest (unit, round-trip), Playwright (Chromium, WebKit, iPad)

## Project Structure
```
/src        Client (App, Editor, FileBrowser, Settings, useDocument, dav, store)
/server     Hono server: access gate, WebDAV relay, static files
/tests
  /unit     Vitest tests
  /e2e      Playwright tests + serve.ts (starts test WebDAV + app)
  /fixtures/webdav  Test markdown files
  webdav-server.ts  Minimal WebDAV server with real ETag/If-Match semantics
```

## Non-negotiables
- No per-keystroke work that grows with document size (no serialization on change).
- Saves use `If-Match`; never overwrite a file that changed elsewhere.
- Never rewrite a file the user didn't edit.
- The relay must only reach public addresses (checked at connect time) and never follow redirects.

## Code Conventions

### File Organization
- Place all application code inside `/imports` directory
- Use ES6 `import`/`export` modules
- Client code: `/imports/ui`
- Server code: `/imports/api/server`

### Naming Conventions
- **Components**: PascalCase (e.g., `FileBrowser.jsx`)
- **Methods**: Namespaced (e.g., `webdav.list`, `webdav.read`)

### Patterns
- Use `async`/`await` for all async operations
- Server code must run under Node's type stripping (erasable TypeScript only)

## Development Workflow

### Running the App
```bash
npm run dev        # Vite :4000 + server :4100
```

### Testing
```bash
npm test           # Vitest unit + round-trip
npm run test:e2e   # Playwright (starts test WebDAV :4081 and app :4101)
```

### Red-Green Testing (Critical)
When fixing bugs or adding features, **always verify the test fails before applying the fix**:

1. **RED**: Write/update test that should catch the bug → run it → confirm it **fails**
2. **GREEN**: Apply the fix → run test again → confirm it **passes**

**Why this matters:**
- A test that passes both before and after a fix proves nothing
- Tests must exercise the actual code path, not an artificial bypass
- E2E tests should mimic real user behavior (e.g., authenticate through the real access-key flow, not injected cookies)

**Anti-pattern example:**
```javascript
// BAD: Artificially setting a cookie that the real app never sets
await page.context().addCookies([{ name: 'auth_token', value: token }]);

// GOOD: Set auth the same way the real app does
await page.evaluate((token) => {
  localStorage.setItem('Meteor.loginToken', token);
}, token);
```

If you can't make the test fail first, the test is likely not testing what you think it's testing.

## Development Philosophy

### Start Simple, Grow Naturally
- **Flat structure first**: Keep files at the root level until organization becomes necessary

### YAGNI Principle
- Only build what you need right now
- Don't create "future-proof" abstractions

### When to Refactor
- When you copy-paste code 3+ times -> extract to function
- When a file exceeds 300 lines -> consider splitting
- When a pattern becomes clear -> then abstract it

## Notes
This file will evolve as the project grows and patterns emerge.

## References
The original Meteor implementation on `main` is the reference for iPad/IME fixes and UI behavior.

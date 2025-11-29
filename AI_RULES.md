# AI Development Rules for Makora

## Project Overview
Makora is a WYSIWYG markdown editor with WebDAV backend support. It provides a clean, distraction-free editing experience for markdown files stored on any WebDAV-compatible server (Nextcloud, ownCloud, etc.).

## Technology Stack
- **Framework**: Meteor.js 3.x
- **Frontend**: React 18.x with Tiptap editor
- **Editor**: Tiptap (ProseMirror-based WYSIWYG)
- **Styling**: Tailwind CSS
- **Storage**: WebDAV (remote file system)
- **Testing**: Playwright (E2E), Mocha (unit)
- **Language**: JavaScript (ES6+)

## Project Structure
```
/client             # Client entry point
/server             # Server entry point
/imports
  /api/server       # WebDAV methods and server-side logic
  /ui               # React components (App, Editor, FileBrowser, etc.)
/public             # Static assets
/tests              # Test setup and fixtures
  /fixtures/webdav  # Test WebDAV content
/e2e                # Playwright E2E tests
```

## Key Components
- **App.jsx**: Main application with routing and file loading
- **Editor.jsx**: Tiptap WYSIWYG editor wrapper
- **FileBrowser.jsx**: Tree view file browser with WebDAV integration
- **webdav.js**: Server-side WebDAV methods (list, read, write)

## Configuration
WebDAV settings are stored in `settings.json` (or `settings-local.json` for dev):
```json
{
  "webdav": {
    "url": "https://your-server.com/remote.php/dav/files/username",
    "username": "your-username",
    "password": "your-password"
  }
}
```

## Code Conventions

### File Organization
- Place all application code inside `/imports` directory
- Use ES6 `import`/`export` modules
- Client code: `/imports/ui`
- Server code: `/imports/api/server`

### Naming Conventions
- **Components**: PascalCase (e.g., `FileBrowser.jsx`)
- **Methods**: Namespaced (e.g., `webdav.list`, `webdav.read`)

### Meteor Patterns
- Use `async`/`await` for all async operations
- Use `Meteor.callAsync()` for method calls from client
- Settings via `Meteor.settings`

## Development Workflow

### Running the App
```bash
npm start          # Dev server on port 4000
```

### Testing
```bash
npm test           # Run all E2E tests (Playwright)
npm run test:unit  # Run unit tests (Mocha)
```

The E2E test suite:
- Automatically starts a Node.js WebDAV server on port 4080
- Starts Meteor on port 4010 for test isolation
- Runs 13 tests covering file browsing, editing, and saving
- Cleans up all services after tests

### Test Structure
- Tests in `/e2e/*.spec.ts` (Playwright)
- Test fixtures in `/tests/fixtures/webdav/`
- Global setup/teardown in `/tests/global-setup.ts` and `/tests/global-teardown.ts`

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
Use meteor-docs.txt as reference on Meteor development.

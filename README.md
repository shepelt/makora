# Makora

A WYSIWYG markdown editor with WebDAV backend support. Edit your markdown files stored on Nextcloud, ownCloud, or any WebDAV-compatible server with a clean, distraction-free interface.

## Features

- **WYSIWYG Editing**: Rich text editing powered by Tiptap (ProseMirror)
- **WebDAV Integration**: Connect to any WebDAV server
- **File Browser**: Tree view navigation with folder expansion
- **Keyboard Shortcuts**: Familiar shortcuts for formatting and saving
- **Live Preview**: See formatted content as you type
- **Markdown Preservation**: Maintains markdown formatting on save

## Quick Start

### Prerequisites
- Node.js 18+
- Meteor 3.x (`npm install -g meteor`)

### Installation

```bash
git clone https://github.com/shepelt/makora.git
cd makora
npm install
```

### Configuration

Create a `settings-local.json` file with your WebDAV credentials:

```json
{
  "webdav": {
    "url": "https://your-server.com/remote.php/dav/files/username",
    "username": "your-username",
    "password": "your-password"
  }
}
```

See `settings-local.json.example` for reference.

### Running

```bash
npm start
```

Open http://localhost:4000 in your browser.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl + S | Save file |
| Cmd/Ctrl + B | Bold |
| Cmd/Ctrl + I | Italic |
| Cmd/Ctrl + 1-6 | Heading 1-6 |
| Cmd/Ctrl + 0 | Paragraph |
| Cmd/Ctrl + Shift + Q | Blockquote |
| Cmd/Ctrl + Shift + K | Code block |
| Cmd/Ctrl + Shift + O | Ordered list |
| Cmd/Ctrl + Shift + U | Bullet list |

## Testing

Run the full E2E test suite:

```bash
npm test
```

This automatically:
- Starts a test WebDAV server
- Launches the app on a test port
- Runs Playwright tests
- Cleans up after completion

Run unit tests:

```bash
npm run test:unit
```

## Tech Stack

- **Meteor.js 3.x** - Full-stack framework
- **React 18** - UI components
- **Tiptap** - WYSIWYG editor (ProseMirror-based)
- **Tailwind CSS** - Styling
- **Playwright** - E2E testing

## Project Structure

```
makora/
├── client/          # Client entry point
├── server/          # Server entry point
├── imports/
│   ├── api/server/  # WebDAV methods
│   └── ui/          # React components
├── tests/           # Test setup & fixtures
├── e2e/             # Playwright tests
└── public/          # Static assets
```

## License

MIT

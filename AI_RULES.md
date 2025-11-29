# AI Development Rules for Makora

## Project Overview
Makora is a Meteor.js application.

## Technology Stack
- **Framework**: Meteor.js 3.x
- **Frontend**: React 18.2
- **Language**: JavaScript (ES6+)
- **Database**: MongoDB
- **Build System**: Meteor modern build stack

## Project Structure
Follow the canonical Meteor.js application structure:

```
/client             # Client entry point
/server             # Server entry point
/imports
  /api              # Collections, Methods, Publications
  /ui               # React components
/public             # Static assets
/private            # Server-only assets
```

## Code Conventions

### File Organization
- Place all application code inside `/imports` directory
- Use ES6 `import`/`export` modules
- Client code: `/imports/ui`
- Server code: `/imports/api`
- Shared code: Can be in either, but avoid client-specific code in `/api`

### Naming Conventions
- **Collections**: PascalCase with "Collection" suffix (e.g., `ProjectsCollection`)
- **Components**: PascalCase (e.g., `BuilderCanvas.jsx`)
- **Files**: Match the exported component/module name
- **Methods**: camelCase (e.g., `projects.insert`)

### Meteor Patterns
- Use `async`/`await` for all database operations
- Collections: `new Mongo.Collection('name')`
- Methods: `Meteor.methods({ 'name': async function() {} })`
- Publications: `Meteor.publish('name', function() {})`
- Subscriptions: `useTracker()` for React components

## Development Philosophy

### Start Simple, Grow Naturally
- **Flat structure first**: Keep files at the root level until organization becomes necessary

### YAGNI Principle
- Only build what you need right now
- Don't create "future-proof" abstractions

### When to Refactor
- When you copy-paste code 3+ times → extract to function
- When a file exceeds 300 lines → consider splitting
- When a pattern becomes clear → then abstract it
- Never before

## Development Workflow
- Keep components small and focused
- Co-locate related files (component, styles, tests)
- Write clear, self-documenting code
- Follow Meteor Guide best practices
- **Development Server**: Run via `npm start`
  - Includes Hot Module Replacement (HMR) for instant UI updates
  - Auto-restarts server on backend code changes

## Testing
- **Test Framework**: Mocha via `meteortesting:mocha` package
- **Test Files**: `*.tests.js` files
- **Run All Tests**: `npm test`

## Notes
This file will evolve as the project grows and patterns emerge.

## References
Use meteor-docs.txt as reference on Meteor development.

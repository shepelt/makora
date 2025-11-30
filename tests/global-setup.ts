import { spawn, ChildProcess } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

let meteorProcess: ChildProcess | null = null;
let webdavProcess: ChildProcess | null = null;

async function globalSetup() {
  console.log('Starting test environment...');

  // Pre-create directories that Playwright will write to (before Meteor starts)
  // This prevents directory creation from triggering Meteor's file watcher
  if (!existsSync('test-results')) mkdirSync('test-results', { recursive: true });
  if (!existsSync('playwright-report')) mkdirSync('playwright-report', { recursive: true });

  // Create test settings file first (before any file watching starts)
  const testSettings = {
    public: {
      disableAuth: true
    },
    webdav: {
      url: 'http://localhost:4080',
      username: 'test',
      password: 'test'
    }
  };
  writeFileSync('settings-test.json', JSON.stringify(testSettings, null, 2));

  // Start Node.js WebDAV server
  console.log('Starting WebDAV server...');
  const webdavScript = `
    const webdav = require('webdav-server').v2;

    // Create user manager with test user
    const userManager = new webdav.SimpleUserManager();
    const testUser = userManager.addUser('test', 'test', false);

    // Create privilege manager
    const privilegeManager = new webdav.SimplePathPrivilegeManager();
    privilegeManager.setRights(testUser, '/', ['all']);

    const server = new webdav.WebDAVServer({
      port: 4080,
      httpAuthentication: new webdav.HTTPBasicAuthentication(userManager, 'Test WebDAV'),
      privilegeManager: privilegeManager,
      rootFileSystem: new webdav.PhysicalFileSystem('./tests/fixtures/webdav')
    });

    server.start(() => console.log('WebDAV server running on port 4080'));
  `;
  writeFileSync('.webdav-server.js', webdavScript);

  webdavProcess = spawn('node', ['.webdav-server.js'], {
    stdio: 'inherit',
    detached: true
  });
  writeFileSync('/tmp/makora-webdav-test-pid', String(webdavProcess.pid));

  // Wait for WebDAV to be ready
  await waitForService('http://localhost:4080', 10000);
  console.log('WebDAV server ready');

  // Start Meteor app with test settings (separate port and local dir to avoid conflicts with dev server)
  console.log('Starting Meteor app...');
  meteorProcess = spawn('meteor', ['run', '--settings', 'settings-test.json', '--port', '4010'], {
    stdio: 'inherit',
    detached: true,
    env: {
      ...process.env,
      METEOR_LOCAL_DIR: '.meteor-test',
    }
  });
  writeFileSync('/tmp/makora-meteor-test-pid', String(meteorProcess.pid));

  // Wait for Meteor to be ready
  await waitForService('http://localhost:4010', 120000);
  console.log('Meteor app ready');

  // Wait for server to stabilize
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Clear any existing test user WebDAV settings (they might be pointing to real servers)
  // This ensures the test uses the global settings from settings-test.json
  try {
    const response = await fetch('http://localhost:4010/clear-test-user', { method: 'POST' });
    // Ignore errors - the endpoint might not exist yet
  } catch {
    // Endpoint doesn't exist, will add it
  }

  console.log('Test environment ready!');
}

async function waitForService(url: string, timeout: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 401) {
        return;
      }
    } catch {
      // Service not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Service at ${url} did not start within ${timeout}ms`);
}

export default globalSetup;

import { existsSync, readFileSync, unlinkSync } from 'fs';

async function globalTeardown() {
  console.log('Stopping test environment...');

  // Stop Meteor app
  const meteorPidFile = '/tmp/makora-meteor-test-pid';
  if (existsSync(meteorPidFile)) {
    const pid = readFileSync(meteorPidFile, 'utf-8').trim();
    try {
      process.kill(-Number(pid), 'SIGTERM');
      console.log('Meteor app stopped');
    } catch {
      console.log('Meteor process already stopped');
    }
    unlinkSync(meteorPidFile);
  }

  // Stop WebDAV server
  const webdavPidFile = '/tmp/makora-webdav-test-pid';
  if (existsSync(webdavPidFile)) {
    const pid = readFileSync(webdavPidFile, 'utf-8').trim();
    try {
      process.kill(Number(pid), 'SIGTERM');
      console.log('WebDAV server stopped');
    } catch {
      console.log('WebDAV process already stopped');
    }
    unlinkSync(webdavPidFile);
  }

  // Clean up temp files
  const filesToClean = ['settings-test.json', '.env.test', '.webdav-server.js'];
  for (const file of filesToClean) {
    if (existsSync(file)) {
      unlinkSync(file);
    }
  }

  console.log('Test environment stopped');
}

export default globalTeardown;

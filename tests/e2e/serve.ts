// Starts a fresh WebDAV test server and the Makora server for E2E tests.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { startWebdav } from '../webdav-server.ts';

export const E2E = {
  davDir: '/tmp/makora-e2e-webdav',
  davPort: 4081,
  appPort: 4101,
  key: 'e2e-key',
  prefix: '/remote.php/dav/files/test',
};

rmSync(E2E.davDir, { recursive: true, force: true });
mkdirSync(E2E.davDir, { recursive: true });
cpSync('tests/fixtures/webdav', E2E.davDir, { recursive: true });
// Emulate Apache's gzip ETag suffix (as on a typical Nextcloud) so saves are
// tested against the server behavior that bit us in practice.
await startWebdav(E2E.davPort, E2E.davDir, { prefix: E2E.prefix, apacheGzipEtags: true });

const app = spawn('node', ['server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(E2E.appPort), MAKORA_ALLOW_PRIVATE: '1', MAKORA_ACCESS_KEY: E2E.key },
});
process.on('SIGTERM', () => app.kill());
process.on('SIGINT', () => app.kill());

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DAV_DIR = '/tmp/makora-e2e-webdav';
const DAV_URL = 'http://localhost:4081/remote.php/dav/files/test';

async function connect(page: Page) {
  await page.goto('/?key=e2e-key');
  await page.getByLabel('Server URL').fill(DAV_URL);
  await page.getByLabel('Username').fill('test');
  await page.getByLabel('Password').fill('test');
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  await expect(page.getByRole('navigation', { name: 'Files' })).toBeVisible();
}

test('relative and root-relative WebDAV images render, file untouched', async ({ page }) => {
  const original = readFileSync(join(DAV_DIR, 'image-test.md'), 'utf8');
  await connect(page);
  await page.getByRole('navigation', { name: 'Files' }).getByTitle('image-test.md', { exact: true }).click();
  const img = (alt: string) => page.locator(`.makora-editor img[alt="${alt}"]`).first();
  for (const alt of ['relative image', 'absolute image']) {
    await expect(img(alt)).toHaveAttribute('src', /\/api\/img\/images\/test-image\.jpg$/);
    await expect.poll(() => img(alt).evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(100);
  }
  await page.waitForTimeout(3000); // past auto-save
  expect(readFileSync(join(DAV_DIR, 'image-test.md'), 'utf8')).toBe(original);
});

test('image endpoint: needs the sealed cookie, serves only images, sandboxed', async ({ page }) => {
  writeFileSync(join(DAV_DIR, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  // Without a seal: refused.
  await page.goto('/?key=e2e-key');
  expect((await page.request.get('/api/img/images/test-image.jpg')).status()).toBe(401);
  await connect(page);
  const jpg = await page.request.get('/api/img/images/test-image.jpg');
  expect(jpg.status()).toBe(200);
  expect(jpg.headers()['content-type']).toBe('image/jpeg');
  expect(jpg.headers()['content-security-policy']).toContain('sandbox');
  // A markdown file is not an image.
  expect((await page.request.get('/api/img/hello.md')).status()).toBe(415);
  // SVG is served only as an image, inside the sandbox.
  const svg = await page.request.get('/api/img/pic.svg');
  expect(svg.headers()['content-security-policy']).toContain('sandbox');
  // Seal requires our own origin (sent with a valid session, so only the Origin check can refuse it).
  const forged = await page.request.post('/api/seal', {
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    data: { url: DAV_URL, username: 'test', password: 'test' },
  });
  expect(forged.status()).toBe(403);
});

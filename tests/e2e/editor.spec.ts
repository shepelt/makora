import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DAV_DIR = '/tmp/makora-e2e-webdav';
const KEY = 'e2e-key';
const DAV_URL = 'http://localhost:4081/remote.php/dav/files/test';

let counter = 0;
// Each test gets its own file so projects/tests don't interfere.
function freshFile(project: string, body: string): string {
  const name = `e2e-${project}-${Date.now()}-${counter++}.md`;
  writeFileSync(join(DAV_DIR, name), body);
  return name;
}
const disk = (name: string) => readFileSync(join(DAV_DIR, name), 'utf8');

async function connect(page: Page) {
  await page.goto(`/?key=${KEY}`);
  await page.getByLabel('Server URL').fill(DAV_URL);
  await page.getByLabel('Username').fill('test');
  await page.getByLabel('Password').fill('test');
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  await expect(page.getByRole('navigation', { name: 'Files' })).toBeVisible();
}

async function openFile(page: Page, name: string) {
  const nav = page.getByRole('navigation', { name: 'Files' });
  // Newly created fixture files appear after a refresh.
  if (!(await nav.getByTitle(name).isVisible())) await page.getByTitle('Refresh').click();
  // On phones the file list and editor are separate screens.
  if (!(await nav.isVisible())) await page.getByRole('button', { name: 'Back to files' }).click();
  await nav.getByTitle(name).click();
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'clean');
}

async function typeAtEnd(page: Page, text: string) {
  const last = page.locator('.makora-editor .mu-content').last();
  await last.click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

test('rejects visitors without the access key', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(401);
  await expect(page.getByPlaceholder('Access key')).toBeVisible();
});

test('opens, edits and auto-saves without touching other lines', async ({ page }, info) => {
  const original = '# Title\n\nFirst paragraph.\n\n- one\n- two\n\nLast line\n';
  const name = freshFile(info.project.name, original);
  await connect(page);
  await openFile(page, name);
  await expect(page.locator('.makora-editor')).toContainText('First paragraph.');

  await typeAtEnd(page, ' plus');
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', /dirty|saving/);
  // Auto-save after a pause.
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'clean', { timeout: 10_000 });
  expect(disk(name)).toBe(original.replace('Last line\n', 'Last line plus\n'));
});

test('an untouched file is never rewritten', async ({ page }, info) => {
  const original = '|a|b|\n|-|-|\n|1|2|\n';
  const name = freshFile(info.project.name, original);
  await connect(page);
  await openFile(page, name);
  await page.waitForTimeout(3500); // longer than the auto-save delay
  expect(disk(name)).toBe(original);
});

test('a concurrent external edit causes a conflict, never an overwrite', async ({ page }, info) => {
  const name = freshFile(info.project.name, '# Doc\n\nmine\n');
  await connect(page);
  await openFile(page, name);

  // Someone else (another device, Claude Code) saves a new version.
  writeFileSync(join(DAV_DIR, name), '# Doc\n\ntheirs\n');

  await typeAtEnd(page, ' edited');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  const dialog = page.getByRole('dialog', { name: 'Conflict' });
  await expect(dialog).toBeVisible();
  expect(disk(name)).toBe('# Doc\n\ntheirs\n'); // not overwritten

  await dialog.getByRole('button', { name: /Keep both/ }).click();
  await expect(page.locator('.makora-editor')).toContainText('theirs');
  const copy = readdirSync(DAV_DIR).find((f) => f.startsWith(name.replace(/\.md$/, ' (conflict')));
  expect(copy).toBeTruthy();
  expect(disk(copy!)).toBe('# Doc\n\nmine edited\n');
});

test('picks up external changes when the file is clean', async ({ page }, info) => {
  const name = freshFile(info.project.name, '# Doc\n\nversion one\n');
  await connect(page);
  await openFile(page, name);
  writeFileSync(join(DAV_DIR, name), '# Doc\n\nversion two\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.makora-editor')).toContainText('version two');
});

test('unsaved edits survive a reload', async ({ page }, info) => {
  const name = freshFile(info.project.name, '# Doc\n\nbase\n');
  await connect(page);
  await openFile(page, name);
  // Simulate the server being unreachable so auto-save fails.
  await page.route('**/api/dav/**', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
  await typeAtEnd(page, ' draft');
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'error', { timeout: 10_000 });
  await page.unroute('**/api/dav/**');
  page.on('dialog', (d) => d.accept());
  await page.reload();
  await expect(page.locator('.makora-editor')).toContainText('base draft');
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', /dirty|saving|clean/);
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'clean', { timeout: 10_000 });
  expect(disk(name)).toBe('# Doc\n\nbase draft\n');
});

test('undo restores text (history still works with the Muya perf patches)', async ({ page }, info) => {
  const name = freshFile(info.project.name, '# Doc\n\nkeep this\n');
  await connect(page);
  await openFile(page, name);
  await typeAtEnd(page, ' TEMP');
  await expect(page.locator('.makora-editor')).toContainText('keep this TEMP');
  await page.waitForTimeout(200);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.locator('.makora-editor')).not.toContainText('TEMP');
  await expect(page.locator('.makora-editor')).toContainText('keep this');
});

test('reference-style links render and update', async ({ page }, info) => {
  const name = freshFile(info.project.name, 'See [the site][s].\n\n[s]: https://example.com\n');
  await connect(page);
  await openFile(page, name);
  await expect(page.locator('.makora-editor a[href="https://example.com"]').first()).toBeAttached();
});

test('a remembered folder that no longer exists is dropped silently; dot-folders are hidden', async ({ page }) => {
  await page.goto(`/?key=${KEY}`);
  await page.evaluate((url) => {
    // Per-server key, plus the old unscoped key from earlier versions.
    localStorage.setItem(`makora:openDirs:${url}|test`, JSON.stringify(['/Gone', '/AFolder']));
    localStorage.setItem('makora:openDirs', JSON.stringify(['/AlsoGone']));
  }, DAV_URL);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Files' });
  await expect(nav.getByTitle('AFolder', { exact: true })).toBeVisible();
  // The missing folder is forgotten (deterministic, unlike the old racy error banner).
  await expect
    .poll(() => page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('makora:openDirs')).map(([, v]) => v).join()))
    .not.toContain('Gone');
  await expect(page.getByText(/Could not list folder/)).toHaveCount(0);
  await expect(nav.getByTitle('.sync', { exact: true })).toHaveCount(0);
});

test('lossless save: only the edited line changes, untouched formatting survives', async ({ page }, info) => {
  // Muya alone would re-pad the table, collapse the blank lines and drop the
  // trailing-space hard break; none of that may reach the file.
  const original = '# Notes\n\n|a|b|\n|-|-|\n|1|2|\n\n\n\nhard break  \nnext line\n\n- item\n\nLast line\n';
  const name = freshFile(info.project.name, original);
  await connect(page);
  await openFile(page, name);
  await typeAtEnd(page, ' plus');
  await expect.poll(() => disk(name), { timeout: 10_000 }).not.toBe(original);
  expect(disk(name)).toBe(original.replace('Last line\n', 'Last line plus\n'));
});

test('lossless save also holds for consecutive saves', async ({ page }, info) => {
  const original = '|a|b|\n|-|-|\n\n\n\nfirst\n\nsecond\n';
  const name = freshFile(info.project.name, original);
  await connect(page);
  await openFile(page, name);
  await page.locator('.mu-content', { hasText: 'first' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 1');
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+s`);
  await expect.poll(() => disk(name), { timeout: 10_000 }).toBe('|a|b|\n|-|-|\n\n\n\nfirst 1\n\nsecond\n');
  await page.locator('.mu-content', { hasText: 'second' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 2');
  await page.keyboard.press(`${mod}+s`);
  await expect.poll(() => disk(name), { timeout: 10_000 }).toBe('|a|b|\n|-|-|\n\n\n\nfirst 1\n\nsecond 2\n');
});

test('caret at the end of a long file is scrolled into view and the scrollbar reaches the bottom', async ({ page }, info) => {
  test.skip(info.project.name === 'ipad', 'keyboard navigation test');
  // Long wrapped paragraphs, like a real journal: estimates of off-screen
  // block heights must not leave the scroll range short.
  const para = '가나다라 마바사 아자차카 타파하 '.repeat(30);
  const body = '# Long\n\n' + Array.from({ length: 60 }, (_, i) => `${i} ${para}`).join('\n\n') + '\n\nTHE END\n';
  const name = freshFile(info.project.name, body);
  await connect(page);
  await openFile(page, name);
  // Walk down with the arrow key, as a user does; Muya moves the caret
  // between blocks itself, so the view must follow.
  await page.locator('.makora-editor .mu-content').first().click();
  for (let i = 0; i < 1500; i++) {
    await page.keyboard.press('ArrowDown');
    if (i % 100 === 99 && (await page.evaluate(() => window.getSelection()?.focusNode?.textContent?.includes('THE END')))) break;
  }
  await page.waitForTimeout(300);
  const scroller = page.locator('#editor-scroll');
  const end = page.locator('.makora-editor .mu-content', { hasText: 'THE END' });
  await expect(end).toBeInViewport();
  const { top, height, client } = await scroller.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }));
  expect(top + client).toBeGreaterThan(height - 150); // at (or within the bottom padding of) the true bottom
});

test('scroll height is exact for long wrapped paragraphs (no off-screen estimates)', async ({ page }, info) => {
  const para = '가나다라 마바사 아자차카 타파하 '.repeat(30);
  const body = '# Long\n\n' + Array.from({ length: 200 }, (_, i) => `${i} ${para}`).join('\n\n') + '\n';
  const name = freshFile(info.project.name, body);
  await connect(page);
  await openFile(page, name);
  const scroller = page.locator('#editor-scroll');
  await page.waitForTimeout(1500); // let the post-load measuring pass run
  const skipped = await scroller.evaluate((el) => el.scrollHeight);
  const real = await scroller.evaluate(async (el) => {
    el.querySelector('.makora-editor')!.classList.add('cv-measure');
    const h = el.scrollHeight;
    el.querySelector('.makora-editor')!.classList.remove('cv-measure');
    return h;
  });
  expect(Math.abs(skipped - real)).toBeLessThan(real * 0.01);
});

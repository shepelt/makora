import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DAV_DIR = '/tmp/makora-e2e-webdav';
const DAV_URL = 'http://localhost:4081/remote.php/dav/files/test';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
let n = 0;
const fresh = (project: string, body: string) => {
  const name = `tb-${project}-${Date.now()}-${n++}.md`;
  writeFileSync(join(DAV_DIR, name), body);
  return name;
};
const disk = (name: string) => readFileSync(join(DAV_DIR, name), 'utf8');

async function openFresh(page: Page, name: string) {
  await page.goto('/?key=e2e-key');
  await page.getByLabel('Server URL').fill(DAV_URL);
  await page.getByLabel('Username').fill('test');
  await page.getByLabel('Password').fill('test');
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  const nav = page.getByRole('navigation', { name: 'Files' });
  await nav.getByTitle(name, { exact: true }).click();
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'clean');
}
// Save, then wait until the file on the server has the expected content.
const savedAs = async (page: Page, name: string, expected: string) => {
  await page.keyboard.press(`${MOD}+s`);
  await expect.poll(() => disk(name), { timeout: 10_000 }).toBe(expected);
};
const clickText = (page: Page, text: string) => page.locator('.mu-content', { hasText: text }).first().click();

test('Cmd/Ctrl+2 turns a paragraph into a heading, Cmd/Ctrl+0 back', async ({ page }, info) => {
  const name = fresh(info.project.name, '# T\n\nmake me a heading\n');
  await openFresh(page, name);
  await clickText(page, 'make me a heading');
  await page.keyboard.press(`${MOD}+2`);
  await savedAs(page, name, '# T\n\n## make me a heading\n');
  await clickText(page, 'make me a heading');
  await page.keyboard.press(`${MOD}+0`);
  await savedAs(page, name, '# T\n\nmake me a heading\n');
});

test('toolbar list dropdown converts a whole list and keeps every item', async ({ page }, info) => {
  const name = fresh(info.project.name, '# T\n\n- one\n- two\n- three\n');
  await openFresh(page, name);
  await clickText(page, 'two');
  await page.getByTestId('toolbar-list').click();
  await page.getByTestId('toolbar-list-order-list').click();
  await savedAs(page, name, '# T\n\n1. one\n2. two\n3. three\n');
});

test('toolbar heading dropdown and indent work', async ({ page }, info) => {
  const name = fresh(info.project.name, '# T\n\n- one\n- two\n\npara\n');
  await openFresh(page, name);
  await clickText(page, 'para');
  await page.getByTestId('toolbar-heading').click();
  await page.getByTestId('toolbar-heading-3').click();
  await clickText(page, 'two');
  await page.getByTestId('toolbar-indent').click();
  await savedAs(page, name, '# T\n\n- one\n  - two\n\n### para\n');
});

test('context menu: new folder, rename and delete', async ({ page }, info) => {
  test.skip(info.project.name === 'ipad', 'right-click context menu is a desktop interaction');
  const name = fresh(info.project.name, 'x\n');
  await openFresh(page, name);
  const nav = page.getByRole('navigation', { name: 'Files' });

  await nav.getByTitle('AFolder', { exact: true }).click({ button: 'right' });
  await page.getByRole('menu').getByText('New folder').click();
  const folder = `dir-${info.project.name}-${Date.now()}`;
  await page.getByPlaceholder('Folder name').fill(folder);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(nav.getByTitle(folder, { exact: true })).toBeVisible();
  expect(existsSync(join(DAV_DIR, 'AFolder', folder))).toBe(true);

  await nav.getByTitle(name, { exact: true }).click({ button: 'right' });
  await page.getByRole('menu').getByText('Rename').click();
  const renamed = name.replace('.md', '-renamed.md');
  await page.getByPlaceholder('New name').fill(renamed);
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(nav.getByTitle(renamed, { exact: true })).toBeVisible();
  expect(existsSync(join(DAV_DIR, renamed))).toBe(true);

  await nav.getByTitle(renamed, { exact: true }).click({ button: 'right' });
  await page.getByRole('menu').getByText('Delete').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(nav.getByTitle(renamed, { exact: true })).toHaveCount(0);
  expect(existsSync(join(DAV_DIR, renamed))).toBe(false);
});

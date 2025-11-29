import { test, expect, Page } from '@playwright/test';
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Store original file content for cleanup
const testFilePath = resolve('./tests/fixtures/webdav/test.md');
let originalContent: string;

// Helper to wait for app to be fully loaded (handles server restarts)
async function waitForAppReady(page: Page) {
  // Wait for the file browser to show files (indicates app is connected to WebDAV)
  // Use exact match to avoid matching image-test.md
  await expect(page.getByText('test.md', { exact: true }).first()).toBeVisible({ timeout: 20000 });
}

test.describe('Makora Editor', () => {
  // Clear test user settings before all tests to ensure we use the test WebDAV server
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    // Call the clear settings method via browser console
    await page.evaluate(async () => {
      // @ts-ignore - Meteor is available in the browser
      if (typeof Meteor !== 'undefined') {
        try {
          await Meteor.callAsync('debug.clearTestUserSettings');
        } catch (e) {
          console.log('Could not clear test user settings:', e);
        }
      }
    });
    await page.close();
  });

  test('shows welcome screen when no file is selected', async ({ page }) => {
    await page.goto('/');

    // Should show welcome screen with keyboard shortcuts
    await expect(page.locator('h2', { hasText: 'Makora' })).toBeVisible();
    await expect(page.getByText('Keyboard Shortcuts')).toBeVisible();
    await expect(page.getByText('Save file')).toBeVisible();
  });

  test('displays file browser with files', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Should show file browser with root folder
    await expect(page.getByText('Root')).toBeVisible();

    // Should show test.md file (already checked by waitForAppReady)
    await expect(page.getByText('test.md', { exact: true })).toBeVisible();

    // Should show Subfolder directory
    await expect(page.getByText('Subfolder')).toBeVisible();
  });

  test('opens a file when clicked', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Click on test.md
    await page.getByText('test.md', { exact: true }).click();

    // Should show loading spinner then content
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Header should show filename (use first() since it also appears in file browser)
    await expect(page.getByText('test.md', { exact: true }).first()).toBeVisible();
  });

  test('expands directory when clicked', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Click on Subfolder to expand
    await page.getByText('Subfolder').click();

    // Should show nested.md after expansion
    await expect(page.getByText('nested.md')).toBeVisible({ timeout: 5000 });
  });

  test('opens nested file', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Expand Subfolder
    await page.getByText('Subfolder').click();
    await expect(page.getByText('nested.md')).toBeVisible({ timeout: 5000 });

    // Click nested file
    await page.getByText('nested.md').click();

    // Should load content
    await expect(page.getByText('Nested File')).toBeVisible({ timeout: 10000 });
  });

  test('can edit file content', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test.md
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Click in editor and type
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n\nNew content added by test');

    // Verify content appears
    await expect(page.getByText('New content added by test')).toBeVisible();
  });

  test('shows save button when file is open', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // No save button initially
    await expect(page.getByRole('button', { name: /save/i })).not.toBeVisible();

    // Open file
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Save button should appear
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
  });

  test('context menu opens on right-click directory', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Right-click on Subfolder
    await page.getByText('Subfolder').click({ button: 'right' });

    // Context menu should appear
    await expect(page.getByText('Open in new tab')).toBeVisible();
  });

  test('refresh button reloads file list', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Click refresh
    await page.getByTitle('Refresh').click();

    // Files should still be visible after refresh
    await expect(page.getByText('test.md', { exact: true })).toBeVisible();
  });

  test('preserves path param when opening file', async ({ page }) => {
    // Start with path param
    await page.goto('/?path=/Subfolder');

    // Should show nested.md directly (wait longer for app to load with path param)
    await expect(page.getByText('nested.md')).toBeVisible({ timeout: 15000 });

    // Click to open
    await page.getByText('nested.md').click();

    // URL should still have path param
    await expect(page).toHaveURL(/path=%2FSubfolder/);
  });
});

test.describe.serial('Makora Editing', () => {
  // Run editing tests serially since they modify shared test file
  // Save original content before editing tests and restore after
  test.beforeAll(() => {
    originalContent = readFileSync(testFilePath, 'utf-8');
  });

  test.afterEach(() => {
    // Restore original content after each test to ensure isolation
    writeFileSync(testFilePath, originalContent);
  });

  // Helper to click test.md in file browser (not header)
  const clickTestFile = async (page: any) => {
    await waitForAppReady(page);
    // Target file browser item specifically (has truncate class), not header
    await page.locator('.truncate').getByText('test.md', { exact: true }).click();
  };

  test('saves file with button click and preserves existing content', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test.md
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Verify existing content before edit
    await expect(page.getByText('Bullet point one')).toBeVisible();
    await expect(page.getByText('Bold text')).toBeVisible();

    // Add unique content at the end
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.press('Control+End');
    const timestamp = Date.now();
    await page.keyboard.type(`\n\nEdited via button ${timestamp}`);

    // Click save button and wait for completion
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // Wait for save to complete (button returns to "Save" state)
    await expect(saveButton).not.toBeDisabled({ timeout: 5000 });
    await page.waitForTimeout(500); // Brief wait for file write

    // Reload page and verify content persisted
    await page.reload();
    await clickTestFile(page);

    // Verify new content exists
    await expect(page.getByText(`Edited via button ${timestamp}`)).toBeVisible({ timeout: 10000 });

    // IMPORTANT: Verify existing content was NOT corrupted
    await expect(page.getByText('Test Document')).toBeVisible();
    await expect(page.getByText('Bullet point one')).toBeVisible();
    await expect(page.getByText('Bullet point two')).toBeVisible();
    await expect(page.getByText('Bold text')).toBeVisible();
    await expect(page.getByText('italic text')).toBeVisible();
  });

  test('saves file with keyboard shortcut Cmd/Ctrl+S', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test.md
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Add unique content
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.press('Control+End');
    const timestamp = Date.now();
    await page.keyboard.type(`\n\nEdited via Ctrl+S ${timestamp}`);

    // Save with Ctrl+S (or Cmd+S on Mac - Playwright normalizes this)
    await page.keyboard.press('Control+s');

    // Wait for save to complete
    const saveButton = page.getByRole('button', { name: /save/i });
    await expect(saveButton).not.toBeDisabled({ timeout: 5000 });
    await page.waitForTimeout(500);

    // Reload and verify
    await page.reload();
    await clickTestFile(page);
    await expect(page.getByText(`Edited via Ctrl+S ${timestamp}`)).toBeVisible({ timeout: 10000 });
  });

  test('preserves markdown formatting after save', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test.md
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Verify existing formatting is preserved (bold, italic, code block, lists)
    await expect(page.getByText('Bold text')).toBeVisible();
    await expect(page.getByText('italic text')).toBeVisible();
    await expect(page.getByText("console.log('Hello world')")).toBeVisible();
    await expect(page.getByText('Bullet point one')).toBeVisible();

    // Add new formatted content using bold shortcut
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('NewBoldText');
    await page.keyboard.press('Control+b');

    // Save
    await page.keyboard.press('Control+s');
    const saveButton = page.getByRole('button', { name: /save/i });
    await expect(saveButton).not.toBeDisabled({ timeout: 5000 });
    await page.waitForTimeout(500);

    // Reload and verify ALL formatting persisted
    await page.reload();
    await clickTestFile(page);

    // New content
    await expect(page.getByText('NewBoldText')).toBeVisible({ timeout: 10000 });

    // Original formatting still intact
    await expect(page.getByText('Test Document')).toBeVisible();
    await expect(page.getByText('Bold text')).toBeVisible();
    await expect(page.getByText('italic text')).toBeVisible();
    await expect(page.getByText("console.log('Hello world')")).toBeVisible();
    await expect(page.getByText('Bullet point one')).toBeVisible();
  });
});

test.describe('Makora Images', () => {
  const imageTestFilePath = resolve('./tests/fixtures/webdav/image-test.md');
  let originalImageContent: string;

  test.beforeAll(() => {
    originalImageContent = readFileSync(imageTestFilePath, 'utf-8');
  });

  test.afterEach(() => {
    writeFileSync(imageTestFilePath, originalImageContent);
  });

  test('renders images from markdown file', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Click on image-test.md
    await page.getByText('image-test.md').click();
    await expect(page.getByText('Image Test Document')).toBeVisible({ timeout: 10000 });

    // Should have images rendered (tiptap-markdown may render HTML images differently)
    const images = page.locator('.ProseMirror img');
    const count = await images.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Verify at least one image actually loaded (not broken)
    // naturalWidth/Height > 0 means the image data was successfully fetched
    // Check for reasonable size (> 10px) to catch corrupted/placeholder images
    const firstImage = images.first();
    await expect(firstImage).toBeVisible();
    const { naturalWidth, naturalHeight } = await firstImage.evaluate((el: HTMLImageElement) => ({
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
    }));
    expect(naturalWidth).toBeGreaterThan(10);
    expect(naturalHeight).toBeGreaterThan(10);
  });

  test('relative image uses webdav-proxy', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByText('image-test.md').click();
    await expect(page.getByText('Image Test Document')).toBeVisible({ timeout: 10000 });

    // Check that relative image src is transformed to use proxy
    const relativeImage = page.locator('.ProseMirror img').first();
    const src = await relativeImage.getAttribute('src');
    expect(src).toContain('/webdav-proxy');
    expect(src).toContain('test-image.jpg');
  });

  test('saves images back as markdown format', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByText('image-test.md').click();
    await expect(page.getByText('Image Test Document')).toBeVisible({ timeout: 10000 });

    // Add some text to trigger a change
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nEdited image test');

    // Save
    await page.keyboard.press('Control+s');
    const saveButton = page.getByRole('button', { name: /save/i });
    await expect(saveButton).not.toBeDisabled({ timeout: 5000 });
    await page.waitForTimeout(500);

    // Read saved file and verify images are in markdown format (not HTML)
    const savedContent = readFileSync(imageTestFilePath, 'utf-8');

    // Should have markdown image syntax
    expect(savedContent).toContain('![');
    expect(savedContent).toContain('](');

    // Should NOT have proxy URLs (images should be local paths)
    expect(savedContent).not.toContain('/webdav-proxy');
    // Should have image paths (either relative ./ or absolute /)
    expect(savedContent).toContain('images/test-image.jpg');
  });
});

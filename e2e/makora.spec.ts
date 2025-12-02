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

// Helper to set up authenticated session for image proxy
// This mimics how Meteor actually stores auth tokens (localStorage, not cookies)
async function setupAuthSession(page: Page) {
  await page.goto('/');
  // Wait for Meteor to be available
  await page.waitForFunction(() => typeof (window as any).Meteor !== 'undefined', { timeout: 15000 });

  // Create test user with token
  const result = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      // @ts-ignore - Meteor is available in browser
      Meteor.call('debug.createTestUserWithToken', (err: any, res: any) => {
        if (err) reject(new Error(err.reason || err.message));
        else resolve(res);
      });
    });
  }) as { token: string; userId: string };

  // Set the login token in localStorage (like Meteor does - NOT cookies)
  await page.evaluate((token: string) => {
    localStorage.setItem('Meteor.loginToken', token);
  }, result.token);

  // Reload so the client uses the token from localStorage
  await page.reload();
  await waitForAppReady(page);
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
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n\nNew content added by test');

    // Verify content appears
    await expect(page.getByText('New content added by test')).toBeVisible();
  });

  test('typing inserts at cursor position not at end (issue #14)', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test.md
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Wait for editor to initialize
    await page.waitForTimeout(500);

    // Click in the middle of the document (specifically after "Test Document" heading)
    const testDocHeading = page.getByRole('heading', { name: 'Test Document' });
    await testDocHeading.click();

    // Move cursor to end of the heading
    await page.keyboard.press('End');

    // Wait a bit for cursor position to settle
    await page.waitForTimeout(200);

    // Type a unique marker that should appear right after the heading
    const marker = 'INSERTED_HERE';
    await page.keyboard.type(marker);

    // Wait for content to update
    await page.waitForTimeout(100);

    // Verify the marker appears right after the heading (not at the end)
    // The marker should be visible immediately after "Test Document"
    await expect(page.getByText('Test Document').locator('..').getByText(marker)).toBeVisible();

    // Additionally check that it's not at the very end by looking at text position
    const editorContent = await page.locator('.mu-editor').textContent();
    const markerPosition = editorContent?.indexOf(marker) || -1;
    const totalLength = editorContent?.length || 0;

    // If cursor position is preserved, marker should NOT be at the end
    // If bug exists, marker will be in the last 10% of content (close to the end)
    expect(markerPosition).toBeGreaterThan(0);
    // Marker should be before the last 50% of content (conservative check)
    expect(markerPosition).toBeLessThan(totalLength * 0.5);
  });

  test('shows save button when file is open', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // No save button initially (check icon button)
    await expect(page.getByTitle(/save|unsaved/i)).not.toBeVisible();

    // Open file
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Save button (check icon) should appear
    await expect(page.getByTitle(/save|unsaved/i)).toBeVisible();
  });

  test('undo keeps dirty flag due to redo history (O(1) tracking)', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open file
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Wait for editor to initialize
    await page.waitForTimeout(500);

    // Initially should show "No unsaved changes" (clean state)
    await expect(page.getByTitle('No unsaved changes')).toBeVisible();

    // Type something to make it dirty
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.waitForTimeout(200); // Let editor focus settle
    await page.keyboard.type('X');

    // Now should show unsaved indicator
    await expect(page.getByTitle(/Save changes/i)).toBeVisible({ timeout: 2000 });

    // Undo the change
    await page.keyboard.press('Control+z');

    // With O(1) history-based tracking, still shows dirty because redoDepth > 0
    // This is the expected tradeoff for O(1) performance
    await expect(page.getByTitle(/Save changes/i)).toBeVisible({ timeout: 2000 });
  });

  test('save clears dirty flag', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open file
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Wait for editor to initialize
    await page.waitForTimeout(500);

    // Initially should show "No unsaved changes" (clean state)
    await expect(page.getByTitle('No unsaved changes')).toBeVisible();

    // Type something to make it dirty
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.waitForTimeout(200);
    await page.keyboard.type('Y');

    // Now should show unsaved indicator (blue dot)
    await expect(page.getByTitle(/Save changes/i)).toBeVisible({ timeout: 2000 });

    // Save with Ctrl+S
    await page.keyboard.press('Control+s');

    // Wait for save to complete and dirty flag to clear
    await expect(page.getByTitle('No unsaved changes')).toBeVisible({ timeout: 5000 });
  });

  test('preserves undo history after save (like VS Code)', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open file
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Wait for editor to initialize
    await page.waitForTimeout(500);

    // Initially clean
    await expect(page.getByTitle('No unsaved changes')).toBeVisible();

    // Type a unique string to make it dirty
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('End');
    const uniqueText = 'UNIQUE_TEST_TEXT_12345';
    await page.keyboard.type(uniqueText);

    // Should be dirty (this confirms text was entered)
    await expect(page.getByTitle(/Save changes/i)).toBeVisible({ timeout: 2000 });

    // Save the file
    await page.keyboard.press('Control+s');
    await expect(page.getByTitle('No unsaved changes')).toBeVisible({ timeout: 5000 });

    // CRITICAL TEST: undo after save should still work (preserves history)
    await page.keyboard.press('Control+z');

    // After undo, the unique text should be gone
    await expect(page.getByText(uniqueText, { exact: true })).not.toBeVisible();

    // And the file should be dirty again (content differs from saved version)
    await expect(page.getByTitle(/Save changes/i)).toBeVisible({ timeout: 2000 });
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
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    const timestamp = Date.now();
    await page.keyboard.type(`\n\nEdited via button ${timestamp}`);

    // Click save button and wait for completion
    const saveButton = page.getByTitle(/save|unsaved/i);
    await saveButton.click();

    // Wait for save to complete
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
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    const timestamp = Date.now();
    await page.keyboard.type(`\n\nEdited via Ctrl+S ${timestamp}`);

    // Save with Ctrl+S (or Cmd+S on Mac - Playwright normalizes this)
    await page.keyboard.press('Control+s');

    // Wait for save to complete
    const saveButton = page.getByTitle(/save|unsaved/i);
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
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('NewBoldText');
    await page.keyboard.press('Control+b');

    // Save
    await page.keyboard.press('Control+s');
    const saveButton = page.getByTitle(/save|unsaved/i);
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

  test('saves new list item added to existing list (issue #26)', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test.md which has an existing bullet list
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Wait for editor to be ready
    await page.waitForTimeout(500);

    // Find and click at the end of "Bullet point two"
    const bulletTwo = page.getByText('Bullet point two');
    await bulletTwo.click();
    await page.keyboard.press('End');

    // Press Enter to create a new list item, then type
    await page.keyboard.press('Enter');
    const timestamp = Date.now();
    const newItemText = `New bullet item ${timestamp}`;
    await page.keyboard.type(newItemText);

    // Verify the new item appears in the editor
    await expect(page.getByText(newItemText)).toBeVisible({ timeout: 5000 });

    // Save the file
    await page.keyboard.press('Control+s');
    await expect(page.getByTitle('No unsaved changes')).toBeVisible({ timeout: 5000 });

    // Wait for save to complete
    await page.waitForTimeout(500);

    // Reload and verify the new list item persisted
    await page.reload();
    await clickTestFile(page);

    // The new list item should still be there after reload
    await expect(page.getByText(newItemText)).toBeVisible({ timeout: 10000 });

    // Original list items should also still exist
    await expect(page.getByText('Bullet point one')).toBeVisible();
    await expect(page.getByText('Bullet point two')).toBeVisible();
  });
});

test.describe('Makora Performance', () => {
  test('typing in large file should have low latency', async ({ page }) => {
    // Capture browser console logs
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      if (msg.text().includes('[PERF]')) {
        consoleLogs.push(msg.text());
      }
    });

    await page.goto('/');
    await waitForAppReady(page);

    // Open the large test file (~450KB)
    await page.getByText('large-perf-test.md').click();
    await expect(page.getByText('Large Performance Test Document')).toBeVisible({ timeout: 30000 });

    // Wait for editor to fully initialize
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('End');

    // Measure time to type characters one at a time (more accurate than bulk typing)
    const charCount = 30;
    const testChars = 'PERF_TEST_LARGE_FILE_LATENCY__';

    const times: number[] = [];
    for (let i = 0; i < charCount; i++) {
      const start = Date.now();
      await page.keyboard.type(testChars[i]);
      times.push(Date.now() - start);
    }

    const totalTime = times.reduce((a, b) => a + b, 0);
    const avgTimePerChar = totalTime / charCount;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);

    console.log(`Typing ${charCount} chars: total=${totalTime}ms, avg=${avgTimePerChar.toFixed(1)}ms/char, min=${minTime}ms, max=${maxTime}ms`);

    // Print browser-side performance logs
    if (consoleLogs.length > 0) {
      console.log('Browser performance logs:');
      consoleLogs.forEach(log => console.log('  ' + log));
    }

    // Verify text was typed
    await expect(page.getByText(testChars)).toBeVisible({ timeout: 10000 });

    // Assert performance: should be under 50ms per character
    // This is a generous threshold - good performance would be <10ms
    expect(avgTimePerChar).toBeLessThan(50);
  });

  test('O(1) dirty tracking - type, save, type, undo stays dirty', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open file
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Initially clean
    await expect(page.getByTitle('No unsaved changes')).toBeVisible();

    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('End');

    // Type first string
    await page.keyboard.type('AAA');
    await page.waitForTimeout(200);
    await expect(page.getByTitle(/Save changes/i)).toBeVisible({ timeout: 2000 });

    // Save - should become clean
    await page.keyboard.press('Control+s');
    await expect(page.getByTitle('No unsaved changes')).toBeVisible({ timeout: 5000 });

    // Type second string
    await page.waitForTimeout(500);
    await page.keyboard.type('BBB');
    await page.waitForTimeout(200);
    await expect(page.getByTitle(/Save changes/i)).toBeVisible({ timeout: 2000 });

    // Undo - with O(1) tracking, still dirty because redoDepth > 0
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    // Still shows dirty (this is the O(1) tradeoff)
    await expect(page.getByTitle(/Save changes/i)).toBeVisible({ timeout: 2000 });
  });

  test('O(1) dirty tracking - save clears dirty after undo', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open file
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('End');

    // Type, undo (still dirty due to redo history)
    await page.keyboard.type('AAA');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await expect(page.getByTitle(/Save changes/i)).toBeVisible({ timeout: 2000 });

    // Save should clear dirty flag (resets history tracking point)
    await page.keyboard.press('Control+s');
    await expect(page.getByTitle('No unsaved changes')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Makora Keyboard Shortcuts', () => {
  test('Cmd/Ctrl+1 converts paragraph to H1', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test.md
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Click in editor and type new text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nHeading Test Line');
    await page.waitForTimeout(100);

    // Verify text was typed
    await expect(page.getByText('Heading Test Line')).toBeVisible({ timeout: 5000 });

    // Apply H1 shortcut
    await page.keyboard.press('Control+1');
    await page.waitForTimeout(500);

    // Verify it became a heading (check for h1 element)
    await expect(page.locator('.mu-editor h1').getByText('Heading Test Line')).toBeVisible({ timeout: 5000 });
  });

  test('Cmd/Ctrl+2 converts paragraph to H2', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nH2 Test Line');

    await page.keyboard.press('Control+2');
    await page.waitForTimeout(200);

    await expect(page.locator('.mu-editor h2').getByText('H2 Test Line')).toBeVisible();
  });

  test('Cmd/Ctrl+0 converts heading back to paragraph', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nParagraph Test');

    // First make it a heading
    await page.keyboard.press('Control+1');
    await page.waitForTimeout(200);
    await expect(page.locator('.mu-editor h1').getByText('Paragraph Test')).toBeVisible();

    // Then convert back to paragraph
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(200);

    // Should no longer be a heading (check it's in a paragraph, not h1)
    await expect(page.locator('.mu-editor h1').getByText('Paragraph Test')).not.toBeVisible();
    await expect(page.getByText('Paragraph Test')).toBeVisible();
  });

  test('heading shortcuts preserve existing text', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nPreserve This Text Content');

    // Apply H3 shortcut
    await page.keyboard.press('Control+3');
    await page.waitForTimeout(200);

    // Text should be preserved in the heading
    await expect(page.locator('.mu-editor h3').getByText('Preserve This Text Content')).toBeVisible();
  });

  test('can cycle through heading levels', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nCycling Heading');

    // H1
    await page.keyboard.press('Control+1');
    await page.waitForTimeout(100);
    await expect(page.locator('.mu-editor h1').getByText('Cycling Heading')).toBeVisible();

    // H4
    await page.keyboard.press('Control+4');
    await page.waitForTimeout(100);
    await expect(page.locator('.mu-editor h4').getByText('Cycling Heading')).toBeVisible();

    // H6
    await page.keyboard.press('Control+6');
    await page.waitForTimeout(100);
    await expect(page.locator('.mu-editor h6').getByText('Cycling Heading')).toBeVisible();

    // Back to paragraph
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(100);
    await expect(page.locator('.mu-editor h6').getByText('Cycling Heading')).not.toBeVisible();
  });

  test('Cmd/Ctrl+B applies bold to current word (no selection)', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Click in editor and type a word
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nBoldWord here');
    await page.waitForTimeout(100);

    // Move cursor to middle of "BoldWord" (position cursor inside the word)
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    // Apply bold shortcut (should select and bold the current word)
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(300);

    // Verify the word is now bold - look for strong element containing "BoldWord"
    await expect(page.locator('.mu-editor strong').getByText('BoldWord')).toBeVisible({ timeout: 5000 });
  });

  test('Cmd/Ctrl+B applies bold to selection', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Click in editor and type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nSelect this text');
    await page.waitForTimeout(100);

    // Select "this" by double-clicking or shift+arrow keys
    await page.keyboard.press('Home');
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('ArrowRight');
    }
    // Select "this"
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');

    // Apply bold shortcut
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(300);

    // Verify "this" is bold
    await expect(page.locator('.mu-editor strong').getByText('this')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Makora Lists', () => {
  test('new bullet list should be tight (no blank lines between items)', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test.md
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Click in editor and create a new bullet list
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n* First item');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second item');
    await page.waitForTimeout(200);

    // Verify the newly created list has mu-tight-list class (Typora default behavior)
    // In Typora, new lists are tight by default (no blank lines between items)
    // Use .last() to get the newly created list (not the existing one in test.md)
    const bulletList = page.locator('.mu-editor .mu-bullet-list').last();
    await expect(bulletList).toBeVisible({ timeout: 5000 });

    // Check that it has the tight-list class
    await expect(bulletList).toHaveClass(/mu-tight-list/);
  });

  test('new ordered list should be tight (no blank lines between items)', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test.md
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Click in editor and create a new ordered list
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n1. First numbered');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second numbered');
    await page.waitForTimeout(200);

    // Verify the list has mu-tight-list class
    const orderedList = page.locator('.mu-editor .mu-order-list');
    await expect(orderedList).toBeVisible({ timeout: 5000 });

    // Check that it has the tight-list class
    await expect(orderedList).toHaveClass(/mu-tight-list/);
  });
});

test.describe('Makora File Management', () => {
  // Test file management features: create, rename, delete

  // Helper to get context menu button by role
  const getContextMenuItem = (page: Page, name: string) =>
    page.locator('.fixed.bg-white.rounded.shadow-lg button').getByText(name, { exact: true });

  test('creates new file via context menu on directory', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Right-click on Subfolder to open context menu
    await page.getByText('Subfolder').click({ button: 'right' });
    await expect(getContextMenuItem(page, 'New file')).toBeVisible();

    // Click "New file"
    await getContextMenuItem(page, 'New file').click();

    // Dialog should appear
    const input = page.locator('input[placeholder="filename.md"]');
    await expect(input).toBeVisible();

    // Enter filename
    const timestamp = Date.now();
    const filename = `test-created-${timestamp}`;
    await input.fill(filename);

    // Click Create
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for dialog to close and file to appear
    await expect(input).not.toBeVisible({ timeout: 10000 });

    // The file should be created and opened - check header shows the filename
    // Use .first() since file may appear in both header and file browser (if parent is auto-expanded)
    await expect(page.getByText(`${filename}.md`).first()).toBeVisible({ timeout: 10000 });

    // Clean up - delete the created file via clicking refresh then using context menu
    await page.getByTitle('Refresh').click();
    await page.waitForTimeout(500);

    // Expand Subfolder to see the file
    await page.getByText('Subfolder').click();
    await expect(page.locator('.truncate').getByText(`${filename}.md`)).toBeVisible({ timeout: 5000 });

    // Right-click to delete
    await page.locator('.truncate').getByText(`${filename}.md`).click({ button: 'right' });
    await getContextMenuItem(page, 'Delete').click();
    await page.getByRole('button', { name: 'Delete' }).click();

    // Verify file is gone
    await expect(page.locator('.truncate').getByText(`${filename}.md`)).not.toBeVisible({ timeout: 5000 });
  });

  test('creates new folder via context menu', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Right-click on Subfolder
    await page.getByText('Subfolder').click({ button: 'right' });
    await expect(getContextMenuItem(page, 'New folder')).toBeVisible();

    // Click "New folder"
    await getContextMenuItem(page, 'New folder').click();

    // Dialog should appear
    const input = page.locator('input[placeholder="Folder name"]');
    await expect(input).toBeVisible();

    // Enter folder name
    const timestamp = Date.now();
    const folderName = `test-folder-${timestamp}`;
    await input.fill(folderName);

    // Click Create
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for dialog to close
    await expect(input).not.toBeVisible({ timeout: 10000 });

    // Expand Subfolder to see the new folder
    await page.getByText('Subfolder').click();
    await expect(page.locator('.truncate').getByText(folderName, { exact: true })).toBeVisible({ timeout: 5000 });

    // Clean up - delete the folder
    await page.locator('.truncate').getByText(folderName, { exact: true }).click({ button: 'right' });
    await getContextMenuItem(page, 'Delete').click();
    await page.getByRole('button', { name: 'Delete' }).click();

    // Verify folder is gone
    await expect(page.locator('.truncate').getByText(folderName, { exact: true })).not.toBeVisible({ timeout: 5000 });
  });

  test('renames file via context menu', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // First create a test file to rename
    await page.getByText('Subfolder').click({ button: 'right' });
    await getContextMenuItem(page, 'New file').click();
    const input = page.locator('input[placeholder="filename.md"]');
    const timestamp = Date.now();
    const originalName = `rename-test-${timestamp}`;
    await input.fill(originalName);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(input).not.toBeVisible({ timeout: 10000 });

    // Refresh and expand Subfolder to see the file
    await page.getByTitle('Refresh').click();
    await page.waitForTimeout(500);
    await page.getByText('Subfolder').click();
    await expect(page.locator('.truncate').getByText(`${originalName}.md`)).toBeVisible({ timeout: 5000 });

    // Right-click on the file to rename
    await page.locator('.truncate').getByText(`${originalName}.md`).click({ button: 'right' });
    await expect(getContextMenuItem(page, 'Rename')).toBeVisible();
    await getContextMenuItem(page, 'Rename').click();

    // Rename dialog should appear with current name
    const renameInput = page.locator('input[placeholder="New name"]');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue(`${originalName}.md`);

    // Enter new name
    const newName = `renamed-${timestamp}.md`;
    await renameInput.fill(newName);
    await page.getByRole('button', { name: 'Rename' }).click();

    // Wait for dialog to close
    await expect(renameInput).not.toBeVisible({ timeout: 10000 });

    // Verify old name is gone and new name exists (after refresh)
    await page.getByTitle('Refresh').click();
    await page.waitForTimeout(500);
    await page.getByText('Subfolder').click();
    await expect(page.locator('.truncate').getByText(`${originalName}.md`)).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.truncate').getByText(newName)).toBeVisible({ timeout: 5000 });

    // Clean up - delete the renamed file
    await page.locator('.truncate').getByText(newName).click({ button: 'right' });
    await getContextMenuItem(page, 'Delete').click();
    await page.getByRole('button', { name: 'Delete' }).click();
  });

  test('deletes file via context menu with confirmation', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // First create a test file to delete
    await page.getByText('Subfolder').click({ button: 'right' });
    await getContextMenuItem(page, 'New file').click();
    const input = page.locator('input[placeholder="filename.md"]');
    const timestamp = Date.now();
    const filename = `delete-test-${timestamp}`;
    await input.fill(filename);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(input).not.toBeVisible({ timeout: 10000 });

    // Refresh and expand Subfolder to see the file
    await page.getByTitle('Refresh').click();
    await page.waitForTimeout(500);
    await page.getByText('Subfolder').click();
    await expect(page.locator('.truncate').getByText(`${filename}.md`)).toBeVisible({ timeout: 5000 });

    // Right-click on the file
    await page.locator('.truncate').getByText(`${filename}.md`).click({ button: 'right' });

    // Click Delete in context menu
    await getContextMenuItem(page, 'Delete').click();

    // Confirmation dialog should appear
    await expect(page.getByText('Delete file?')).toBeVisible();
    await expect(page.getByText(`Are you sure you want to delete "${filename}.md"?`)).toBeVisible();

    // Click Delete button in dialog
    await page.getByRole('button', { name: 'Delete' }).click();

    // File should be gone
    await expect(page.locator('.truncate').getByText(`${filename}.md`)).not.toBeVisible({ timeout: 5000 });
  });

  test('cancels delete operation', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Right-click on an existing file (use locator for file browser item)
    await page.locator('.truncate').getByText('test.md', { exact: true }).click({ button: 'right' });

    // Click Delete
    await getContextMenuItem(page, 'Delete').click();

    // Confirmation dialog should appear
    await expect(page.getByText('Delete file?')).toBeVisible();

    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Dialog should close
    await expect(page.getByText('Delete file?')).not.toBeVisible();

    // File should still exist
    await expect(page.locator('.truncate').getByText('test.md', { exact: true })).toBeVisible();
  });

  test('deleting open file closes editor', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Create a test file to delete
    await page.getByText('Subfolder').click({ button: 'right' });
    await getContextMenuItem(page, 'New file').click();
    const input = page.locator('input[placeholder="filename.md"]');
    const timestamp = Date.now();
    const filename = `delete-close-test-${timestamp}`;
    await input.fill(filename);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(input).not.toBeVisible({ timeout: 10000 });

    // Refresh and expand Subfolder to see the file
    await page.getByTitle('Refresh').click();
    await page.waitForTimeout(500);
    await page.getByText('Subfolder').click();
    const fileItem = page.locator('.truncate').getByText(`${filename}.md`);
    await expect(fileItem).toBeVisible({ timeout: 5000 });

    // Open the file in the editor
    await fileItem.click();

    // Wait for editor to load - file param should be in URL
    await expect(page).toHaveURL(new RegExp(`file=.*${filename}`), { timeout: 5000 });

    // Verify filename is shown in header (center span with specific class)
    const headerFilename = page.locator('span.text-warm-gray').getByText(`${filename}.md`);
    await expect(headerFilename).toBeVisible({ timeout: 5000 });

    // Right-click on the file in file browser and delete it
    await fileItem.click({ button: 'right' });
    await getContextMenuItem(page, 'Delete').click();
    await page.getByRole('button', { name: 'Delete' }).click();

    // File should be gone from file browser
    await expect(fileItem).not.toBeVisible({ timeout: 5000 });

    // Editor should be closed - file param should be removed from URL
    await expect(page).not.toHaveURL(/file=/, { timeout: 5000 });

    // File name should not be in header anymore
    await expect(headerFilename).not.toBeVisible();
  });

  test('creates new file via + button in header', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Click the + button in the header
    await page.getByTitle('New file').click();

    // Dialog should appear
    const input = page.locator('input[placeholder="filename.md"]');
    await expect(input).toBeVisible();

    // Enter filename
    const timestamp = Date.now();
    const filename = `header-created-${timestamp}`;
    await input.fill(filename);

    // Click Create
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for dialog to close - use longer timeout and check for success
    await page.waitForTimeout(1000);

    // Check for error message - if there's an error, log it
    const errorMsg = page.locator('.text-red-500');
    const hasError = await errorMsg.count() > 0;
    if (hasError) {
      const errorText = await errorMsg.textContent();
      console.log('Error creating file:', errorText);
    }

    // Wait for either dialog to close OR file to appear (use first() since it appears in header and file browser)
    await expect(page.getByText(`${filename}.md`).first()).toBeVisible({ timeout: 15000 });

    // Clean up - delete the created file (refresh first)
    await page.getByTitle('Refresh').click();
    await page.waitForTimeout(500);
    await page.locator('.truncate').getByText(`${filename}.md`).click({ button: 'right' });
    await getContextMenuItem(page, 'Delete').click();
    await page.getByRole('button', { name: 'Delete' }).click();
  });

  test('shows context menu for files (not just directories)', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Right-click on test.md (a file, not directory) - use locator for file browser
    await page.locator('.truncate').getByText('test.md', { exact: true }).click({ button: 'right' });

    // Context menu should show Rename and Delete for files
    await expect(getContextMenuItem(page, 'Rename')).toBeVisible();
    await expect(getContextMenuItem(page, 'Delete')).toBeVisible();

    // But NOT directory-specific options
    await expect(page.locator('.fixed.bg-white.rounded.shadow-lg').getByText('Open in new tab')).not.toBeVisible();
    await expect(page.locator('.fixed.bg-white.rounded.shadow-lg').getByText('New file')).not.toBeVisible();
    await expect(page.locator('.fixed.bg-white.rounded.shadow-lg').getByText('New folder')).not.toBeVisible();

    // Close context menu by clicking elsewhere (escape doesn't work for context menu)
    await page.click('body', { position: { x: 10, y: 10 } });
    await expect(getContextMenuItem(page, 'Rename')).not.toBeVisible();
  });

  test('escape key closes dialogs', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open new file dialog
    await page.getByTitle('New file').click();
    const input = page.locator('input[placeholder="filename.md"]');
    await expect(input).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Dialog should close
    await expect(input).not.toBeVisible({ timeout: 2000 });
  });

  test('highlights currently open file in file browser', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Initially no file should be highlighted (check for bg-blue-100 class)
    const testMdRow = page.locator('.truncate').getByText('test.md', { exact: true }).locator('..');
    await expect(testMdRow).not.toHaveClass(/bg-blue-100/);

    // Click on test.md to open it
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });

    // Now test.md row should have highlighting class (bg-blue-100)
    await expect(testMdRow).toHaveClass(/bg-blue-100/, { timeout: 5000 });

    // Click on another file (image-test.md)
    await page.getByText('image-test.md', { exact: true }).click();
    await expect(page.getByText('Image Test Document')).toBeVisible({ timeout: 10000 });

    // test.md should no longer be highlighted
    await expect(testMdRow).not.toHaveClass(/bg-blue-100/);

    // image-test.md should now be highlighted
    const imageTestRow = page.locator('.truncate').getByText('image-test.md', { exact: true }).locator('..');
    await expect(imageTestRow).toHaveClass(/bg-blue-100/);
  });

  test('auto-expands parent folders to show highlighted file in nested path', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // First expand Subfolder and click on a nested file
    await page.locator('.truncate').getByText('Subfolder', { exact: true }).click();
    await page.waitForTimeout(500);

    // Click on nested.md (in Subfolder)
    await page.locator('.truncate').getByText('nested.md', { exact: true }).click();
    await expect(page.getByText('Nested File')).toBeVisible({ timeout: 10000 });

    // Collapse the folder
    await page.locator('.truncate').getByText('Subfolder', { exact: true }).click();
    await page.waitForTimeout(300);

    // Verify nested.md is no longer visible (folder is collapsed)
    await expect(page.locator('.truncate').getByText('nested.md', { exact: true })).not.toBeVisible();

    // Refresh the page - the parent folder should auto-expand to show the active file
    await page.reload();
    await waitForAppReady(page);

    // Wait for auto-expand to happen
    await page.waitForTimeout(1000);

    // nested.md should be visible and highlighted (parent folder should have auto-expanded)
    const nestedRow = page.locator('.truncate').getByText('nested.md', { exact: true }).locator('..');
    await expect(page.locator('.truncate').getByText('nested.md', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(nestedRow).toHaveClass(/bg-blue-100/);
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
    await setupAuthSession(page);

    // Click on image-test.md
    await page.getByText('image-test.md').click();
    await expect(page.getByText('Image Test Document')).toBeVisible({ timeout: 10000 });

    // Should have images rendered (tiptap-markdown may render HTML images differently)
    const images = page.locator('.mu-editor img');
    const count = await images.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Verify at least one image actually loaded (not broken)
    // naturalWidth/Height > 0 means the image data was successfully fetched
    // Check for reasonable size (> 10px) to catch corrupted/placeholder images
    const firstImage = images.first();
    await expect(firstImage).toBeVisible();

    // Wait for image to load (naturalWidth becomes > 0 when loaded)
    await expect(async () => {
      const { naturalWidth } = await firstImage.evaluate((el: HTMLImageElement) => ({
        naturalWidth: el.naturalWidth,
      }));
      expect(naturalWidth).toBeGreaterThan(10);
    }).toPass({ timeout: 10000 });

    const { naturalWidth, naturalHeight } = await firstImage.evaluate((el: HTMLImageElement) => ({
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
    }));
    expect(naturalWidth).toBeGreaterThan(10);
    expect(naturalHeight).toBeGreaterThan(10);
  });

  test('relative image uses image-proxy with token', async ({ page }) => {
    await setupAuthSession(page);

    await page.getByText('image-test.md').click();
    await expect(page.getByText('Image Test Document')).toBeVisible({ timeout: 10000 });

    // Check that relative image src is transformed to use unified proxy with auth token
    const relativeImage = page.locator('.mu-editor img').first();
    const src = await relativeImage.getAttribute('src');
    expect(src).toContain('/image-proxy');
    expect(src).toContain('test-image.jpg');
    expect(src).toContain('?token='); // Must include auth token
  });

  test('client includes auth token in image URLs', async ({ page }) => {
    await setupAuthSession(page);

    // Open image-test.md
    await page.getByText('image-test.md').click();
    await expect(page.getByText('Image Test Document')).toBeVisible({ timeout: 10000 });

    // Verify the client includes auth token in image URLs (the actual fix)
    const relativeImage = page.locator('.mu-editor img').first();
    const src = await relativeImage.getAttribute('src');
    expect(src).toContain('/image-proxy');
    expect(src).toContain('?token='); // Client must include auth token

    // Verify image actually loads (not 401)
    const { naturalWidth, naturalHeight } = await relativeImage.evaluate((el: HTMLImageElement) => ({
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
    }));
    expect(naturalWidth).toBeGreaterThan(10);
    expect(naturalHeight).toBeGreaterThan(10);
  });

  test('proxy allows requests when auth disabled (test mode)', async ({ page, request }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // In test mode (disableAuth: true), proxy should allow requests without token
    // and use global WebDAV settings
    const response = await request.get('http://localhost:4010/webdav-proxy/images/test-image.jpg');
    expect(response.status()).toBe(200);
  });

  test('unified image-proxy allows external requests when auth disabled (test mode)', async ({ request }) => {
    // In test mode (disableAuth: true), unified image proxy should allow requests without token
    // Using placehold.co which returns an SVG image
    const externalUrl = 'https://placehold.co/600x400/EEE/31343C';
    // Encode as base64url (URL-safe base64 without padding)
    const base64url = Buffer.from(externalUrl).toString('base64url');
    const response = await request.get(`http://localhost:4010/image-proxy/ext/${base64url}`);
    expect(response.status()).toBe(200);

    // Verify we got an SVG image back
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('image/svg+xml');
  });

  test('unified image-proxy allows WebDAV requests when auth disabled (test mode)', async ({ request }) => {
    // In test mode, image-proxy should also work for WebDAV paths
    const response = await request.get('http://localhost:4010/image-proxy/images/test-image.jpg');
    expect(response.status()).toBe(200);

    // Verify we got an image back
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('image/');
  });

  test('saves images back as markdown format', async ({ page }) => {
    await setupAuthSession(page);

    await page.getByText('image-test.md').click();
    await expect(page.getByText('Image Test Document')).toBeVisible({ timeout: 10000 });

    // Add some text to trigger a change
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nEdited image test');

    // Save
    await page.keyboard.press('Control+s');
    const saveButton = page.getByTitle(/save|unsaved/i);
    await expect(saveButton).not.toBeDisabled({ timeout: 5000 });
    await page.waitForTimeout(500);

    // Read saved file and verify images are in markdown format (not HTML)
    const savedContent = readFileSync(imageTestFilePath, 'utf-8');

    // Should have markdown image syntax
    expect(savedContent).toContain('![');
    expect(savedContent).toContain('](');

    // Should NOT have proxy URLs (images should be local paths)
    expect(savedContent).not.toContain('/image-proxy');
    expect(savedContent).not.toContain('/webdav-proxy');
    // Should have image paths (either relative ./ or absolute /)
    expect(savedContent).toContain('images/test-image.jpg');
  });

  test('all images load without errors including external URLs', async ({ page }) => {
    await setupAuthSession(page);

    await page.getByText('image-test.md').click();
    await expect(page.getByText('Image Test Document')).toBeVisible({ timeout: 10000 });

    // Wait for images to load
    await page.waitForTimeout(3000);

    // Verify no "Load image failed" text appears
    const failedImages = page.locator('text=Load image failed');
    await expect(failedImages).toHaveCount(0);

    // Verify we have actual images rendered (should be 4: relative, absolute, html, external)
    const images = page.locator('.mu-editor img');
    await expect(images).toHaveCount(4, { timeout: 10000 });
  });
});

test.describe('Makora Editor Toolbar', () => {
  // Helper to wait for app ready and open a file
  const openTestFile = async (page: Page) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.getByText('test.md', { exact: true }).click();
    await expect(page.getByText('Test Document')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500); // Let editor initialize
  };

  test('toolbar is visible when file is open', async ({ page }) => {
    await openTestFile(page);

    // Toolbar should be visible
    await expect(page.getByTestId('editor-toolbar')).toBeVisible();

    // All toolbar buttons should be present
    await expect(page.getByTestId('toolbar-bold')).toBeVisible();
    await expect(page.getByTestId('toolbar-italic')).toBeVisible();
    await expect(page.getByTestId('toolbar-underline')).toBeVisible();
    await expect(page.getByTestId('toolbar-heading')).toBeVisible();
    await expect(page.getByTestId('toolbar-list')).toBeVisible();
    await expect(page.getByTestId('toolbar-indent')).toBeVisible();
    await expect(page.getByTestId('toolbar-outdent')).toBeVisible();
    await expect(page.getByTestId('toolbar-code')).toBeVisible();
  });

  test('bold button applies bold formatting', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nBoldTestWord');
    await page.waitForTimeout(100);

    // Select the word by triple-clicking or selecting all
    await page.keyboard.press('Home');
    // Move to start of "BoldTestWord"
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
    }

    // Click bold button (should select current word if no selection)
    await page.getByTestId('toolbar-bold').click();
    await page.waitForTimeout(300);

    // Verify bold formatting was applied
    await expect(page.locator('.mu-editor strong').getByText('BoldTestWord')).toBeVisible({ timeout: 5000 });
  });

  test('italic button applies italic formatting', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nItalicTestWord');
    await page.waitForTimeout(100);

    // Move cursor to be inside the word
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
    }

    // Click italic button
    await page.getByTestId('toolbar-italic').click();
    await page.waitForTimeout(300);

    // Verify italic formatting was applied
    await expect(page.locator('.mu-editor em').getByText('ItalicTestWord')).toBeVisible({ timeout: 5000 });
  });

  test('code button applies inline code formatting', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nCodeTestWord');
    await page.waitForTimeout(100);

    // Move cursor to be inside the word
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
    }

    // Click code button
    await page.getByTestId('toolbar-code').click();
    await page.waitForTimeout(300);

    // Verify code formatting was applied (inline code uses <code> tag)
    await expect(page.locator('.mu-editor code').getByText('CodeTestWord')).toBeVisible({ timeout: 5000 });
  });

  test('heading dropdown shows heading options including paragraph', async ({ page }) => {
    await openTestFile(page);

    // Click heading dropdown
    await page.getByTestId('toolbar-heading').click();

    // Paragraph option and all heading levels should be visible
    await expect(page.getByTestId('toolbar-heading-0')).toBeVisible(); // Paragraph
    await expect(page.getByTestId('toolbar-heading-1')).toBeVisible();
    await expect(page.getByTestId('toolbar-heading-2')).toBeVisible();
    await expect(page.getByTestId('toolbar-heading-3')).toBeVisible();
    await expect(page.getByTestId('toolbar-heading-4')).toBeVisible();
    await expect(page.getByTestId('toolbar-heading-5')).toBeVisible();
    await expect(page.getByTestId('toolbar-heading-6')).toBeVisible();
  });

  test('heading can be toggled back to paragraph', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nHeading Toggle Test');
    await page.waitForTimeout(100);

    // Make it H2
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-2').click();
    await page.waitForTimeout(200);
    await expect(page.locator('.mu-editor h2').getByText('Heading Toggle Test')).toBeVisible({ timeout: 5000 });

    // Convert back to paragraph
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-0').click();
    await page.waitForTimeout(200);

    // Should be paragraph now
    await expect(page.locator('.mu-editor h2').getByText('Heading Toggle Test')).not.toBeVisible();
    await expect(page.locator('.mu-editor .mu-paragraph').getByText('Heading Toggle Test')).toBeVisible({ timeout: 5000 });
  });

  test('list dropdown shows list options', async ({ page }) => {
    await openTestFile(page);

    // Click list dropdown
    await page.getByTestId('toolbar-list').click();

    // All list types should be visible
    await expect(page.getByTestId('toolbar-list-bullet-list')).toBeVisible();
    await expect(page.getByTestId('toolbar-list-order-list')).toBeVisible();
    await expect(page.getByTestId('toolbar-list-task-list')).toBeVisible();
  });

  test('bullet list button creates bullet list', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nBullet List Item');
    await page.waitForTimeout(100);

    // Create bullet list
    await page.getByTestId('toolbar-list').click();
    await page.getByTestId('toolbar-list-bullet-list').click();
    await page.waitForTimeout(300);

    // Verify bullet list was created (use .last() to get the newly created one)
    await expect(page.locator('.mu-editor .mu-bullet-list').last()).toBeVisible({ timeout: 5000 });
  });

  test('ordered list button creates ordered list', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nOrdered List Item');
    await page.waitForTimeout(100);

    // Create ordered list
    await page.getByTestId('toolbar-list').click();
    await page.getByTestId('toolbar-list-order-list').click();
    await page.waitForTimeout(300);

    // Verify ordered list was created
    await expect(page.locator('.mu-editor .mu-order-list')).toBeVisible({ timeout: 5000 });
  });

  test('task list button creates task list', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nTask List Item');
    await page.waitForTimeout(100);

    // Create task list
    await page.getByTestId('toolbar-list').click();
    await page.getByTestId('toolbar-list-task-list').click();
    await page.waitForTimeout(300);

    // Verify task list was created
    await expect(page.locator('.mu-editor .mu-task-list')).toBeVisible({ timeout: 5000 });
  });

  test('heading button converts paragraph to heading', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nToolbar Heading Test');
    await page.waitForTimeout(100);

    // Open heading dropdown and select H2
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-2').click();
    await page.waitForTimeout(300);

    // Verify heading was applied
    await expect(page.locator('.mu-editor h2').getByText('Toolbar Heading Test')).toBeVisible({ timeout: 5000 });
  });

  test('heading button can change heading level', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nHeading Level Change');
    await page.waitForTimeout(100);

    // First make it H1
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-1').click();
    await page.waitForTimeout(200);
    await expect(page.locator('.mu-editor h1').getByText('Heading Level Change')).toBeVisible({ timeout: 5000 });

    // Then change to H3
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-3').click();
    await page.waitForTimeout(200);

    // Should now be H3, not H1
    await expect(page.locator('.mu-editor h3').getByText('Heading Level Change')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.mu-editor h1').getByText('Heading Level Change')).not.toBeVisible();
  });

  test('heading dropdown shows check icon for current heading level', async ({ page }) => {
    await openTestFile(page);

    // Type some text and make it H2
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nCheck Icon Heading Test');
    await page.waitForTimeout(100);

    // Apply H2 via toolbar
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-2').click();
    await page.waitForTimeout(300);

    // Verify it's now H2
    await expect(page.locator('.mu-editor h2').getByText('Check Icon Heading Test')).toBeVisible({ timeout: 5000 });

    // Open heading dropdown again - H2 should have check icon visible
    await page.getByTestId('toolbar-heading').click();
    await page.waitForTimeout(100);

    // The check icon is inside a span with text-blue-500 class within the H2 button
    const h2Button = page.getByTestId('toolbar-heading-2');
    const checkIcon = h2Button.locator('.text-blue-500');
    await expect(checkIcon).toBeVisible({ timeout: 5000 });

    // Other heading levels should NOT have check icon
    const h1Button = page.getByTestId('toolbar-heading-1');
    const h1CheckIcon = h1Button.locator('.text-blue-500');
    await expect(h1CheckIcon).not.toBeVisible();
  });

  test('list dropdown shows check icon for current list type', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nCheck Icon List Test');
    await page.waitForTimeout(100);

    // Apply bullet list via toolbar
    await page.getByTestId('toolbar-list').click();
    await page.getByTestId('toolbar-list-bullet-list').click();
    await page.waitForTimeout(300);

    // Verify it's now a bullet list
    await expect(page.locator('.mu-editor .mu-bullet-list').last()).toBeVisible({ timeout: 5000 });

    // Open list dropdown again - bullet list should have check icon visible
    await page.getByTestId('toolbar-list').click();
    await page.waitForTimeout(100);

    // The check icon is inside a span with text-blue-500 class within the bullet list button
    const bulletButton = page.getByTestId('toolbar-list-bullet-list');
    const checkIcon = bulletButton.locator('.text-blue-500');
    await expect(checkIcon).toBeVisible({ timeout: 5000 });

    // Other list types should NOT have check icon
    const orderedButton = page.getByTestId('toolbar-list-order-list');
    const orderedCheckIcon = orderedButton.locator('.text-blue-500');
    await expect(orderedCheckIcon).not.toBeVisible();
  });

  test('paragraph shows check icon when cursor is on paragraph', async ({ page }) => {
    await openTestFile(page);

    // Click on an actual paragraph in the document (not the heading)
    // The test file has "This is a test document with some content." as a paragraph
    const paragraph = page.locator('.mu-editor .mu-paragraph').first();
    await paragraph.click();
    await page.waitForTimeout(200);

    // Open heading dropdown - Paragraph (level 0) should have check icon
    await page.getByTestId('toolbar-heading').click();
    await page.waitForTimeout(100);

    const paragraphButton = page.getByTestId('toolbar-heading-0');
    const checkIcon = paragraphButton.locator('.text-blue-500');
    await expect(checkIcon).toBeVisible({ timeout: 5000 });
  });

  test('clicking checked heading removes heading style', async ({ page }) => {
    await openTestFile(page);

    // Type some text and make it H2
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nToggle Off Heading Test');
    await page.waitForTimeout(100);

    // Apply H2
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-2').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.mu-editor h2').getByText('Toggle Off Heading Test')).toBeVisible({ timeout: 5000 });

    // Click H2 again (which has check icon) - should toggle OFF to paragraph
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-2').click();
    await page.waitForTimeout(300);

    // Should now be paragraph, not H2
    await expect(page.locator('.mu-editor h2').getByText('Toggle Off Heading Test')).not.toBeVisible();
    await expect(page.locator('.mu-editor .mu-paragraph').getByText('Toggle Off Heading Test')).toBeVisible({ timeout: 5000 });
  });

  test('clicking checked list removes list style', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nToggle Off List Test');
    await page.waitForTimeout(100);

    // Apply bullet list
    await page.getByTestId('toolbar-list').click();
    await page.getByTestId('toolbar-list-bullet-list').click();
    await page.waitForTimeout(300);

    // Verify bullet list was created with the text inside it
    const bulletListWithText = page.locator('.mu-editor .mu-bullet-list').filter({ hasText: 'Toggle Off List Test' });
    await expect(bulletListWithText).toBeVisible({ timeout: 5000 });

    // Click back into the list item to ensure focus
    await bulletListWithText.click();
    await page.waitForTimeout(100);

    // Click bullet list again (which has check icon) - should toggle OFF to paragraph
    await page.getByTestId('toolbar-list').click();
    await page.waitForTimeout(100);

    // Debug: Check if bullet list has check icon (indicating it's recognized as active)
    const bulletButton = page.getByTestId('toolbar-list-bullet-list');
    const checkIcon = bulletButton.locator('.text-blue-500');
    const hasCheck = await checkIcon.isVisible();
    console.log('Bullet list has check icon:', hasCheck);

    await page.getByTestId('toolbar-list-bullet-list').click();
    await page.waitForTimeout(300);

    // The text should NO LONGER be inside a bullet list
    await expect(bulletListWithText).not.toBeVisible({ timeout: 5000 });
    // And should now be in a paragraph
    await expect(page.locator('.mu-editor .mu-paragraph').getByText('Toggle Off List Test')).toBeVisible({ timeout: 5000 });
  });

  test('applying and toggling heading with selection', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nSelection Heading Test');
    await page.waitForTimeout(100);

    // Select the text
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.waitForTimeout(100);

    // Apply H2 via toolbar
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-2').click();
    await page.waitForTimeout(300);

    // Verify it's now H2
    await expect(page.locator('.mu-editor h2').getByText('Selection Heading Test')).toBeVisible({ timeout: 5000 });

    // Toggle back to paragraph by selecting same option (Paragraph)
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-0').click();
    await page.waitForTimeout(300);

    // Verify it's now a paragraph
    await expect(page.locator('.mu-editor h2').getByText('Selection Heading Test')).not.toBeVisible();
    await expect(page.locator('.mu-editor .mu-paragraph').getByText('Selection Heading Test')).toBeVisible({ timeout: 5000 });
  });

  test('applying and toggling unordered list', async ({ page }) => {
    await openTestFile(page);

    // Type some text
    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\nList Toggle Test Item');
    await page.waitForTimeout(100);

    // Apply bullet list via toolbar
    await page.getByTestId('toolbar-list').click();
    await page.getByTestId('toolbar-list-bullet-list').click();
    await page.waitForTimeout(300);

    // Verify it's now a bullet list
    const bulletList = page.locator('.mu-editor .mu-bullet-list').last();
    await expect(bulletList).toBeVisible({ timeout: 5000 });
    await expect(bulletList.getByText('List Toggle Test Item')).toBeVisible();

    // Toggle back to paragraph by applying paragraph heading
    // (Since there's no "remove list" option, we convert to paragraph)
    await page.getByTestId('toolbar-heading').click();
    await page.getByTestId('toolbar-heading-0').click();
    await page.waitForTimeout(300);

    // Verify it's now a regular paragraph (not in a list)
    await expect(page.locator('.mu-editor .mu-paragraph').getByText('List Toggle Test Item')).toBeVisible({ timeout: 5000 });
  });

  test('toolbar outdent works for indented list items (issue #26)', async ({ page }) => {
    await openTestFile(page);

    // The existing test file has a bullet list. Let's add a nested item to test outdent.
    // Click on "Bullet point two" which is in the existing list
    const bulletTwo = page.getByText('Bullet point two');
    await bulletTwo.click();
    await page.keyboard.press('End');
    await page.waitForTimeout(200);

    // Create a new list item and indent it with Tab (keyboard Tab works per user)
    await page.keyboard.press('Enter');
    await page.keyboard.type('Nested item');
    await page.waitForTimeout(200);

    // Indent with Tab key (user confirmed this works)
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    // Verify we have a nested list
    const bulletList = page.locator('.mu-editor .mu-bullet-list').first();
    const nestedList = bulletList.locator('.mu-bullet-list');
    await expect(nestedList).toBeVisible({ timeout: 5000 });
    await expect(nestedList.getByText('Nested item')).toBeVisible();

    // Test toolbar outdent button - THIS WAS THE BUG
    // Without fix: _unindentListItem() called without required type argument
    await page.getByTestId('toolbar-outdent').click();
    await page.waitForTimeout(300);

    // After toolbar outdent, nested list should be gone (item moved up a level)
    await expect(nestedList).not.toBeVisible({ timeout: 5000 });
    // The item should still exist but at the parent level
    await expect(bulletList.getByText('Nested item')).toBeVisible();
  });
});

test.describe('Makora Sorting', () => {
  test('newly created file appears first when sorted by date descending', async ({ page }) => {
    await setupAuthSession(page);

    // Switch to date (newest) sort order
    await page.getByTitle('Sort order').click();
    await page.getByText('Date (Newest)').click();
    await page.waitForTimeout(500);

    // Create a new file at root level via + button in header
    await page.getByTitle('New file').click();

    // Enter filename
    const timestamp = Date.now();
    const filename = `sort-test-${timestamp}`;
    await page.getByPlaceholder('filename.md').fill(filename);
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for file to be created
    await expect(page.getByText(`${filename}.md`).first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Get all file items - the newly created file should be first .md file
    const fileBrowser = page.locator('.h-full.flex.flex-col.bg-gray-50');
    const fileItems = fileBrowser.locator('[class*="py-1 px-2 cursor-pointer"]');
    const allItems = await fileItems.allTextContents();

    // Find the first .md file (directories sort before files)
    const firstFileIndex = allItems.findIndex(text => text.includes('.md'));
    expect(allItems[firstFileIndex]).toContain(filename);

    // Clean up - delete the test file
    const getContextMenuItem = (name: string) =>
      page.locator('.fixed.bg-white.rounded.shadow-lg button').getByText(name, { exact: true });
    await page.locator('.truncate').getByText(`${filename}.md`).click({ button: 'right' });
    await getContextMenuItem('Delete').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.truncate').getByText(`${filename}.md`)).not.toBeVisible({ timeout: 10000 });
  });

  test('saved file moves to first position when sorted by date descending', async ({ page }) => {
    await setupAuthSession(page);

    // Switch to date (newest) sort order
    await page.getByTitle('Sort order').click();
    await page.getByText('Date (Newest)').click();
    await page.waitForTimeout(500);

    // Open an existing file (hello.md is in the fixture)
    await page.getByText('hello.md').click();
    await expect(page.getByText('Hello World')).toBeVisible({ timeout: 10000 });

    // Make a change and save
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await editor.press('End');
    await page.keyboard.type(' - updated');

    // Save the file
    await page.keyboard.press('Meta+s');
    await page.waitForTimeout(1000);

    // hello.md should now be at the top of the root files (after directories)
    // since its lastmod was just updated
    const fileBrowser = page.locator('.h-full.flex.flex-col.bg-gray-50');
    const fileItems = fileBrowser.locator('[class*="py-1 px-2 cursor-pointer"]');
    const allItems = await fileItems.allTextContents();

    // Find first file (not directory) - should be hello.md
    const firstFileIndex = allItems.findIndex(text => text.includes('.md'));
    expect(allItems[firstFileIndex]).toContain('hello.md');
  });

  test('folder with updated file moves first when sorted by date descending', async ({ page }) => {
    await setupAuthSession(page);

    // Switch to date (newest) sort order
    await page.getByTitle('Sort order').click();
    await page.getByText('Date (Newest)').click();
    await page.waitForTimeout(500);

    // Get current folder order - we have AFolder and Subfolder
    // AFolder is alphabetically first, Subfolder is alphabetically second
    const fileBrowser = page.locator('.h-full.flex.flex-col.bg-gray-50');
    const fileItems = fileBrowser.locator('[class*="py-1 px-2 cursor-pointer"]');
    const initialItems = await fileItems.allTextContents();

    // Find the folder positions (directories come first)
    const aFolderIndex = initialItems.findIndex(text => text.includes('AFolder'));
    const subfolderIndex = initialItems.findIndex(text => text.includes('Subfolder'));

    // Verify both folders exist
    expect(aFolderIndex).toBeGreaterThanOrEqual(0);
    expect(subfolderIndex).toBeGreaterThanOrEqual(0);

    // Expand Subfolder and edit a file inside it
    await page.getByText('Subfolder').click();
    await page.waitForTimeout(500);

    // Click on a file inside Subfolder (nested.md is the fixture file in Subfolder)
    await page.locator('.truncate').getByText('nested.md').click();
    await page.waitForTimeout(1000);

    // Make a change and save
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await editor.press('End');
    await page.keyboard.type(' - folder test');

    // Save the file
    await page.keyboard.press('Meta+s');
    await page.waitForTimeout(1000);

    // Get updated folder order
    const updatedItems = await fileItems.allTextContents();
    const newSubfolderIndex = updatedItems.findIndex(text => text.includes('Subfolder'));
    const newAFolderIndex = updatedItems.findIndex(text => text.includes('AFolder'));

    // Subfolder should now be before AFolder (lower index = higher in list = more recent)
    expect(newSubfolderIndex).toBeLessThan(newAFolderIndex);
  });

  test('folder with newly created file moves first when sorted by date descending', async ({ page }) => {
    await setupAuthSession(page);

    // Switch to date (newest) sort order
    await page.getByTitle('Sort order').click();
    await page.getByText('Date (Newest)').click();
    await page.waitForTimeout(500);

    // Get current folder order - we have AFolder and Subfolder
    const fileBrowser = page.locator('.h-full.flex.flex-col.bg-gray-50');
    const fileItems = fileBrowser.locator('[class*="py-1 px-2 cursor-pointer"]');
    const initialItems = await fileItems.allTextContents();

    // Find the folder positions
    const aFolderIndex = initialItems.findIndex(text => text.includes('AFolder'));
    const subfolderIndex = initialItems.findIndex(text => text.includes('Subfolder'));

    // Verify both folders exist
    expect(aFolderIndex).toBeGreaterThanOrEqual(0);
    expect(subfolderIndex).toBeGreaterThanOrEqual(0);

    // Right-click on Subfolder to create a new file inside it
    await page.getByText('Subfolder').click({ button: 'right' });
    await page.waitForTimeout(200);

    // Click "New file" in context menu
    const getContextMenuItem = (name: string) =>
      page.locator('.fixed.bg-white.rounded.shadow-lg button').getByText(name, { exact: true });
    await getContextMenuItem('New file').click();

    // Enter filename and create
    const timestamp = Date.now();
    const filename = `folder-create-test-${timestamp}`;
    await page.getByPlaceholder('filename.md').fill(filename);
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for file to be created
    await expect(page.getByText(`${filename}.md`).first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Get updated folder order
    const updatedItems = await fileItems.allTextContents();
    const newSubfolderIndex = updatedItems.findIndex(text => text.includes('Subfolder'));
    const newAFolderIndex = updatedItems.findIndex(text => text.includes('AFolder'));

    // Subfolder should now be before AFolder (lower index = higher in list = more recent)
    expect(newSubfolderIndex).toBeLessThan(newAFolderIndex);

    // Cleanup - delete the test file
    await page.locator('.truncate').getByText(`${filename}.md`).click({ button: 'right' });
    await getContextMenuItem('Delete').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.truncate').getByText(`${filename}.md`)).not.toBeVisible({ timeout: 10000 });
  });
});

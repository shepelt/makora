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
});

test.describe('Makora Performance', () => {
  test('typing in large file should have low latency', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open the large test file
    await page.getByText('large-test.md').click();
    await expect(page.getByText('Large Test Document')).toBeVisible({ timeout: 10000 });

    // Wait for editor to fully initialize
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');
    await editor.click();
    await page.keyboard.press('End');

    // Measure time to type 20 characters
    const charCount = 20;
    const testString = 'PERF_TEST_STRING_123';

    const startTime = Date.now();
    await page.keyboard.type(testString, { delay: 0 }); // Type as fast as possible
    const endTime = Date.now();

    // Verify text was typed
    await expect(page.getByText(testString)).toBeVisible();

    const totalTime = endTime - startTime;
    const avgTimePerChar = totalTime / charCount;

    console.log(`Typing ${charCount} chars took ${totalTime}ms (avg ${avgTimePerChar.toFixed(1)}ms/char)`);

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

test.describe('Makora Images', () => {
  const imageTestFilePath = resolve('./tests/fixtures/webdav/image-test.md');
  let originalImageContent: string;

  test.beforeAll(() => {
    originalImageContent = readFileSync(imageTestFilePath, 'utf-8');
  });

  test.afterEach(() => {
    writeFileSync(imageTestFilePath, originalImageContent);
  });

  // Helper to set up authenticated session for image proxy
  // This mimics how Meteor actually stores auth tokens (localStorage, not cookies)
  async function setupAuthSession(page: any) {
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

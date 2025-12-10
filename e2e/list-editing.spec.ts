import { test, expect, Page } from '@playwright/test';

// Helper to wait for app to be fully loaded
async function waitForAppReady(page: Page) {
  await expect(page.getByText('test.md', { exact: true }).first()).toBeVisible({ timeout: 20000 });
}

test.describe('List Item Editing (Issue #34)', () => {
  test('simple list: Tab indents second item, Shift+Tab unindents (using test2.md)', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test2.md which has structure:
    // * first item
    // * test text wewqasdasd   <- THIS can be indented (has prev sibling)
    //   *
    await page.getByText('test2.md').click();
    await expect(page.getByText('Work Log')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');
    await page.screenshot({ path: 'test-results/step0-initial.png' });

    // Count nested items before any action
    const nestedBefore = await editor.locator('ul ul li').count();
    console.log('Initial nested items (ul ul li):', nestedBefore);

    // 1. Click on "test text wewqasdasd" - this is a top-level list item that CAN be indented
    // because it has a previous sibling ("first item")
    await page.getByText('test text wewqasdasd').click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'test-results/step1-clicked.png' });

    // 2. Press Tab - should indent under "first item"
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'test-results/step2-after-tab.png' });

    // Check nesting count - should now have more nested items
    const nestedAfterTab = await editor.locator('ul ul li').count();
    console.log('After Tab - nested (ul ul li):', nestedAfterTab);

    // Verify item is now nested (more nested items than before)
    expect(nestedAfterTab).toBeGreaterThan(nestedBefore);

    // 3. Type to verify focus maintained after Tab
    await page.keyboard.type(' ADDED');
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'test-results/step3-after-typing.png' });

    // Verify typed text appears
    await expect(editor.getByText('ADDED', { exact: false })).toBeVisible();

    // 4. Press Shift+Tab - should unindent back to top level
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'test-results/step4-after-shift-tab.png' });

    // Check nesting count after unindent - should be back to original
    const nestedAfterShiftTab = await editor.locator('ul ul li').count();
    console.log('After Shift+Tab - nested (ul ul li):', nestedAfterShiftTab);

    // Should have fewer nested items after Shift+Tab
    expect(nestedAfterShiftTab).toBeLessThan(nestedAfterTab);

    // 5. Type more to verify focus maintained after Shift+Tab
    await page.keyboard.type(' UNINDENTED');
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'test-results/step5-after-typing.png' });

    // Text should be visible
    await expect(editor.getByText('UNINDENTED', { exact: false })).toBeVisible();
  });

  test('backspace works after clicking empty indented list item', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test2.md (has empty indented item)
    await page.getByText('test2.md').click();
    await expect(page.getByText('Work Log')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Click on the nested (empty) list item
    const editor = page.locator('.mu-editor');
    const nestedListItem = editor.locator('ul ul li');
    await nestedListItem.first().click();
    await page.waitForTimeout(200);

    // Type text in the empty indented item
    const testText = 'new text here';
    await page.keyboard.type(testText);
    await page.waitForTimeout(100);

    // Verify text was typed
    await expect(page.getByText(testText)).toBeVisible();

    // Try to backspace to delete the text
    for (let i = 0; i < testText.length; i++) {
      await page.keyboard.press('Backspace');
    }
    await page.waitForTimeout(100);

    // Text should be deleted
    await expect(page.getByText(testText)).not.toBeVisible();
  });

  test('Tab actually indents list item and maintains focus', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test2.md
    await page.getByText('test2.md').click();
    await expect(page.getByText('Work Log')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');

    // Count nested items before Tab
    const nestedCountBefore = await editor.locator('ul ul li').count();
    console.log('Nested count before Tab:', nestedCountBefore);

    // Click on the SECOND list item (can be indented because it has a prev sibling)
    // The text "test text wewqasdasd" is in the second list item
    await page.getByText('test text wewqasdasd').click();
    await page.waitForTimeout(100);

    // Press Tab to indent
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // After Tab, the item should be nested deeper (ul ul li = depth 2)
    const nestedCountAfter = await editor.locator('ul ul li').count();
    console.log('Nested count after Tab:', nestedCountAfter);

    // Should have more nested items after Tab (the item + its child moved under first item)
    expect(nestedCountAfter).toBeGreaterThan(nestedCountBefore);

    // Check what the current content looks like
    const editorHtml = await editor.innerHTML();
    console.log('Editor contains ul ul li:', editorHtml.includes('ul'));

    // Take screenshot after Tab
    await page.screenshot({ path: 'test-results/after-tab.png' });

    // CRITICAL: After Tab, typing should still work (focus maintained)
    await page.keyboard.type(' AFTER TAB');
    await page.waitForTimeout(100);

    // Take screenshot after typing
    await page.screenshot({ path: 'test-results/after-typing.png' });

    // Check if text appears anywhere in the page
    const pageContent = await page.content();
    console.log('Page contains AFTER TAB:', pageContent.includes('AFTER TAB'));

    // The typed text should appear somewhere (proves focus was maintained)
    // Note: cursor position after Tab may vary, so just check AFTER TAB appears
    await expect(page.getByText('AFTER TAB', { exact: false })).toBeVisible();
  });

  test('Shift+Tab actually de-indents list item', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test2.md
    await page.getByText('test2.md').click();
    await expect(page.getByText('Work Log')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');

    // First, use Tab to indent the second item (creates a nested structure)
    await page.getByText('test text wewqasdasd').click();
    await page.waitForTimeout(100);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // Count nested items after Tab indent
    const nestedItemsAfterIndent = await editor.locator('ul ul li').count();

    // Now use Shift+Tab to de-indent
    // The text should still be selected/focused after Tab
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(200);

    // Count nested items after Shift+Tab
    const nestedItemsAfterUnindent = await editor.locator('ul ul li').count();

    // Should have fewer nested items after Shift+Tab
    expect(nestedItemsAfterUnindent).toBeLessThan(nestedItemsAfterIndent);
  });

  test('toolbar indent button actually indents list item', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test2.md
    await page.getByText('test2.md').click();
    await expect(page.getByText('Work Log')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');

    // Count nested items before
    const nestedCountBefore = await editor.locator('ul ul li').count();

    // Click on the second list item (can be indented)
    await page.getByText('test text wewqasdasd').click();
    await page.waitForTimeout(100);

    // Click the indent toolbar button
    const indentButton = page.locator('[data-testid="toolbar-indent"]');
    await indentButton.click();
    await page.waitForTimeout(200);

    // Count nested items after
    const nestedCountAfter = await editor.locator('ul ul li').count();

    // Should have more nested items after indent
    expect(nestedCountAfter).toBeGreaterThan(nestedCountBefore);

    // Verify the specific text is now in a nested list
    const nestedText = editor.locator('ul ul li').getByText('test text wewqasdasd');
    await expect(nestedText).toBeVisible();
  });

  test('toolbar unindent button actually de-indents list item', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test2.md
    await page.getByText('test2.md').click();
    await expect(page.getByText('Work Log')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    const editor = page.locator('.mu-editor');

    // First indent the item
    await page.getByText('test text wewqasdasd').click();
    await page.waitForTimeout(100);
    const indentButton = page.locator('[data-testid="toolbar-indent"]');
    await indentButton.click();
    await page.waitForTimeout(200);

    // Count nested items after indent
    const nestedCountAfterIndent = await editor.locator('ul ul li').count();

    // Click the unindent toolbar button
    const unindentButton = page.locator('[data-testid="toolbar-outdent"]');
    await unindentButton.click();
    await page.waitForTimeout(200);

    // Count nested items after unindent
    const nestedCountAfterUnindent = await editor.locator('ul ul li').count();

    // Should have fewer nested items after unindent
    expect(nestedCountAfterUnindent).toBeLessThan(nestedCountAfterIndent);
  });

  test('clicking at beginning of line allows editing', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Open test2.md (has same structure)
    await page.getByText('test2.md').click();
    await expect(page.getByText('test text wewqasdasd')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Click at the beginning of the text "test text wewqasdasd"
    const textElement = page.getByText('test text wewqasdasd');
    const box = await textElement.boundingBox();
    // Click at the very left edge of the text
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    await page.waitForTimeout(200);

    // Type at the beginning
    await page.keyboard.type('START ');
    await page.waitForTimeout(100);

    // The text should now have START at the beginning
    await expect(page.getByText('START test text wewqasdasd')).toBeVisible();
  });
});

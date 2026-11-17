// Typing latency on a large file. Run: npx playwright test -c tests/perf/playwright.perf.ts
import { expect, test } from '@playwright/test';

test('typing latency in large-perf-test.md', async ({ page }) => {
  await page.goto('/?key=e2e-key');
  await page.getByLabel('Server URL').fill('http://localhost:4081/remote.php/dav/files/test');
  await page.getByLabel('Username').fill('test');
  await page.getByLabel('Password').fill('test');
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE || 4) });
  const t0 = Date.now();
  await page.getByRole('navigation', { name: 'Files' }).getByTitle(process.env.PERF_FILE || 'large-perf-test.md', { exact: true }).click();
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'clean', { timeout: 60_000 });
  await page.locator('.makora-editor .mu-content').last().waitFor();
  console.log(`open: ${Date.now() - t0}ms (CPU x${process.env.THROTTLE || 4})`);
  const size = await page.evaluate(() => document.querySelectorAll('.makora-editor .mu-content').length);
  console.log(`blocks: ${size}`);
  await page.locator('.makora-editor .mu-content').nth(Math.floor(size / 2)).click();
  await page.keyboard.press('End');
  // Measure keystroke -> next paint, including the frame where Muya flushes ops.
  const samples: number[] = await page.evaluate(async () => {
    const out: number[] = [];
    const el = document.activeElement as HTMLElement;
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      document.execCommand('insertText', false, 'x');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push(performance.now() - t);
    }
    void el;
    return out;
  });
  samples.sort((a, b) => a - b);
  const p = (q: number) => samples[Math.floor(q * (samples.length - 1))].toFixed(1);
  console.log(`keystroke->paint ms: p50=${p(0.5)} p90=${p(0.9)} max=${p(1)}`);
});

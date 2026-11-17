// CPU profile of typing in a large file. PERF_FILE, THROTTLE env vars.
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('typing profile', async ({ page }) => {
  await page.goto('/?key=e2e-key');
  await page.getByLabel('Server URL').fill('http://localhost:4081/remote.php/dav/files/test');
  await page.getByLabel('Username').fill('test');
  await page.getByLabel('Password').fill('test');
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  await page.getByRole('navigation', { name: 'Files' }).getByTitle(process.env.PERF_FILE || 'worklog-100k.md', { exact: true }).click();
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'clean', { timeout: 60_000 });
  const n = await page.locator('.makora-editor .mu-content').count();
  await page.locator('.makora-editor .mu-content').nth(Math.floor(n / 2)).click();
  await page.keyboard.press('End');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      document.execCommand('insertText', false, 'x');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });
  const { profile } = await cdp.send('Profiler.stop');
  writeFileSync('/tmp/makora-typing.cpuprofile', JSON.stringify(profile));
  const byId = new Map(profile.nodes.map((x: any) => [x.id, x]));
  const parent = new Map<number, number>();
  for (const x of profile.nodes) for (const c of x.children || []) parent.set(c, x.id);
  const self = new Map<number, number>();
  (profile.samples ?? []).forEach((id, i) => self.set(id, (self.get(id) || 0) + ((profile.timeDeltas ?? [])[i] || 0)));
  const agg = new Map<string, number>();
  for (const [id, t] of self) {
    const chain: string[] = [];
    let cur: number | undefined = id;
    for (let k = 0; k < 4 && cur; k++) {
      const cf: any = (byId.get(cur) as any).callFrame;
      chain.push(`${cf.functionName || 'anon'}:${cf.lineNumber + 1}:${cf.columnNumber}`);
      cur = parent.get(cur);
    }
    const key = chain.join(' <- ');
    agg.set(key, (agg.get(key) || 0) + t);
  }
  for (const [k, t] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(String((t / 1000) | 0).padStart(5), 'ms', k);
});

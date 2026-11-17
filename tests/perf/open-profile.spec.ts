// CPU profile of opening a file. PERF_FILE, THROTTLE env vars.
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('open profile', async ({ page }) => {
  await page.goto('/?key=e2e-key');
  await page.getByLabel('Server URL').fill('http://localhost:4081/remote.php/dav/files/test');
  await page.getByLabel('Username').fill('test');
  await page.getByLabel('Password').fill('test');
  await page.getByRole('button', { name: 'Save & Continue' }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE || 4) });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  await page.getByRole('navigation', { name: 'Files' }).getByTitle(process.env.PERF_FILE || 'worklog-100k.md', { exact: true }).click();
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'clean', { timeout: 60_000 });
  await page.waitForFunction(() => performance.getEntriesByName('muya:painted').length > 0);
  await page.waitForTimeout(300);
  const wall = Date.now() - t0;
  const { profile } = await cdp.send('Profiler.stop');
  const marks = await page.evaluate(() => performance.getEntriesByType('mark').map((m) => [m.name, Math.round(m.startTime)]));
  console.log('wall', wall, 'ms; marks', JSON.stringify(marks));
  writeFileSync('/tmp/makora-open.cpuprofile', JSON.stringify(profile));
  // Aggregate self time.
  const byId = new Map(profile.nodes.map((n: any) => [n.id, n]));
  const self = new Map<number, number>();
  const dts = profile.timeDeltas ?? [];
  (profile.samples ?? []).forEach((id: number, i: number) => self.set(id, (self.get(id) || 0) + (dts[i] || 0)));
  const agg = new Map<string, number>();
  for (const [id, t] of self) {
    const n: any = byId.get(id);
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
    agg.set(key, (agg.get(key) || 0) + t);
  }
  const top = [...agg].sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [k, t] of top) console.log((t / 1000).toFixed(0).padStart(6), 'ms', k);
});

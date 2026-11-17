import base from '../../playwright.config';
import { defineConfig, devices } from '@playwright/test';
// Run from the repo root: npx playwright test -c tests/perf/playwright.perf.ts
export default defineConfig({
  ...base,
  testDir: '.',
  timeout: 120_000,
  webServer: { ...(base.webServer as object), cwd: '../..' } as any,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

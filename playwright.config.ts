import { defineConfig, devices } from '@playwright/test';

// Browser tests run against their own server on port 3200 with a disposable data folder (tmp/e2e-data).
const port = 3200;
export const E2E = { origin: `http://127.0.0.1:${port}`, dataDir: './tmp/e2e-data' };
process.env.DATA_DIR = E2E.dataDir;
// E2E_SERVER=prod tests the production build (run `npm run build` first); the default is the dev server.
const serve = process.env.E2E_SERVER === 'prod' ? `npx next start --hostname 127.0.0.1 --port ${port}` : `npx next dev --hostname 127.0.0.1 --port ${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: E2E.origin, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node --require ./scripts/register-ts.cjs scripts/data.ts reset --yes && ${serve}`,
    url: `${E2E.origin}/login`, env: { DATA_DIR: E2E.dataDir }, reuseExistingServer: false, timeout: 180_000, stdout: 'ignore', stderr: 'pipe',
  },
});

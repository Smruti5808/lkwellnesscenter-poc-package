import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const persistence = `./tmp/cloudflare-e2e-${Date.now()}`;
export default defineConfig({
  testDir: './tests/cloudflare', outputDir: './tmp/cloudflare-browser-results', workers: 1, timeout: 90_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3300', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Reset and bootstrap operations target disposable data and isolated SQLite storage.
    command: `node --require ./scripts/register-ts.cjs scripts/data.ts reset --yes && node --require ./scripts/register-ts.cjs scripts/cloudflare-data.ts prepare && node node_modules/wrangler/bin/wrangler.js dev --port 3300 --persist-to ${persistence}`,
    url: 'http://127.0.0.1:3300/login', timeout: 180_000, reuseExistingServer: false,
    env: { DATA_DIR: './tmp/cloudflare-e2e-data', CLOUDFLARE_PERSIST_DIR: persistence, WRANGLER_LOG_PATH: path.resolve('tmp/wrangler-logs'), WRANGLER_REGISTRY_PATH: path.resolve('tmp/wrangler-registry'), WRANGLER_SEND_METRICS: 'false' },
    stdout: 'ignore', stderr: 'pipe',
  },
});

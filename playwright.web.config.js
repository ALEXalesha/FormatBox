import { defineConfig } from '@playwright/test';

const PORT = 8187;
export default defineConfig({
  testDir: 'tests/web',
  timeout: 120000,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    headless: true,
    launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] },
  },
  webServer: { command: `node tools/serve.js ${PORT}`, url: `http://127.0.0.1:${PORT}/`, reuseExistingServer: true, timeout: 30000 },
});

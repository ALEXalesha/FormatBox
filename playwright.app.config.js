import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/app',
  timeout: 180000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});

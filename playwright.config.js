import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.js',
  timeout: 120_000,
  workers: 1,
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:4178',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: 'node tests/browser/server.js',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
});

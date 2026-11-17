import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Chromium runs these files with the full suite; only the bounded compatibility
// contract runs in the two additional engines. Keep their artifacts separate.
export default defineConfig({
  ...base,
  testMatch: ['**/execution-lifecycle.spec.js', '**/nested-headers.spec.js'],
  outputDir: 'test-results/compatibility',
  use: { baseURL: base.use.baseURL },
  projects: [
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});

import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const reportRoot = path.resolve(__dirname, '..', '..', 'build', 'reports', 'playwright', 'personal-server');

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  outputDir: path.join(reportRoot, 'results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(reportRoot, 'report'), open: 'never' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'personal-server-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 920 },
      },
    },
    {
      name: 'personal-server-narrow',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 480, height: 900 },
      },
    },
  ],
});

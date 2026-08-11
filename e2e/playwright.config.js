const { defineConfig, devices } = require('@playwright/test');
const { resolveBaseUrl } = require('./lib/lanHost');

/**
 * The suite drives the containerised production stack over a LAN address.
 * See lib/lanHost.js for why loopback is deliberately avoided.
 */
module.exports = defineConfig({
  testDir: './tests',
  outputDir: './test-results',

  // Specs share one stack and one database, so they are ordered rather than
  // parallel. Isolation comes from each spec registering its own account.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: './playwright-report' }],
  ],

  use: {
    baseURL: resolveBaseUrl(),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

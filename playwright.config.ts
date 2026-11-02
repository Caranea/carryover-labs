import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against the production build, served by the API exactly as deployed.
 * Build first: npm run build && npm --prefix api run build. The batch API is stubbed in each
 * test, so no model key is needed and nothing is sent anywhere.
 */
const port = 4300;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use an installed Chrome when the bundled browser isn't downloaded.
        launchOptions: process.env['CHROME_PATH']
          ? { executablePath: process.env['CHROME_PATH'] }
          : {},
      },
    },
  ],
  webServer: {
    command: 'node api/dist/main.js',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    env: { PORT: String(port), HOST: '127.0.0.1', META_MODEL_API_KEY: '' },
  },
});

const { defineConfig } = require('@playwright/test');
const { PORT, BASE_URL } = require('./tests/responsive/helpers');

/**
 * Testy responsywności (npm run test:responsive) - osobne od zestawu Jest (npm test).
 * Uruchamiają prawdziwą przeglądarkę (Chromium) na kilku szerokościach ekranu i sprawdzają
 * układ stron. Serwer startuje z izolowaną bazą/katalogiem (tests/responsive/seed-and-start.js) -
 * nigdy nie dotyka data/dev.sqlite3 ani public/images/...
 */
module.exports = defineConfig({
  testDir: './tests/responsive',
  testMatch: '**/*.spec.js',
  globalSetup: require.resolve('./tests/responsive/global-setup.js'),
  timeout: 30 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/responsive/seed-and-start.js',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60 * 1000,
    env: { PORT: String(PORT) },
  },
});

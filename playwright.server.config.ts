import { defineConfig } from '@playwright/test';

/**
 * The e2e suite in server mode (part 1, session 11): `pnpm e2e:server` runs
 * e2e/server/*.spec.ts against a deployed Web Studio, over HTTPS, with a real
 * Business OS access token from auth-service (the token flow; the dev login is
 * off on a server). It starts nothing and touches no database directly.
 *
 *   E2E_BOS_EMAIL=... E2E_BOS_PASSWORD=... pnpm e2e:server
 *
 * Optional: E2E_SERVER_URL (default https://web-studio.torchcorp.com),
 * E2E_AUTH_URL (default https://auth.torchcorp.com), E2E_SITES_DOMAIN
 * (default sites.torchcorp.com). The account's organization is the test
 * organization: the run creates its sites there, publishes them, and deletes them.
 *
 * Part 2 (session D1) adds the store specs (store-settings, catalogue, checkout,
 * orders-api, storefront-browser): real Organization Setup, Product & Services, Contact Center and
 * Sales, one fixed test item on the ECOMMERCE channel (switched off again by the
 * global teardown), one fixed test buyer phone, and every Sales order the run
 * makes cancelled by the run (e2e/server/real-services.ts).
 */
if (!process.env.E2E_BOS_EMAIL || !process.env.E2E_BOS_PASSWORD) {
  throw new Error('E2E_BOS_EMAIL and E2E_BOS_PASSWORD are not set. The server e2e signs in to Business OS with a test account.');
}

export default defineConfig({
  testDir: './e2e/server',
  globalSetup: './e2e/server/global-setup.ts',
  globalTeardown: './e2e/server/global-teardown.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_SERVER_URL || 'https://web-studio.torchcorp.com',
  },
});

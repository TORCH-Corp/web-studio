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
 * organization: the run creates one site there, publishes it, and deletes it.
 */
if (!process.env.E2E_BOS_EMAIL || !process.env.E2E_BOS_PASSWORD) {
  throw new Error('E2E_BOS_EMAIL and E2E_BOS_PASSWORD are not set. The server e2e signs in to Business OS with a test account.');
}

export default defineConfig({
  testDir: './e2e/server',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_SERVER_URL || 'https://web-studio.torchcorp.com',
  },
});

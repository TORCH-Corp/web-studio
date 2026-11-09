import os from 'os';
import path from 'path';
import { defineConfig } from '@playwright/test';
import { TEMPLATES_ORG } from './e2e/helpers';
import { ensureTestKeys } from './e2e/test-keys';
import { DOMAIN_SERVICE_KEY } from './e2e/domain-fixtures';
import { CONTACT_CENTER_KEY, ORG_SETUP_KEY, PRODUCT_SERVICES_KEY, SALES_APP_ID, SALES_KEY, WS_APP_ID } from './e2e/platform-fixtures';

/**
 * End-to-end suite for the TORCH fork (part 1, session 1).
 *
 * `pnpm e2e` recreates the test database from empty (every migration), builds
 * the app and starts it on a test port with the dev login enabled, then runs
 * the specs in e2e/ against it over HTTP. The specs talk to the API the way
 * the shell and the builder do, and to published sites by host name.
 *
 * Needs DATABASE_URL_TEST: a PostgreSQL 16 database of its own whose name
 * contains "test"; its public schema is dropped and recreated on every run.
 * `pnpm templates:seed` then creates TORCH's templates (session 4; part 2 adds the online store).
 *
 * Session 2: a stand-in for auth-service (e2e/auth-stub.ts) runs beside the
 * app, and the app verifies access tokens with a test key pair
 * (e2e/test-keys.ts) that the specs sign with.
 *
 * Part 2, session W1: one stand-in for the platform services the store calls
 * with a service key (e2e/platform-stub.ts: Organization Setup and Product &
 * Services; W2 and W3 add theirs), on the app's port + 3. Session W3: the same
 * server stands in for Contact Center and Sales (e2e/order-services-stub.ts).
 * Session W8: the same stubs answer the Orders API (Sales' list and status
 * route, Contact Center's lookup-ids), and SALES_APP_ID and WS_APP_ID name the
 * apps its deep links open.
 */
const PORT = Number(process.env.E2E_PORT || 3102);
const AUTH_PORT = Number(process.env.E2E_AUTH_PORT || PORT + 1);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DC_PORT = Number(process.env.E2E_DC_PORT || PORT + 2); // the auth stub holds PORT + 1
const DC_KEY = 'e2e-document-center-key';
const PLATFORM_PORT = Number(process.env.E2E_PLATFORM_PORT || PORT + 3); // + 1 auth stub, + 2 Document Center
const PLATFORM_URL = `http://127.0.0.1:${PLATFORM_PORT}`;
const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST;
const { publicKeyPem } = ensureTestKeys();

if (!DATABASE_URL_TEST) {
  throw new Error('DATABASE_URL_TEST is not set. The e2e suite needs its own PostgreSQL database; it recreates it on every run.');
}

export default defineConfig({
  testDir: './e2e',
  // e2e/server runs against a deployed server (`pnpm e2e:server`, playwright.server.config.ts), never here.
  testIgnore: ['**/server/**'],
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
  },
  webServer: [
    {
      // A recorded copy of Document Center's file contract (session 8).
      command: 'TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register e2e/fake-document-center.ts',
      url: `http://127.0.0.1:${DC_PORT}/__health`,
      reuseExistingServer: !process.env.CI,
      env: { FAKE_DC_PORT: String(DC_PORT), FAKE_DC_KEY: DC_KEY },
    },
    {
      // Organization Setup and Product & Services (part 2, W1, W2), Contact Center and Sales (W3).
      command: 'TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.test.json node --require ts-node/register e2e/platform-stub.ts',
      url: `${PLATFORM_URL}/__health`,
      reuseExistingServer: !process.env.CI,
      env: { E2E_PLATFORM_PORT: String(PLATFORM_PORT) },
    },
    {
      command: 'pnpm e2e:auth-stub',
      url: `http://127.0.0.1:${AUTH_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { E2E_AUTH_PORT: String(AUTH_PORT) },
    },
    {
      command: `pnpm e2e:db && pnpm templates:seed && pnpm exec next build && pnpm exec next start -p ${PORT}`,
      url: `${BASE_URL}/ycode/api/setup/status`,
      reuseExistingServer: !process.env.CI,
      timeout: 15 * 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL_TEST,
        DATABASE_URL: DATABASE_URL_TEST,
        BOS_SESSION_SECRET: 'e2e-session-secret',
        BOS_JWT_PUBLIC_KEY: publicKeyPem,
        BOS_AUTH_URL: `http://127.0.0.1:${AUTH_PORT}`,
        DOMAIN_SERVICE_URL: `http://127.0.0.1:${AUTH_PORT}`, // the stub answers domain-service's list too
        DOMAIN_SERVICE_API_KEY: DOMAIN_SERVICE_KEY,
        PAGE_AUTH_SECRET: 'e2e-page-auth-secret',
        ALLOW_DEV_LOGIN: 'true',
        WS_SITES_DOMAIN: 'sites.test',
        WS_TEMPLATES_ORG: TEMPLATES_ORG,
        PLATFORM_PUBLIC_URL: BASE_URL,
        PLATFORM_STORAGE_DIR: path.join(os.tmpdir(), `web-studio-e2e-storage-${PORT}`),
        PLATFORM_STORAGE: 'document-center',
        DOCUMENT_CENTER_URL: `http://127.0.0.1:${DC_PORT}`,
        DOCUMENT_CENTER_API_KEY: DC_KEY,
        ORG_SETUP_URL: PLATFORM_URL,
        ORG_SETUP_API_KEY: ORG_SETUP_KEY,
        PRODUCT_SERVICES_URL: PLATFORM_URL,
        PRODUCT_SERVICES_API_KEY: PRODUCT_SERVICES_KEY,
        CONTACT_CENTER_URL: PLATFORM_URL,
        CONTACT_CENTER_API_KEY: CONTACT_CENTER_KEY,
        SALES_URL: PLATFORM_URL,
        SALES_API_KEY: SALES_KEY,
        SALES_APP_ID, // the Orders API's deep links (session W8)
        WS_APP_ID,
      },
    },
  ],
});

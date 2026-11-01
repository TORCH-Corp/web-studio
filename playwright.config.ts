import os from 'os';
import path from 'path';
import { defineConfig } from '@playwright/test';
import { TEMPLATES_ORG } from './e2e/helpers';
import { ensureTestKeys } from './e2e/test-keys';

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
 * `pnpm templates:seed` then creates TORCH's three templates (session 4).
 *
 * Session 2: a stand-in for auth-service (e2e/auth-stub.ts) runs beside the
 * app, and the app verifies access tokens with a test key pair
 * (e2e/test-keys.ts) that the specs sign with.
 */
const PORT = Number(process.env.E2E_PORT || 3102);
const AUTH_PORT = Number(process.env.E2E_AUTH_PORT || PORT + 1);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST;
const { publicKeyPem } = ensureTestKeys();

if (!DATABASE_URL_TEST) {
  throw new Error('DATABASE_URL_TEST is not set. The e2e suite needs its own PostgreSQL database; it recreates it on every run.');
}

export default defineConfig({
  testDir: './e2e',
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
        PAGE_AUTH_SECRET: 'e2e-page-auth-secret',
        ALLOW_DEV_LOGIN: 'true',
        WS_SITES_DOMAIN: 'sites.test',
        WS_TEMPLATES_ORG: TEMPLATES_ORG,
        PLATFORM_PUBLIC_URL: BASE_URL,
        PLATFORM_STORAGE_DIR: path.join(os.tmpdir(), `web-studio-e2e-storage-${PORT}`),
      },
    },
  ],
});

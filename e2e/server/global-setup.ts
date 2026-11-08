/**
 * The start of a server-mode run: one login to auth-service for the whole run.
 * The token is kept in this process's environment (E2E_ACCESS_TOKEN), which the
 * workers inherit, and never written to a file. It lives 15 minutes; a full run
 * takes about two.
 */

import { accessToken } from './real-services';

export default async function globalSetup(): Promise<void> {
  process.env.E2E_ACCESS_TOKEN = await accessToken();
}

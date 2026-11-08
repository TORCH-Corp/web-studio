/**
 * The end of a server-mode run: the test item the store specs used goes back off
 * the ECOMMERCE channel and inactive (e2e/server/real-services.ts), so a run
 * leaves no product on sale in the test organization. Runs even when specs failed.
 */

import { accessToken, retireStoreItem } from './real-services';

export default async function globalTeardown(): Promise<void> {
  await retireStoreItem(await accessToken());
}

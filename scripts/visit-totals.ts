/**
 * The daily run of the visit totals, by hand (part 3, session W8):
 *
 *   DATABASE_URL=... pnpm visits:totals
 *
 * Totals every finished day that is not yet in the totals and deletes detailed
 * visit rows older than 90 days whose day is (lib/platform/visit-totals-run.ts).
 * It is what the service's own timer runs at 01:00 Baghdad time, so an operator
 * can run it again, or catch up, at any time; running it twice changes nothing.
 * The last line of the output is the result as JSON: `{ skipped, siteDays, deleted }`.
 */

import { closeKnexClient } from '@/lib/knex-client';
import { runVisitTotalsOnce } from '@/lib/platform/visit-totals-run';

async function main(): Promise<void> {
  try {
    console.log(JSON.stringify(await runVisitTotalsOnce()));
  } finally {
    await closeKnexClient();
  }
}

main().catch((error) => {
  console.error('[visit totals]', error);
  process.exit(1);
});

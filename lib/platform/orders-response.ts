import { noCache } from '@/lib/api-response';
import { orderErrorAnswer } from '@/lib/platform/orders-errors';

/** The answer of an Orders route for an error: Sales's refusal or outage as lib/platform/orders-errors.ts maps it, else a logged 500. */
export function ordersFailure(route: string, error: unknown, whatFailed: string) {
  const answer = orderErrorAnswer(error);
  if (answer) {
    if (answer.status === 503) console.error(`[${route}]`, error instanceof Error ? error.message : error);
    return noCache(answer.body, answer.status);
  }
  console.error(`[${route}]`, error);
  return noCache({ error: whatFailed }, 500);
}

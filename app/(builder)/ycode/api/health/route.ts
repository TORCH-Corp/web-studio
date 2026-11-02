import { noCache } from '@/lib/api-response';
import { getKnexClient } from '@/lib/knex-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Health (deployment, part 1 session 11): 200 when the database answers and
 * the migrations have run, 503 otherwise. The compose healthcheck and nginx's
 * monitors read this; it names no site and needs no session.
 */
export async function GET() {
  try {
    const knex = await getKnexClient();
    const migrated = await knex.schema.hasTable('platform_sites');
    if (!migrated) return noCache({ status: 'starting', reason: 'migrations have not run' }, 503);
    return noCache({ status: 'ok' });
  } catch (error) {
    return noCache({ status: 'down', reason: error instanceof Error ? error.message : 'Database unreachable' }, 503);
  }
}

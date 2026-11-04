import { noCache } from '@/lib/api-response';
import { credentials } from '@/lib/credentials';
import { getKnexClient } from '@/lib/knex-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Setup status (c0 port): configured when DATABASE_URL is set, complete when
 * the migrations have run. Users come from Business OS, so there is no
 * "first user" step.
 */
export async function GET() {
  const configured = await credentials.exists();
  if (!configured) {
    return noCache({ is_configured: false, is_setup_complete: false, is_vercel: false });
  }
  let migrated = false;
  try {
    const knex = await getKnexClient();
    migrated = await knex.schema.hasTable('platform_sites');
  } catch (error) {
    return noCache({ is_configured: true, is_setup_complete: false, is_vercel: false, error: error instanceof Error ? error.message : 'Database unreachable' });
  }
  return noCache({ is_configured: true, is_setup_complete: migrated, is_vercel: false });
}

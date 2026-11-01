import { createRouteClient } from '@/lib/supabase-route-client';
import { noCache } from '@/lib/api-response';

/** GET /ycode/api/auth/session — the Business OS user of this browser, if any. */
export async function GET() {
  const client = await createRouteClient();
  const { data: { session } } = await client.auth.getSession();
  return noCache({ data: { session, user: session?.user || null } });
}

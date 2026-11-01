import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/** Users are created in Business OS; nothing to confirm here. */
export async function GET() {
  return noCache({ autoconfirm: true });
}

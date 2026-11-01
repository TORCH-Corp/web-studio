import { noCache } from '@/lib/api-response';

/** Roles come from Business OS permissions; nothing to set here. */
export async function POST() {
  return noCache({ ok: true, note: 'Roles are derived from Business OS permissions' });
}

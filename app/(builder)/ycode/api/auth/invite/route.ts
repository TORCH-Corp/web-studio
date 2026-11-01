import { noCache } from '@/lib/api-response';

export async function POST() {
  return noCache({ error: 'Invite people in Business OS Organization Setup; Web Studio has no users of its own' }, 501);
}

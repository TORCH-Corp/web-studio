import { noCache } from '@/lib/api-response';

/** The profile (name, email, password, avatar, account) is managed in Business OS. */
export async function DELETE() {
  return noCache({ error: 'Your profile is managed in Business OS' }, 501);
}

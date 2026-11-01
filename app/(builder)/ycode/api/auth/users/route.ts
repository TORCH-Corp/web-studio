import { noCache } from '@/lib/api-response';
import { getAuthUser } from '@/lib/supabase-auth';

/**
 * Users and roles are managed in Business OS (Organization Setup), not in
 * Web Studio. The list shows the current user only; changes are refused.
 */
export async function GET() {
  const auth = await getAuthUser();
  if (!auth) return noCache({ error: 'Not authenticated' }, 401);
  return noCache({
    data: {
      users: [{ id: auth.user.id, email: auth.user.email, role: auth.user.app_metadata?.role, name: auth.session.name, created_at: auth.user.created_at, last_sign_in_at: auth.user.updated_at }],
      invites: [],
    },
  });
}

export async function PATCH() {
  return noCache({ error: 'Users and roles are managed in Business OS' }, 501);
}

export async function DELETE() {
  return noCache({ error: 'Users and roles are managed in Business OS' }, 501);
}

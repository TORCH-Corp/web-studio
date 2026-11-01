import { noCache } from '@/lib/api-response';

/** The database is set by DATABASE_URL on the platform; there is nothing to connect from the browser. */
export async function POST() {
  return noCache({ error: 'Web Studio is configured by DATABASE_URL on the platform' }, 410);
}

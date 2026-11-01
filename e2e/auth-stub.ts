/**
 * A stand-in for auth-service in the e2e suite, serving the two routes the
 * callback calls with the user's own token (lib/platform/auth-service.ts):
 *
 *   GET /authz/my-permissions[?namespace=webstudio]   the leaf map of the subject's profile
 *   GET /users/me                                      the subject's profile
 *   GET /health                                        for Playwright's web server check
 *
 * The subject is read from the bearer token's claims without verifying it:
 * the app verifies the signature, this stub only has to answer for the people
 * in auth-fixtures.ts. An unknown subject or no token is 401, as auth-service
 * answers. Started by playwright.config.ts on E2E_AUTH_PORT.
 */

import http from 'node:http';
import { personBySub } from './auth-fixtures';

const PORT = Number(process.env.E2E_AUTH_PORT || 3103);

function subjectOf(authorization: string | undefined): string | undefined {
  const token = authorization?.replace(/^Bearer\s+/i, '');
  const payload = token?.split('.')[1];
  if (!payload) return undefined;
  try {
    return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string }).sub;
  } catch {
    return undefined;
  }
}

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/health') return json(response, 200, { ok: true });

  const person = personBySub(subjectOf(request.headers.authorization));
  if (!person) return json(response, 401, { error: 'Unauthorized', message: 'Invalid or missing token' });

  if (url.pathname === '/authz/my-permissions') {
    const namespace = url.searchParams.get('namespace');
    const prefix = namespace ? `${namespace}.` : null;
    const map = Object.fromEntries(Object.entries(person.permissions).filter(([key]) => !prefix || key.startsWith(prefix)));
    return json(response, 200, map);
  }
  if (url.pathname === '/users/me') {
    return json(response, 200, { id: person.sub, email: person.email, name: person.name, firstName: person.firstName, lastName: person.lastName, status: 'active', isSuperadmin: false });
  }
  return json(response, 404, { error: 'Not Found', message: `No route ${request.method} ${url.pathname}` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`e2e auth stub listening on http://127.0.0.1:${PORT}`);
});

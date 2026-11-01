# Web Studio port — ycode on the TORCH platform

Applies to ycode v1.38.1 (commit 2be0729) on `feature/web-studio-sites-and-publishing`:
the c0 port of 1 Nov 2026, then part 1's sessions on top of it (session 1 below).

## What it does
- **No Supabase.** `lib/platform/pg-client.ts` is a knex-backed drop-in for the Supabase
  query builder (the 23 methods ycode uses, embedded `!inner` selects, `.or()` DSL,
  JSON-path filters, count/head, upsert, the 4 RPCs). `lib/supabase-server.ts` returns it.
- **Business OS session.** `lib/platform/session.ts` verifies an HS256 session cookie
  (`bos_session`) carrying user, organization and Web Studio permission flags
  (`webstudio.manage_sites / manage_content / manage_forms / manage_orders`).
  `proxy.ts`, `lib/supabase-auth.ts`, the browser client and the auth store read it.
  Users, invites, profile and roles routes answer "managed in Business OS".
- **Per site (session 1; c0 was per organization).** Migration
  `20261101000001_torch_organizations.ts`: `tenant_id` on all 28 tables + index,
  natural-key unique indexes rebuilt per tenant, `set_tenant_context()` + BEFORE INSERT
  trigger. Migration `20261101000002_torch_sites.ts`: `platform_sites` (organization_id,
  name, slug unique among live sites, hosts, default_locale, is_template, created_by,
  deleted_at) replaces `platform_organizations`, and `tenant_id` means the site id.
  The adapter adds `tenant_id` to every query and insert. `lib/platform/site.ts`
  resolves the site: explicit id → AsyncLocalStorage → the signed `ws_site` cookie
  (the builder; refused when there is no session or the cookie's organization is not
  the session's) → the request host against `platform_sites.hosts` (published sites)
  → none. `lib/platform/provision.ts` creates a blank site (homepage, the three error
  pages, settings, the chosen locales) inside one transaction; the seeder is the one
  function session 4 replaces for a template copy. Unknown host → 404. Cache keys and
  tags carry the site.
- **Sites API (session 1).** `/ycode/api/platform/sites`: `GET` the session's
  organization's live sites with status, hosts and last publish; `POST` `{name, slug,
  languages: ['ar'|'en'], default_language, hosts?, template_id?}` (template_id is
  ignored until session 4; 409 on a slug or host in use); `DELETE /{id}` soft-deletes
  (the hosts stop resolving); `GET /{id}/open` sets `ws_site` and redirects to `/ycode`.
  A session is required; the organization is the session's; permission flags are
  session 2. The proxy answers 404 to any builder request whose `ws_site` cookie is
  not for the session's organization, without a database lookup (the cookie is signed
  and carries the organization), and drops the cookie.
- **Storage.** `lib/platform/storage.ts` + `/platform-storage/...` route: files on disk per
  site/bucket, public GET, signed PUT uploads. Swap for the platform object store in
  this one file (session 8: Document Center).
- **Realtime off.** Channels are accepted and do nothing (collaboration is a c1+ item).
- **Clean Postgres.** Migration `20240101000000_torch_platform_prelude.ts` provides the
  inert `auth.*` / `storage.*` objects the upstream migrations assume.

## Environment
    DATABASE_URL=postgresql://.../webstudio
    BOS_SESSION_SECRET=<shared with auth-service>
    PLATFORM_PUBLIC_URL=https://webstudio.<domain>
    PLATFORM_STORAGE=disk   # or document-center (session 8)
    PLATFORM_STORAGE_DIR=/var/lib/webstudio/storage   # disk mode
    DOCUMENT_CENTER_URL=http://document-center-service:6016   # document-center mode
    DOCUMENT_CENTER_API_KEY=<Document Center's SERVICE_API_KEY>
    ALLOW_DEV_LOGIN=false   # true only on a dev box: POST /ycode/api/auth/dev-login
    DATABASE_URL_TEST=postgresql://.../webstudio_test   # pnpm e2e only; recreated on every run

## Tests
- `pnpm test`: ycode's unit tests plus the platform's (`lib/platform/*.test.ts`).
- `pnpm e2e`: Playwright, `e2e/*.spec.ts`. `playwright.config.ts` recreates the database
  at `DATABASE_URL_TEST` (its name must contain "test"), builds, starts the app on port
  3102 with the dev login on, and runs the specs over HTTP: sessions through
  `POST /ycode/api/auth/dev-login`, sites through the sites API, published sites by
  `x-forwarded-host`. `e2e/sites.spec.ts` is session 1's done-when check. A local
  PostgreSQL 16 for it: `docker run -d --name webstudio-e2e-pg -e POSTGRES_PASSWORD=webstudio
  -e POSTGRES_USER=webstudio -e POSTGRES_DB=webstudio_test -p 127.0.0.1:54329:5432 postgres:16-alpine`
  then `DATABASE_URL_TEST=postgresql://webstudio:webstudio@127.0.0.1:54329/webstudio_test pnpm e2e`.
- Package manager: pnpm (`pnpm-lock.yaml`, imported from ycode's npm lock). `.npmrc` hoists
  the `@tiptap/*` and `@radix-ui/*` packages ycode imports without declaring them.

## Proven
c0 (sandbox, 1 Nov): 48 migrations on an empty PostgreSQL 16; `next build`; 284 upstream
unit tests pass; two organizations provisioned through the platform API; each signs in
with its own Business OS-style session, builds and publishes; public sites resolve by
host with no cookie; org B cannot see org A's pages, assets, forms or locales; unknown
host 404, API without session 401; asset presign → upload → public URL; contact form →
inbox → signed webhook with Arabic text; Arabic and Kurdish locales render
`dir="rtl"` for org A only; cache refreshed per organization on publish.

Session 1: `e2e/sites.spec.ts` (two organizations, three sites, publish, isolation of
pages, assets and locales, 404 across organizations, 401 without a session, 404 on an
unknown host, soft delete) and `pnpm test` pass; 49 migrations from empty.

## Not done (c1 and after)
- The builder still calls jsDelivr/Google Fonts/Remix icons at runtime: mirror them.
- The `@supabase/supabase-js` package stays as a type dependency; remove in c1.
- `settings/users` page still renders (its API answers 501): hide it in the Glare shell.
- Realtime collaboration, the AI agent (BYOK) and the MCP OAuth flow were not exercised.
- Cache tags are global + per-site: a publish by one site also drops the global
  entries of the others (correct, a little wasteful; session 5).
- The `bos_session` cookie comes from the shell's access token (session 2); the
  dev-login route stands in for that.
- `/ycode` with a session but no `ws_site` cookie shows an empty builder: the shell
  always enters through `GET /ycode/api/platform/sites/{id}/open` (session 9).

# Web Studio c0 port — ycode on the TORCH platform (prototype, 1 Nov 2026)

Applies to ycode v1.38.1 (commit 2be0729). Apply with `git apply torch-c0-port.patch`
in the TORCH fork on `feature/web-studio-sites-and-publishing`.

## What it does
- **No Supabase.** `lib/platform/pg-client.ts` is a knex-backed drop-in for the Supabase
  query builder (the 23 methods ycode uses, embedded `!inner` selects, `.or()` DSL,
  JSON-path filters, count/head, upsert, the 4 RPCs). `lib/supabase-server.ts` returns it.
- **Business OS session.** `lib/platform/session.ts` verifies an HS256 session cookie
  (`bos_session`) carrying user, organization and Web Studio permission flags
  (`webstudio.manage_sites / manage_content / manage_forms / manage_orders`).
  `proxy.ts`, `lib/supabase-auth.ts`, the browser client and the auth store read it.
  Users, invites, profile and roles routes answer "managed in Business OS".
- **Per organization.** Migration `20261101000001_torch_organizations.ts`: `tenant_id`
  (= Business OS organization id) on all 28 tables + index, natural-key unique indexes
  rebuilt per organization, `set_tenant_context()` + BEFORE INSERT trigger.
  The adapter adds `tenant_id` to every query and insert. The builder takes the
  organization from the session; a published site from its host name
  (`platform_organizations.hosts`). `lib/platform/provision.ts` + 
  `POST /ycode/api/platform/organizations` (shared-secret) create an organization with
  its starting content. Unknown host → 404. Cache keys and tags carry the organization.
- **Storage.** `lib/platform/storage.ts` + `/platform-storage/...` route: files on disk per
  organization/bucket, public GET, signed PUT uploads. Swap for the platform object
  store in this one file.
- **Realtime off.** Channels are accepted and do nothing (collaboration is a c1+ item).
- **Clean Postgres.** Migration `20240101000000_torch_platform_prelude.ts` provides the
  inert `auth.*` / `storage.*` objects the upstream migrations assume.

## Environment
    DATABASE_URL=postgresql://.../webstudio
    BOS_SESSION_SECRET=<shared with auth-service>
    PLATFORM_PUBLIC_URL=https://webstudio.<domain>
    PLATFORM_STORAGE_DIR=/var/lib/webstudio/storage
    ALLOW_DEV_LOGIN=false   # true only on a dev box: POST /ycode/api/auth/dev-login

## Proven in the sandbox
48 migrations on an empty PostgreSQL 16; `next build`; 284 upstream unit tests pass;
two organizations provisioned through the platform API; each signs in with its own
Business OS-style session, builds and publishes; public sites resolve by host with
no cookie; org B cannot see org A's pages, assets, forms or locales; unknown host 404,
API without session 401; asset presign → upload → public URL; contact form →
inbox → signed webhook with Arabic text; Arabic and Kurdish locales render
`dir="rtl"` for org A only; cache refreshed per organization on publish.

## Not done (c1 and after)
- The builder still calls jsDelivr/Google Fonts/Remix icons at runtime: mirror them.
- The `@supabase/supabase-js` package stays as a type dependency; remove in c1.
- `settings/users` page still renders (its API answers 501): hide it in the Glare shell.
- Realtime collaboration, the AI agent (BYOK) and the MCP OAuth flow were not exercised.
- Cache tags are global + per-organization: a publish by one organization also
  drops the global entries of the others (correct, a little wasteful).
- `auth-service` must issue the `bos_session` cookie (or the shell must forward it);
  the dev-login route stands in for that.

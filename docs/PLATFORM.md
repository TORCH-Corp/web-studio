# Web Studio on the TORCH platform (ycode fork)

Applies to ycode v1.38.1 (commit 2be0729) on `feature/web-studio-sites-and-publishing`:
the c0 port of 1 Nov 2026, then part 1's sessions on top of it (sessions 1 to 11 below).

## How the service runs (session 11)
One container, `web-studio`, in the platform's compose project on the production server
(`/root/core-backend/docker-compose.yml`; there is no staging, one server). It is built on the
server from this repository's `Dockerfile` and is not pulled from a registry:

    rsync -az --delete --exclude node_modules --exclude .git --exclude .next ./ root@<server>:/root/web-studio/
    ssh root@<server> 'cd /root/core-backend && docker compose build web-studio && docker compose up -d --no-deps web-studio'

- **Image.** `Dockerfile`: Node 24, pnpm 9.12.2 (the lockfile's), `NEXT_OUTPUT=standalone` (read by
  `next.config.ts`; no other build changes). `/app` is the standalone server (`node server.js`, port 6030, user
  `node`); `/tooling` is the repository with its full `node_modules`, where the migrations and the template seed
  run, because the standalone trace has neither ts-node nor tsconfig-paths.
- **Start.** `docker/entrypoint.sh` reads auth-service's public key from `BOS_JWT_PUBLIC_KEY_FILE` into
  `BOS_JWT_PUBLIC_KEY`, runs `knex migrate:latest` (with the ts-node and tsconfig-paths requires, from `/tooling`), then
  starts the server. A failed migration stops the container (compose restarts it; the log says why). `WS_SKIP_MIGRATE=1`
  skips the migration step.
- **Health.** `GET /ycode/api/health`: 200 `{status:'ok'}` when the database answers and the migrations have run, 503
  otherwise. The compose healthcheck reads it.
- **Compose pieces.** Service `web-studio` publishing `127.0.0.1:6030`; `web-studio-db` (postgres:16, database
  `webstudio`, its own volume `web_studio_postgres_data`, no published port, like a service's own database); volume
  `web_studio_storage` at `/var/lib/webstudio/storage`. In `PLATFORM_STORAGE=document-center` mode that volume holds only
  the font mirror (`_mirror/fonts`); in `disk` mode it holds every site's files. Secrets in the root `.env`:
  `WEBSTUDIO_DB_PASSWORD`, `WEBSTUDIO_SESSION_SECRET`, `WEBSTUDIO_PAGE_AUTH_SECRET`, plus `WEBSTUDIO_APP_ID` (the
  catalogue id of Web Studio) and `WEBSTUDIO_TEMPLATES_ORG`. The service reuses `AUTH_SERVICE_API_KEY`,
  `DOCUMENT_CENTER_API_KEY` and `DOMAIN_SERVICE_API_KEY` from the same `.env`.
- **nginx.** `docker/nginx/` holds what is installed on the server: `web-studio.torchcorp.com` (Cloudflare-proxied,
  origin certificate), `sites.torchcorp.com` (`server_name sites.torchcorp.com *.sites.torchcorp.com`, DNS only, the
  Let's Encrypt wildcard certificate at `/etc/letsencrypt/live/sites.torchcorp.com/`, renewed by certbot's timer, whose
  hook reloads nginx), and `web-studio-proxy.conf` in `/etc/nginx/snippets/`. Both proxy to `127.0.0.1:6030` with `Host`
  and `X-Forwarded-Host` set to the requested name (the app finds a published site by `x-forwarded-host`, then `host`),
  `X-Forwarded-Proto https`, `client_max_body_size 60m`, and for `/ycode/api/ai/chat` and `/ycode/mcp` no buffering and
  a one-hour timeout. `/ycode/api/auth/callback` has its access log off: the access token is in its query string.
- **Custom domains.** The app already routes any host a site lists in `platform_sites.hosts`; what a mapped domain needs
  is a name nginx accepts and a certificate. `docker/nginx/add-custom-domain.sh <domain>` (run as root on the server,
  after the host is set on the site and verified in Organization Setup, and the domain's DNS reaches the server) writes
  the port-80 block, gets a Let's Encrypt certificate by HTTP-01 (webroot) with certbot, writes the port-443 block with
  the same locations, and reloads nginx. Renewal is certbot's timer. It is run by hand today: the container cannot reach
  the host's nginx and certbot, so Web Studio does not trigger it (OPEN_QUESTIONS 4 offered a Caddy front with on-demand
  TLS as the alternative; it would replace nginx on 443 for these hosts and was not taken).
- **The Tauri app.** It reads `WS_URL` (run time, else build time, else the default `https://web-studio.torchcorp.com`)
  in `src-tauri/src/embedded/ws_gateway.rs` of `code/web-studio-app`. The server does not read `WS_URL`.

## Seeding the templates
Once per environment, after the first start, and again when a template's name or description changes (the content of
each is built by hand in the builder, in the `WS_TEMPLATES_ORG` organization):

    docker exec web-studio sh -c 'cd /tooling && TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.test.json \
      node -r ts-node/register -r tsconfig-paths/register scripts/seed-templates.ts'

It creates `company-site`, `landing-page` and `blank` with their fixed ids if absent and refreshes names and descriptions
if present; it never touches a template's content.

## How a site is created and published
The Tauri app (or any caller with `webstudio.manage_sites`) `POST`s `/ycode/api/platform/sites` with a name, a slug,
the languages and an optional `template_id`; provisioning (or the template copy) runs in one transaction and the site's
default address `{slug}.sites.torchcorp.com` is its first host. `GET /ycode/api/platform/sites/{id}/open` (or the
callback with `&site=`) opens it in the builder; edits are draft until `POST /ycode/api/publish`, after which the
site answers on its hosts (the default language at `/`, the others at `/{locale}`). nginx forwards the visitor's host;
an unused host is 404. Details of each step are in the sections below.

## Server e2e
`pnpm e2e:server` (`playwright.server.config.ts`, `e2e/server/deployment.spec.ts`) runs against the deployed service over
HTTPS: health, the dev login refused (404), 401 without a session, an unused address 404, a real access token from
auth-service through the callback, the three templates, a site created, published and served on
`https://{slug}.sites.torchcorp.com` in both languages, then deleted. It needs `E2E_BOS_EMAIL` and `E2E_BOS_PASSWORD` (a test
account; its organization is the test organization) and starts nothing. The local `pnpm e2e` is unchanged and must never be
given the production `DATABASE_URL_TEST`: it drops the schema.

## What it does
- **No Supabase.** `lib/platform/pg-client.ts` is a knex-backed drop-in for the Supabase
  query builder (the 23 methods ycode uses, embedded `!inner` selects, `.or()` DSL,
  JSON-path filters, count/head, upsert, the 4 RPCs). `lib/supabase-server.ts` returns it.
- **Business OS session.** `lib/platform/session.ts` verifies an HS256 session cookie
  (`bos_session`) carrying user, organization and Web Studio permission flags
  (`webstudio.manage_sites / manage_content / manage_forms / manage_orders`).
  `proxy.ts`, `lib/supabase-auth.ts`, the browser client and the auth store read it.
  The cookie is minted from the shell's access token (session 2, below).
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
- **Templates (session 4).** A template is a live site with `is_template` in the TORCH
  templates organization (`WS_TEMPLATES_ORG`), built in the builder like any site and
  never published on a host (`siteIdForHost` leaves templates out; the sites API refuses
  hosts on one, provisioning gives it no default address, and the settings API keeps it so: a
  slug change moves no address and a custom host is refused with 400). Migration
  `20261101000004_torch_template_meta.ts` adds `platform_sites.template`
  (`{name: {ar, en}, description: {ar, en}}`). `GET /ycode/api/platform/templates` lists them
  for any organization (`manage_sites` r, in the proxy's route map). `POST /ycode/api/platform/sites`
  with `template_id` copies the template's draft rows into the new site inside the
  provisioning transaction (`lib/platform/template-copy.ts`: pages, page folders, page
  layers, components, layer styles, colour variables, global variables, fonts, assets and
  asset folders with their files, settings, locales and translations); every row gets a new
  id and every reference inside the copied rows follows the map, by replacing each known id
  wherever it appears in the row's text (the way ycode's own template export does). Only the
  languages asked for are copied; a language the template lacks becomes an empty locale. Not
  copied: published rows (the copy is a draft; the error pages get a published twin as blank
  provisioning gives them), versions, collections, forms, API keys, webhooks, integrations, AI
  chats, and the settings `published_at`, `published_css`, `site_name`, `global_canonical_url`,
  `google_site_verification`, `ga_measurement_id` and the AI provider keys. A file an asset or
  font row names that is missing fails the creation (rollback, the new site's files removed).
  The blank template is provisioning, not a copy; an unknown `template_id` is 404. The
  templates organization may send `is_template: true` with the template's `template` meta
  (defaults: the site name, no description); anyone else gets 400. `pnpm templates:seed`
  (`scripts/seed-templates.ts`) creates the three templates of part 1 with fixed ids
  (`lib/platform/templates.ts`, `PART_1_TEMPLATES`) or refreshes their names and
  descriptions; their content is built by hand (Task B).
- **Storage.** `lib/platform/storage.ts` + `/platform-storage/...` route: files on disk per
  site/bucket, public GET, signed PUT uploads. Swap for the platform object store in
  this one file (session 8: Document Center, `PLATFORM_STORAGE=document-center`,
  `lib/platform/storage-document-center.ts`). The template copy's `copySiteStorage`,
  `objectExists` and `removeSiteStorage` follow the mode: in Document Center the template's
  files are uploaded again as new documents under the new site's organization
  (`copySiteFiles`).
- **Realtime off.** Channels are accepted and do nothing (collaboration is a c1+ item).
- **Clean Postgres.** Migration `20240101000000_torch_platform_prelude.ts` provides the
  inert `auth.*` / `storage.*` objects the upstream migrations assume.

## Environment
The production values are in the compose service `web-studio` (secrets from the root `.env`).

    DATABASE_URL=postgresql://.../webstudio
    BOS_SESSION_SECRET=<Web Studio's own; signs the bos_session and ws_site cookies>
    BOS_JWT_PUBLIC_KEY=<auth-service's RS256 public key, PEM>   # or BOS_JWT_PUBLIC_KEY_FILE=<path of the PEM>: the container's entrypoint reads it
    BOS_AUTH_URL=http://auth-service:6001   # my-permissions and users/me; default https://auth.torchcorp.com
    EVENT_BUS_REDIS_URL=redis://redis:6379  # the core event bus: publishes the webstudio permission scope
    WS_APP_ID=<Web Studio's catalogue app id>   # which app.installed is ours
    APP_MANAGEMENT_URL=http://app-management-service:6011   # with APP_MANAGEMENT_API_KEY: re-register the
    APP_MANAGEMENT_API_KEY=<app-management's SERVICE_API_KEY>  # scope at start for the installed organizations
    PLATFORM_PUBLIC_URL=https://web-studio.torchcorp.com
    PLATFORM_STORAGE=disk   # or document-center (session 8; production)
    PLATFORM_STORAGE_DIR=/var/lib/webstudio/storage   # disk mode; the font mirror in either mode
    DOCUMENT_CENTER_URL=http://document-center-service:6016   # document-center mode
    DOCUMENT_CENTER_API_KEY=<Document Center's SERVICE_API_KEY>
    WS_SITES_DOMAIN=sites.torchcorp.com   # default addresses are {slug}.{this}; required, never guessed
    DOMAIN_SERVICE_URL=http://domain-service:6012   # with DOMAIN_SERVICE_API_KEY: the organization's verified domains
    DOMAIN_SERVICE_API_KEY=<domain-service's SERVICE_API_KEY>   # (session 7); see WS_DOMAIN_CHECK below
    WS_DOMAIN_CHECK=on   # `off` accepts any host name as a custom host, with no check against verified domains
    PAGE_AUTH_SECRET=<signs the password-protected page cookies; Web Studio's own>
    ALLOW_DEV_LOGIN=false   # absent in production; true only on a dev box: POST /ycode/api/auth/dev-login
    WS_PARTS=1   # absent in production: shows Collections and Forms (parts 2 and 3)
    WS_TEMPLATES_ORG=<uuid>  # the Business OS organization whose sites are TORCH's templates (session 4); on the server "TORCH corp"
    DATABASE_URL_TEST=postgresql://.../webstudio_test   # pnpm e2e only; recreated on every run

After the migrations, once per environment and again when a template's name or
description changes: `pnpm templates:seed`.

## Tests
- `pnpm test`: ycode's unit tests plus the platform's (`lib/platform/*.test.ts`).
- `pnpm e2e`: Playwright, `e2e/*.spec.ts`. `playwright.config.ts` recreates the database
  at `DATABASE_URL_TEST` (its name must contain "test"), seeds TORCH's templates
  (`pnpm templates:seed`), builds, starts the app on port 3102 (`E2E_PORT`) with the dev login
  on and a stand-in for auth-service beside it (`e2e/auth-stub.ts`, port `E2E_PORT + 1`, the
  people of `e2e/auth-fixtures.ts`), and runs the specs over HTTP: sessions through the
  callback with tokens signed by the test key pair (`e2e/test-keys.ts`, under the temp
  directory) or through `POST /ycode/api/auth/dev-login`, sites through the sites API,
  published sites by `x-forwarded-host`. Several worktrees can run it at once with their own
  `E2E_PORT` and `DATABASE_URL_TEST`. `e2e/sites.spec.ts` is session 1's done-when check,
  `e2e/templates.spec.ts` session 4's. A local PostgreSQL 16 for it: `docker run -d --name
  webstudio-e2e-pg -e POSTGRES_PASSWORD=webstudio -e POSTGRES_USER=webstudio
  -e POSTGRES_DB=webstudio_test -p 127.0.0.1:54329:5432 postgres:16-alpine`
  then `DATABASE_URL_TEST=postgresql://webstudio:webstudio@127.0.0.1:54329/webstudio_test pnpm e2e`.
  Sessions running side by side each use their own database in that container and their
  own `E2E_PORT`.
- Package manager: pnpm (`pnpm-lock.yaml`, imported from ycode's npm lock). `.npmrc` hoists
  the `@tiptap/*` and `@radix-ui/*` packages ycode imports without declaring them.

## Publishing per site (session 5)
- **Default address.** `lib/platform/site-hosts.ts`: `{slug}.{WS_SITES_DOMAIN}` is the first entry of
  `platform_sites.hosts` from creation. A custom host under the sites domain, or the bare domain itself,
  that is not the site's own address is refused (409), so no site can squat another slug's address or
  the platform's. `lib/platform/site-update.ts`:
  `changeSiteSlug` moves the default address with the slug; `setCustomHosts` replaces the custom hosts
  (the default stays). Session 7's settings API calls both.
- **Host cache.** The 30 s host and site lookups (`lib/platform/site.ts`) are forgotten when a site is
  created, deleted, renamed or its hosts change, and on every publish. Another process keeps a stale
  entry for at most 30 s.
- **Cache tags are per site only.** Every cached entry of a published page (page, layers, metadata,
  redirects, settings, folders, locales, error pages, linked pages) carries the site's `tenant-{id}`,
  `t-{id}-route-…` or `t-{id}-global-settings` tag (`lib/cache-tags.ts`), and `cacheService` purges
  those and nothing global when a site is in context, so one site's publish or settings change never
  touches another's. `revalidatePath('/', 'layout')` runs only with no site in context.
- **Unknown host.** The page, `robots.txt` and `sitemap.xml` answer 404; the 404 page is a plain one
  with no site's content. A known host's missing page renders that site's own 404 page (the boundary
  now reads the site from the host; it used to read an AsyncLocalStorage that is empty there).

## Site settings (session 7)
- **API.** `GET` and `PATCH /ycode/api/platform/sites/{id}/settings` (`manage_sites` r / u), in
  `app/(builder)/ycode/api/platform/sites/[id]/settings/route.ts`; the logic is `lib/platform/site-settings.ts`,
  the body is `site-settings-input.ts`. The route's own comment lists the statuses.
- **Where each setting lives.** Name: `platform_sites.name` and the `site_name` setting, equal (a write to
  `site_name` from the builder's General settings, the MCP tools or the API reaches `platform_sites.name`
  through `mirrorSiteName` in `settingsRepository`). Languages: the draft `locales` rows, created and
  made default as the localization screen does; removing one soft-deletes it and its draft translations
  after a second call with `confirm: true`, and the next publish takes it off the published site. Domain:
  `platform_sites.hosts`. SEO defaults: the settings `seo_default_title`, `seo_default_description`,
  `seo_default_image` (an asset id), read by `generatePageMetadata` where a page has no value of its own
  (the share image is resolved in `fetchGlobalPageSettings`, outside the metadata cache, like the favicon).
- **Verified domains.** `lib/platform/domain-check.ts` asks domain-service
  (`GET /api/org-setup/domains?entityId=…&status=ACTIVE`, `x-service-api-key`). A custom host must be one of
  the ACTIVE names exactly. A check that cannot run answers 503, never an allow. `WS_DOMAIN_CHECK=off` skips
  it. Since 2 Nov 2026 domain-service reads `SERVICE_API_KEY` (`${DOMAIN_SERVICE_API_KEY}` in the root `.env`)
  and production runs with `WS_DOMAIN_CHECK=on` and the same key as `DOMAIN_SERVICE_API_KEY`.
- **Not atomic across tables.** The builder's repositories do not share a transaction. `applySiteSettings`
  refuses everything it can before the first write, then writes the slug and host first (the only ones another
  site can contest), then name and SEO, then languages.
- **Test.** `e2e/settings.spec.ts`; the auth stub also stands in for domain-service's list
  (`e2e/domain-fixtures.ts`).
- **The share image's picker (session 10).** The Tauri app picks the share image from the site's images.
  `GET /ycode/api/platform/sites/{id}/assets` (`manage_sites` r; `lib/platform/site-assets.ts`, the query in
  `site-assets-input.ts`) lists the site's draft JPEG, PNG, GIF and WebP images, newest first, with `search`,
  `page` and `limit` (at most 100). `GET /ycode/api/platform/sites/{id}/assets/{assetId}` serves one of them:
  `/a/{hash}/{name}` finds an asset only for the site the request resolves to (the `ws_site` cookie, or the
  host of a published page), and the app has neither, so this route checks the image is the site's and calls
  ycode's `/a/` handler inside `runWithSite`, with `width`, `height` and `quality` passed on. Uploads are
  stored as WebP (`lib/file-upload.ts`), named without their extension. Test: `e2e/site-assets.spec.ts`.

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

Session 4: `e2e/templates.spec.ts` (the three seeded templates listed for any
organization, 403 without `manage_sites` r; a template with three pages, a component, a
style, a colour, an uploaded asset and a translation created through the API in the
templates organization; a site copied from it in another organization with the same
content under new ids, the asset's file copied, the draft preview identical to the
template's up to ids; the template and the copy edited independently; one language copied
alone; blank by the blank template or with no template; unknown template 404; `is_template`
refused outside the templates organization and with hosts; a template has no default address
and its would-be address is 404, also after a rename through the settings API, which refuses a
custom host on it; the asset copied in Document Center mode) and `pnpm test`
pass (367); 52 migrations from empty.

Session 5: `e2e/publish.spec.ts` (default address with no host given, two sites publishing with their
own content, an unpublished edit invisible until publish, `/ar` rtl and 404 where absent, unknown host,
each site's own 404 page, a second host after the next publish) passes with `pnpm test` (303).

## Session 3: platform assets and trimming
- **No public host in the builder.** `public/vendor/` holds `@tailwindcss/browser`, GSAP
  (+ SplitText), Swiper and mapbox-gl, copied from `node_modules` by
  `scripts/vendor-assets.mjs` (re-run after bumping them; `VERSIONS.json` records the
  versions). The canvas, the CSS generator, the map embed, the Code element's example and
  the static export's Swiper script load them from `/vendor/`. Remix icons: `/ycode/api/icons`
  answers from `lib/platform/data/remix-icons.json` (built by `scripts/build-remix-icons.mjs`
  from the `remixicon` package, Remix Icon License v1.0, copy beside it). Google Fonts in the
  builder (font picker, installed-font links, `@import`) go through `/ycode/api/fonts/mirror/`:
  `lib/platform/font-mirror.ts` fetches a stylesheet or font file from Google on the server
  the first time and keeps it in `PLATFORM_STORAGE_DIR/_mirror/fonts`. **Published pages keep
  Google URLs** for the fonts a designer picks (`PageRenderer`, static export, the
  `Link: preconnect` header in `next.config.ts`). ycode's template service has no default
  host any more (`TEMPLATE_API_URL` unset: the gallery is empty, apply and export refuse);
  its hard-coded upload key is gone.
- **No Supabase package.** `@supabase/supabase-js` and `@supabase/ssr` are out of
  `package.json`; `lib/platform/types.ts` has the types the code used (User, Session,
  RealtimeChannel, SupabaseClient). `database/scripts/backfill-content-hashes.ts` (a
  Supabase-only upstream script) is deleted.
- **Removed screens** (404 from `proxy.ts`, files deleted): settings/users, profile,
  accept-invite, welcome (the Supabase setup wizard), with their API stubs and the invite
  button. A server without `DATABASE_URL` shows a message instead of redirecting to the wizard.
- **`WS_PARTS=1`** (server env, read by `lib/platform/parts.ts`) shows Collections and Forms.
  Unset, `/ycode/collections*` and `/ycode/forms*` answer 404, the header has no CMS and
  Forms buttons, and the element library has no Form element. The `collection` and `filter`
  elements and the API routes stay (the pages and the builder's stores use them).
- `e2e/offline.spec.ts` is the done-when check.

## Session 2: session and permissions
- **Token in, cookie out.** `GET /ycode/api/auth/callback?token=<access token>[&site=<id>]`
  (`app/(builder)/ycode/api/auth/callback/route.ts`) verifies the RS256 access token with
  auth-service's public key (`lib/platform/access-token.ts`, `BOS_JWT_PUBLIC_KEY`: the live
  spec has no key endpoint and `/.well-known/jwks.json` answers 404), reads the user's flags
  from `GET /authz/my-permissions?namespace=webstudio` and the name from `GET /users/me`
  (`lib/platform/auth-service.ts`; the token has no name claim) and mints `bos_session` for
  the token's `sub`, `entityId` (the organization) and the true `webstudio.*` flags, living
  as long as the token (15 minutes). A user with no Web Studio flag gets 403 and no cookie.
  With `site`, the organization check and `ws_site`, as `/open` does; without it the site
  the builder is on is kept. A browser navigation is sent to `/ycode`; a fetch with
  `Accept: application/json` gets the session view. `GET /ycode/api/auth/session` returns
  user, organization, site, flags, role and `expiresAt` (`lib/platform/session-view.ts`).
  The dev login stays, `ALLOW_DEV_LOGIN=true` only.
- **Renewal without a sign-out** (`lib/platform/browser-session.ts`, hooked into
  `lib/supabase-browser.ts`; rule embedded-apps.md). The builder posts
  `{type: 'torch:request-token'}` to `window.parent` and takes
  `{type: 'torch:set-token', token, expiresAt?, site?}` back, from `window.parent` only;
  a push without a request is kept for the next renewal. The initial wait, the renewal
  and the retry after a 401 run only while the builder is framed (`isEmbedded()`:
  `window.parent !== window`). Unframed, a token that a Tauri webview evaluates into the
  page with `window.postMessage(...)` is stored but never exchanged, so a top-level
  webview's cookie dies with the token after 15 minutes: session 9 either frames the
  builder or arms the bridge another way (OPEN_QUESTIONS 13). A page that loads without a
  session waits for the shell under
  ycode's "Checking authentication" screen; the cookie is renewed a minute before it runs
  out; a builder request refused with 401 waits for the renewal under "Reconnecting to
  Business OS…" (`lib/platform/SessionNotice.tsx`, ycode's `BuilderLoading`, mounted in
  `app/(builder)/layout.tsx`) and is sent again. No deadline, no login page. Same shape as
  every other child app's `embedded-auth-provider` (the shell pushes a token every minute,
  the app adopts it, retries once after a 401, shows a reconnecting notice).
- **Enforced in the proxy.** `lib/platform/permissions.ts` names the leaf and flag of every
  route under `/ycode/api` (and `/ycode/preview`, `/api/templates`): the flag follows the
  method (POST c, GET r, PUT/PATCH u, DELETE d) unless the route says otherwise (publish,
  revert, status u; static and project export `export`; the AI agent and MCP tokens
  `use_ai`; devtools reset d). manage_sites: the sites API; manage_content: the builder's
  data; manage_forms: collections, forms, webhooks, API keys, integrations (part 3);
  manage_orders: no route yet (part 2). Public routes have their own credential; a few are
  anonymous by design for visitors (a form submission, a published page's filter, the
  published error page). `proxy.ts` answers 401 with no session, 403 with
  `{error, required: 'webstudio.manage_sites.c'}` without the flag, and 404 for a path
  the map does not know; `lib/platform/permissions.test.ts` fails on a route file without
  a rule or a rule without a file. ycode's `roleFromPermissions` mapping stays for the
  builder's own gating.
- **Scope registration** (`lib/platform/permission-scope.json`, `lib/platform/web-studio-scope.ts`,
  `lib/platform/scope-registration.ts`, started from `instrumentation.ts`; OPEN_QUESTIONS 10).
  The four leaves in three modules with PRD V1.0's defaults (Manager every flag, Member
  manage_content c r u and manage_sites r, Viewer r on both, nothing on forms and orders).
  Published on the core event bus (Redis pub/sub, `core-events:app.permission_scope.registered`,
  envelope `{event_id, event, payload, timestamp}`) when `app.installed` arrives for
  `WS_APP_ID`, and again at start for every organization app-management lists as having the
  app, retried with backoff; the way contact-center-service does it. `ioredis` is the one
  new dependency. Without `EVENT_BUS_REDIS_URL` or `WS_APP_ID` it logs why and does nothing.
- `e2e/session.spec.ts` is the done-when check (`pnpm test`: 341).

## Session 6: editor lock
- **One editor at a time per site** (PRD V1.0 "Sites"). Migration `20261102000001_torch_site_locks.ts`:
  `platform_site_locks` (site_id primary key, user_id, user_name, acquired_at, heartbeat_at; not a tenant table).
  `lib/platform/site-lock.ts` has the one write, `acquireSiteLock`: a single upsert that takes the lock when it is
  free or the caller's and refreshes the heartbeat, so two users cannot both win. A heartbeat older than 15 minutes
  is free; every comparison uses the database clock. The lock is the user's, not the tab's.
- **Taking it.** `GET /sites/{id}/open` takes it (and still opens the site read-only when another user holds it);
  the builder's first load and its heartbeat call `POST /ycode/api/platform/site-lock` (the site is the `ws_site`
  cookie's) every minute: `{data: {held, holder: {name, since, ...}}}`. `DELETE` lets go of the caller's own lock
  only. `POST /auth/logout` releases it too, on the server. The builder releases on `pagehide` (a keepalive DELETE),
  not `beforeunload`, which also fires when the user cancels leaving a page with unsaved changes.
- **Read-only on the server** (`proxy.ts`, `isEditingWrite` in `permissions.ts`). A write is a non-GET request on a
  `manage_content` or `manage_forms` route whose flag is not `r` or `export`; the sites API is not one. It answers
  423 `{error, holder, since}` when another user holds the lock, after the 401/403 checks. A write with a free or
  lapsed lock takes it (a write is activity). `permissions.test.ts` pins which routes are writes: a content POST that
  only reads must say `r` in the map.
- **Read-only in the builder.** `lib/platform/site-lock-client.ts` (state, heartbeat, release), `SiteLockKeeper`
  (mounted in the builder layout), `SiteLockBanner` (ycode's `Alert`, warning variant, above the canvas). Publish
  uses `PublishPopover`'s own `isDisabled`; the header's save label reads "Read-only"; autosave and
  `saveImmediately` do nothing. The canvas stays browsable, and local edits are not saved. A read-only builder keeps
  beating; when the editor leaves, its next beat takes the lock and reloads the page once.
- **`GET /ycode/api/platform/sites/{id}`** returns the site as the list does plus `lock`: null, or
  `{holder, user_id, since, held_by_you}`. The list does not carry it yet.
- **`lib/services/migrationService.ts`** no longer closes the knex pool after a successful run. Every builder load
  posts to `/setup/migrate`, and the close aborted whatever query was in flight (another user's save, now the lock check).
- `e2e/lock.spec.ts` is the done-when check (`pnpm test`: 348; `pnpm e2e`: 46).

## Not done (c1 and after)
- **A published page renders an image layer as ycode's placeholder** (the data-URL SVG of
  `ASSET_PLACEHOLDERS`) while the preview renders the asset (`/a/<token>/file`). Seen in
  session 4 on a site copied from a template and reproduced on a plain site (upload a PNG,
  put it on the homepage, publish, fetch by host); the published asset row exists and the
  layers name it. The cause is in the published render path, before `PageRenderer`'s asset
  lookup. Session 5 (publishing) or 3 (platform assets) owns it.
- Realtime collaboration and the MCP OAuth flow were not exercised (the AI agent, MCP and
  integrations screens open: `e2e/offline.spec.ts`).
- The cookies are `SameSite=Lax` without `Secure`: right for a top-level webview behind
  nginx's TLS; a builder framed by a page on another site (a Tauri window at
  `tauri://localhost`) would need `SameSite=None; Secure`, and WKWebView blocks third-party
  cookies anyway. Session 9 settled that the builder is never framed (OPEN_QUESTIONS 13), so the flags stay;
  `Secure` is not set in production either (the cookies are minted behind nginx's TLS, where the app sees http).
- `/ycode` with a session but no `ws_site` cookie shows an empty builder: the shell
  always enters through `GET /ycode/api/platform/sites/{id}/open` (session 9).

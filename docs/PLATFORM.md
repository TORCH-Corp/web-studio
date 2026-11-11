# Web Studio on the TORCH platform (ycode fork)

Applies to ycode v1.38.1 (commit 2be0729) on `feature/web-studio-sites-and-publishing`:
the c0 port of 1 Nov 2026, then part 1's sessions on top of it (sessions 1 to 11 below), then part 2 (storefront and cart,
on `feature/web-studio-storefront-and-cart`: sessions W1 to W8 and D1 below; **"Part 2 in production (session D1)"** is
the one place that lists its keys, tables, routes, checkout flow, image cache and how it was deployed; "Part 2 release fixes
(session 22)" lists the fixes made to it and to ycode's own files after the build).

## How the service runs (session 11)
One container, `web-studio`, in the platform's compose project on the production server
(`/root/core-backend/docker-compose.yml`; there is no staging, one server). It is built on the
server from this repository's `Dockerfile` and is not pulled from a registry:

    rsync -az --delete --exclude node_modules --exclude .git --exclude .next ./ root@<server>:/root/web-studio/
    ssh root@<server> 'cd /root/core-backend && docker compose build web-studio && docker compose up -d --no-deps web-studio'

- **Image.** `Dockerfile`: Node 24, pnpm 9.12.2 (the lockfile's), `NEXT_OUTPUT=standalone` (read by
  `next.config.ts`; no other build changes). `/app` is the standalone server (`node server.js`, port 6030, user
  `node`); `/tooling` is the repository with its full `node_modules`, where the migrations and the template seed
  run, because the standalone trace has neither ts-node nor tsconfig-paths. `outputFileTracingIncludes` in
  `next.config.ts` adds Tailwind's `index.css` to the trace: the publish-time CSS compiler
  (`lib/server/tailwind-compiler.ts`) opens it from `node_modules` at run time, and without it every publish logged
  `ENOENT` and left the page's CSS as it was.
- **Start.** `docker/entrypoint.sh` reads auth-service's public key from `BOS_JWT_PUBLIC_KEY_FILE` into
  `BOS_JWT_PUBLIC_KEY`, runs `knex migrate:latest` (with the ts-node and tsconfig-paths requires, from `/tooling`), then
  starts the server. A failed migration stops the container (compose restarts it; the log says why). `WS_SKIP_MIGRATE=1`
  skips the migration step.
- **Health.** `GET /ycode/api/health`: 200 `{status:'ok'}` when the database answers and the migrations have run, 503
  otherwise. The compose healthcheck reads it.
- **Compose pieces.** Service `web-studio` publishing `127.0.0.1:6030`; `web-studio-db` (postgres:16, database
  `webstudio`, its own volume `web_studio_postgres_data`, no published port, like a service's own database); volume
  `web_studio_storage` at `/var/lib/webstudio/storage`. In `PLATFORM_STORAGE=document-center` mode that volume holds only
  the font mirror (`_mirror/fonts`) and the store's item images (`_store-media`, part 2, W2); in `disk` mode it holds every
  site's files as well. Secrets in the root `.env`:
  `WEBSTUDIO_DB_PASSWORD`, `WEBSTUDIO_SESSION_SECRET`, `WEBSTUDIO_PAGE_AUTH_SECRET`, plus `WEBSTUDIO_APP_ID` (the
  catalogue id of Web Studio) and `WEBSTUDIO_TEMPLATES_ORG`. The service reuses `AUTH_SERVICE_API_KEY`,
  `DOCUMENT_CENTER_API_KEY` and `DOMAIN_SERVICE_API_KEY` from the same `.env`, and since part 2 the keys of the services
  the store calls (`AUTH_INTERNAL_SERVICE_API_KEY`, `PS_SERVICE_API_KEY`, `CC_SERVICE_API_KEY`, `SALES_SERVICE_API_KEY`) and
  `SALES_APP_ID`: see "Part 2 in production".
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

It creates `company-site`, `landing-page`, `blank` and, since part 2, `online-store` with their fixed ids if absent and
refreshes names and descriptions if present; it never touches a template's content.

## How a site is created and published
The Tauri app (or any caller with `webstudio.manage_sites`) `POST`s `/ycode/api/platform/sites` with a name, a slug,
the languages and an optional `template_id`; provisioning (or the template copy) runs in one transaction and the site's
default address `{slug}.sites.torchcorp.com` is its first host. `GET /ycode/api/platform/sites/{id}/open` (or the
callback with `&site=`) opens it in the builder; edits are draft until `POST /ycode/api/publish`, after which the
site answers on its hosts (the default language at `/`, the others at `/{locale}`). nginx forwards the visitor's host;
an unused host is 404. Details of each step are in the sections below.

## Server e2e
`pnpm e2e:server` (`playwright.server.config.ts`, `e2e/server/*.spec.ts`) runs against the deployed service over HTTPS. It
needs `E2E_BOS_EMAIL` and `E2E_BOS_PASSWORD` (a test account; its organization is the test organization) and starts nothing.
`deployment.spec.ts` (part 1) is: health, the dev login refused (404), 401 without a session, an unused address 404, a real
access token from auth-service through the callback, the four templates, a site created, published and served on
`https://{slug}.sites.torchcorp.com` in both languages, then deleted. Part 2 (session D1) adds five, against the real
Organization Setup, Product & Services, Contact Center, Sales and Document Center, no stub: `store-settings.spec.ts`,
`catalogue.spec.ts` (with the item's real image), `checkout.spec.ts`, `orders-api.spec.ts` and `storefront-browser.spec.ts` (a
buyer in a real browser on a published site, and every host the store pages and the builder contact). The local `pnpm e2e`
leaves `e2e/server` out (`testIgnore` in `playwright.config.ts`) and must never be given the production `DATABASE_URL_TEST`: it
drops the schema.
- **What a run uses and leaves** (`e2e/server/real-services.ts`). One login for the whole run (`global-setup.ts` keeps the
  token in `E2E_ACCESS_TOKEN`, in memory; auth-service answers 429 after 20 logins in 15 minutes). One fixed test item,
  SKU `E2E-WS-STORE-01` ("E2E Web Studio test item", 25,000 IQD, the "All - General" leaf category, with one 8 x 8 PNG as its
  `product_image` uploaded through Document Center), found by its SKU or made, put active and on the ECOMMERCE channel at the
  start, and switched off (channel off, INACTIVE) by `global-teardown.ts`, because Product & Services only deletes drafts. One
  fixed test buyer, `0770 000 0099` (Contact Center holds the person as `9647700000099`, found by phone on every run). Each
  spec makes its own site on the test organization (selling, IQD, the headquarters branch, a 2,500 fee) and deletes it. Every
  Sales order a run makes is **cancelled** by the run through the Orders API's status route, even when a spec fails (each
  spec's `afterAll`), so the order stays in Sales as cancelled with the reason and the acting user; a run leaves no draft or
  confirmed order. `platform_storefront_orders` keeps one row per checkout, for the soft-deleted site.
- **The check that nothing goes to a public host** is `storefront-browser.spec.ts`: it records the host of every request,
  websockets included, of a published store page in English and in Arabic, and of the builder opening the site and its Store
  elements. The store pages contact only the site's own host. The builder contacts its own host and one more, Cloudflare's Web
  Analytics beacon, which Cloudflare's edge injects into the HTML of the proxied builder host (see "Part 2 in production").

## What it does
- **No Supabase.** `lib/platform/pg-client.ts` is a knex-backed drop-in for the Supabase
  query builder (the 23 methods ycode uses, embedded `!inner` selects, `.or()` DSL,
  JSON-path filters, count/head, upsert, the 4 RPCs). `lib/supabase-server.ts` returns it.
- **Business OS session.** `lib/platform/session.ts` verifies an HS256 session cookie
  (`bos_session`) carrying user, organization and Web Studio permission flags
  (`webstudio.manage_sites / manage_content / manage_forms / manage_orders / manage_reports`).
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
  (`{name: {ar, en}, description: {ar, en}}`). `GET /ycode/api/platform/templates` lists them, each with its
  `page_count` and `languages` since the part 2 release fixes (below),
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
  (`scripts/seed-templates.ts`) creates the three templates of part 1 and part 2's online store with fixed ids
  (`lib/platform/templates.ts`, `SEEDED_TEMPLATES`) or refreshes their names and
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
    DOCUMENT_CENTER_URL=http://document-center-service:6016   # document-center mode, and the store's item images in either mode (W2)
    DOCUMENT_CENTER_API_KEY=<Document Center's SERVICE_API_KEY>
    WS_SITES_DOMAIN=sites.torchcorp.com   # default addresses are {slug}.{this}; required, never guessed
    DOMAIN_SERVICE_URL=http://domain-service:6012   # with DOMAIN_SERVICE_API_KEY: the organization's verified domains
    DOMAIN_SERVICE_API_KEY=<domain-service's SERVICE_API_KEY>   # (session 7); see WS_DOMAIN_CHECK below
    WS_DOMAIN_CHECK=on   # `off` accepts any host name as a custom host, with no check against verified domains
    PAGE_AUTH_SECRET=<signs the password-protected page cookies; Web Studio's own>
    ALLOW_DEV_LOGIN=false   # absent in production; true only on a dev box: POST /ycode/api/auth/dev-login
    WS_TEMPLATES_ORG=<uuid>  # the Business OS organization whose sites are TORCH's templates (session 4); on the server "TORCH corp"
    ORG_SETUP_URL=http://auth-service:6001   # Organization Setup (served by auth-service): the branches (W1), the day's rate and unit names (W2)
    ORG_SETUP_API_KEY=<auth-service's SERVICE_API_KEY>   # ${AUTH_INTERNAL_SERVICE_API_KEY} in the root .env; the internal routes take the service key (and x-entity-id for the rate and units); Sales holds the same key
    PRODUCT_SERVICES_URL=http://product-services-service:6024   # Product & Services: the category tree (W1), the items, variants and images (W2)
    PRODUCT_SERVICES_API_KEY=<product-services' SERVICE_API_KEY>   # ${PS_SERVICE_API_KEY} in the root .env; with x-entity-id = the organization
    CONTACT_CENTER_URL=http://contact-center-service:6017   # the checkout's buyer: find or create a person by phone (W3)
    CONTACT_CENTER_API_KEY=<contact-center's SERVICE_API_KEY>   # ${CC_SERVICE_API_KEY} in the root .env; with x-entity-id
    SALES_URL=http://sales-service:6029   # the checkout's order: the service create and the order read (W3)
    SALES_API_KEY=<sales-service's SERVICE_API_KEY>   # ${SALES_SERVICE_API_KEY} in the root .env; with x-entity-id
    SALES_APP_ID=<Sales's catalogue app id>   # ${SALES_APP_ID} in the root .env; the Orders API's deep link into Sales (W8): torch://app/<this>/orders/<id>; unset: open_in_sales is null
    CONTACT_CENTER_APP_ID=<Contact Center's catalogue app id>   # the same value contact-center-service has in the compose; a submission's deep link into Contact Center (part 3, W4): torch://app/<this>/prospects/<id> or .../contacts/persons/<id>; unset: links.open_in_contact_center is null
    WS_VISIT_SALT=<a long random secret of Web Studio's own>   # the salt of the visitor key (part 3, W7; the events and totals of W8 use it too); at least 16 characters; unset: no view or event is counted, and the log says so once
    WS_FORM_RETRY_TICK_SECONDS=30   # optional (part 3, W3): how often the waiting form links are looked at; 30 when unset. Not the delay between a submission's attempts
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

## Store settings (part 2, session W1)
- **API.** `GET` and `PATCH /ycode/api/platform/sites/{id}/store` (`manage_sites` r / u, the same session and
  organization checks as the settings route), in `app/(builder)/ycode/api/platform/sites/[id]/store/route.ts`; the logic is
  `lib/platform/store-settings.ts`, the body and its rules `store-settings-input.ts`. The route's own comment lists the
  fields and the statuses. Store settings are not page content: they apply to the published site at once, with no publish.
- **Where they live.** `platform_site_store` (migration `20261108000001_torch_site_store.ts`), one row per site made on the
  site's first read: `selling`, `currency` (IQD or USD), `branch_id` (Organization Setup's), `category_ids` (Product &
  Services'), `delivery_fee` numeric(14,2), `updated_at`, `updated_by`. The table refuses selling without a branch. Names,
  the branches to choose from and the category tree are read live on every `GET`; nothing of theirs is stored.
- **Checkouts.** `platform_storefront_orders` (same migration): per checkout that became a Sales order, the site, the
  checkout id, the Sales order's id and code, the time; unique per site and checkout. Written by session W3. No buyer or
  item data.
- **Not copied by a template**: neither table is in `COPIED_TABLES`; a copy starts with the defaults, and a template's
  store cannot be changed (403): a template never sells.
- **Services.** `lib/platform/org-setup.ts`: `POST /api/internal/branches/` (the organization's active branches, every
  type, warehouses included) and `/by-ids` (an archived branch's name) on auth-service, with the service key alone, as
  Sales and queue-service call them; the user-facing `/org-setup/branches` needs Organization Setup access a Web Studio
  user may lack. Checked on production on 8 Nov 2026, read only: 200 with the key, 401 without.
  `lib/platform/product-services.ts`: `GET /categories/tree` and `GET /categories/{id}` with the service key and
  `x-entity-id`. Product & Services counts the items of a category itself, every status; items sit on leaf categories.
- **Rules** (owner, 8 Nov 2026). A chosen category covers every category under it, and its count is summed up the tree.
  Selling needs a branch (422 `branch_required`); a currency change needs the fee in the same request (422
  `fee_required`). A change is checked only for what it changes: a new branch must be an active branch of the
  organization and the stored one is checked again when selling is switched on (422 `branch_unavailable`); new categories
  must be live ones of the organization (422 `categories_unavailable`). A branch or category archived or deleted since it
  was chosen stays stored and is shown with `available: false`. A service that cannot be asked leaves `branches` or
  `category_tree` null with the reason in `branches_error` / `category_tree_error` and `available: null` on the chosen
  values; a change that needs its check answers 503 (`org_setup_unavailable`, `product_services_unavailable`).
- **The published site** reads a site's store through `storeOf(siteId)`, kept 30 s per site and forgotten when a change is
  saved (another process keeps it for at most 30 s). Sessions W2 and W3 use it.
- **Test.** `e2e/store-settings.spec.ts`. `e2e/platform-stub.ts` (port `E2E_PORT + 3`, data in `e2e/platform-fixtures.ts`)
  stands in for Organization Setup and Product & Services, and `POST /__down` makes them answer 503; W2 and W3 add their
  routes to it.

## Catalogue and the store API (part 2, session W2)
- **Routes.** Anonymous `GET`s on a published site's own host: `/ycode/api/store/products` (`category`, `q`, `page`,
  `page_size` 1 to 48, default 12), `/ycode/api/store/products/{id}`, `/ycode/api/store/categories`,
  `/ycode/api/store/settings` (`selling`, `currency`, `delivery_fee`), in the proxy's map under `manage_orders` with an
  anonymous `GET`; and `/store-media/{documentId}?item={productId}` (`app/store-media/[documentId]/route.ts`), the item
  images. Each route file's comment gives its shape and statuses. The site comes from the host alone
  (`lib/platform/store-api.ts`): `resolveSiteId` would read the builder's `ws_site` cookie first and serve a store on the
  builder host, which must answer 404. A store that does not sell answers 404 (`store_not_found`) on every store route, the
  images included. A service that cannot be asked answers 503 with `product_services_unavailable`,
  `org_setup_unavailable` or `document_center_unavailable`.
- **Eligibility** (`lib/platform/catalogue-rules.ts`, the file's header is the rule): ACTIVE, the item's own ECOMMERCE
  channel on (`GET /items?channel=ecommerce&status=ACTIVE`), never a child row, in the site's categories or under them
  (none chosen: every item), and a price that is not 0 or null. A product with variants is the parent; each child is an
  option, `available: false` with `inactive`, `no_price` or `no_rate` when it cannot be bought; the card shows the lowest
  available price as `from`; a parent none of whose variants can be bought is not on sale (404). A variant without an image
  shows the product's.
- **Money** (`lib/platform/store-money.ts`). Exact decimals, never floats. One rate both ways, Organization Setup's USD→IQD
  spot rate of the day in Baghdad (`/api/internal/org-setup/exchange-rates/as-of`, service key and `x-entity-id`; it has no
  IQD→USD rate on production and never inverts): USD × rate is IQD, IQD ÷ rate is USD, rounded half up to the currency's
  precision (IQD whole, USD two decimals), Sales's rule P22. No rate for the day, or a currency other than the two, makes
  the item or variant unavailable, never an error. Sales's service create (SL2) must charge by the same rule.
- **Units.** `POST /api/internal/org-setup/uoms/lookup` with the service key, as Sales names a line's unit.
- **Cache.** A site's whole catalogue is read at once (every page of items, each parent's variants workspace, the units, the
  rate when needed), because the eligibility cannot be asked of Product & Services and a grid page is cut after it. Kept
  60 s per site, one read at a time (`lib/platform/catalogue.ts`, `catalogue-cache.ts`), forgotten when the store settings
  change; a failed read is not kept. A product's images (`GET /items/{id}/documents`, `product_image`) are read the first
  time its page or image asks, with the catalogue they belong to.
- **Images** (`lib/platform/store-media.ts`). An image is served only when it is the product's, a variant's or one of the
  product's own, for a product the site sells now; no other document of the organization comes through a site. The bytes
  are fetched once from Document Center (`GET /documents/{id}/download`, `DOCUMENT_CENTER_API_KEY` and the organization;
  every download is logged there) and kept on disk in either storage mode, as the font mirror is:
  `PLATFORM_STORAGE_DIR/_store-media/{organization}/{document}/{sha256}` with `current.json`. Once a day at most the copy is
  checked against the document's current version (`GET /documents/{id}`, `currentVersion.fileHash`, which Document Center
  records as "viewed") and fetched again when it changed; while Document Center cannot be asked the copy is served and the
  check retried after ten minutes. Raster types only (JPEG, PNG, WebP, GIF, AVIF); a document of another type (Product &
  Services can be set to take SVG) is refused, answered 404, and not downloaded again until a day later. Served with
  `cache-control: public, max-age=86400`, the sha256 as ETag, `nosniff`.
- **Test.** `e2e/catalogue.spec.ts`. The platform stub answers the items, the workspace, the documents, the rate (`POST
  /__rate { found }`) and the units; the fake Document Center holds the item images from `e2e/platform-fixtures.ts` and
  counts downloads (`GET /__hits?document=`).

## Checkout (part 2, session W3)
- **Routes.** `POST /ycode/api/store/checkout` and `GET /ycode/api/store/orders/{checkout_id}`, anonymous on a selling site's
  own host only (`sellingSite`, as W2's routes; the builder host and a store that does not sell answer 404
  `store_not_found`), in the proxy's map under `manage_orders` with an anonymous `POST` and `GET`. Each route file's comment
  gives the body, the answers and their codes. The flow is `lib/platform/checkout.ts`; the body and its field rules
  `checkout-input.ts`; the line checks, Sales's refusals and the confirmation's shape `checkout-rules.ts`; the cities
  `iraq-governorates.ts` (19, Halabja included: OPEN_QUESTIONS 27).
- **One order per checkout.** The page makes `checkout_id` once per cart and keeps it until success. A checkout already in
  `platform_storefront_orders` is answered from it, with no call. Otherwise: the lines are checked against the site's
  catalogue (W2's, up to 60 s old: `item_unavailable` names each line, `inactive`, `no_price`, `no_rate`, `parent` or
  `not_on_sale`); a USD store asks the day's rate first (none: 503, OPEN_QUESTIONS 30); Contact Center finds or creates the
  person by the canonical phone; Sales creates the draft order; its id and code are stored. Two requests with one checkout
  in this process share one flight; across processes Sales's idempotency per checkout id and the table's unique (site,
  checkout) keep it one order. A failure stores nothing; a person made before Sales failed stays and the retry finds it.
- **What goes where.** Contact Center gets the name and the phone in its canonical form (`964` and the ten national digits).
  Sales gets `source: storefront`, the site as `sourceReference`, the checkout id, the person as the customer, the store's
  branch, currency and fee, the lines (item id and quantity, never a price), `cash_on_delivery`, the address with the city
  in the buyer's language and the phone as typed, and the notes. Web Studio stores the order's id and code only; nothing of
  the buyer is stored or logged here. The confirmation read asks Sales (`GET /internal/orders/{id}`) each time.
- **Phone.** Iraqi mobiles only (OPEN_QUESTIONS 33): ten digits starting with 7 after `0`, `964`, `+964` or `00964`, with
  spaces, dots, dashes or brackets, ASCII or Arabic-Indic digits; at most 32 characters as typed (Sales keeps that much).
- **Sales's refusals.** An item code (`item_not_found`, `item_inactive`, `item_is_parent`, `item_no_price`,
  `item_currency_mismatch`) or `no_rate_for_date` with `items` naming lines of the cart is `item_unavailable` for those
  lines, and the site's catalogue is read again; any other refusal (customer, branch, the order's own rate) answers 503 and
  is logged as the store's problem. A 400 from Sales is a contract mismatch (500, logged).
- **Screening** is the form route's `screenFormSubmission` (same origin, size caps, honeypot, rate limit with the site's
  Security settings), given a counter of its own (`lib/platform/checkout-limit.ts`, the one seam added to ycode's
  `lib/form-spam-protection.ts`): per site and IP, the checkouts that reached Contact Center in the window, kept in memory
  (OPEN_QUESTIONS 28). Each checkout counts once: the same checkout id with the same phone, tried again after Sales failed
  or refused an item, is not counted again (W3 review fix). A filled honeypot answers 201 with `code: null`, calls nothing
  and stores nothing (OPEN_QUESTIONS 31).
- **Before production:** Contact Center's find-or-create is live (C1, 8 Nov 2026); Sales's service create (SL2) and SL1's
  order fields must be deployed first, with `deliveryAddress.phone` and the `items` of a 422 (the session plan, amended
  8 Nov 2026). They were released on 8 Nov 2026 (18:42 UTC) and session D1's server e2e placed real orders through them.
- **Test.** `e2e/checkout.spec.ts`. The platform stub answers Contact Center and Sales (`e2e/order-services-stub.ts`),
  records every call (`GET /__calls?service=`), and can refuse the next order (`POST /__sales/refuse`) or slow every create
  (`POST /__sales/delay`). Next fills a missing `x-forwarded-for` with the socket's address, so a request that sends neither
  `x-real-ip` nor `x-forwarded-for` counts as 127.0.0.1: the spec raises its site's limit, and the tests of the limit send
  their own addresses, as nginx would (`x-real-ip`, and `x-forwarded-for` with the visitor's own entry first).

## Store elements (part 2, session W4)
The Store category of the element library: **Product grid**, **Product card** and **Cart indicator**, and two ready sections,
**Products grid** and **Featured products**, under a Store category of the Layouts tab. The cart, the product page and
the checkout are W5 and W6. Platform code is `lib/platform/store-elements/`; the ycode files only name the elements
(the seven places the research lists for `htmlEmbed`: `lib/templates/blocks.ts` with `lib/templates/store.ts`,
`ElementLibrary.tsx`, `lib/layer-utils.ts` (tag, leaf, no collection, no link), `lib/layer-style-groups.ts`,
`LayerRenderer.tsx`, `LayerRendererPublic.tsx`, `lib/page-fetcher.ts` `layerToHtml`, `RightSidebar.tsx`) and `types/index.ts`
(`LayerSettings.store`).
- **Three render paths.** The canvas draws sample data (the handoff's eight products, three categories, a cart of 4) and
  never calls the store API or asks for an image; the published page (`PublishedStoreElement`) is a client component that
  fetches `/ycode/api/store/products` (W2) with the element's settings and the page's `?category=` and `?q=`; the HTML
  string (`layerToHtml`: static export, filter and load-more HTML) is the wrapper with the skeleton (`html.ts`), because
  the data is live and there is no script to fetch it. The server render and the first browser render of the grid are
  the skeleton, so the cached page and the hydrated one agree; the URL is read and the first page asked for in the
  browser. The grid writes the chosen category (when it honours the URL) and `q` back with `history.replaceState`.
- **Settings** (`layer.settings.store`, read by `settings.ts`, which always returns a complete valid value):
  `productGrid`: `categories` (ids, empty lists everything the store sells), `pageSize` (12 default, 1 to 48),
  `showSearch`, `showCategoryFilter` (both on), `honourUrlCategory` (on); `productCard`: `product` `{ id, name, name_ar }`
  (the names are for the canvas label only). The panels are `ProductGridSettings.tsx` and `ProductCardSettings.tsx`, in
  the builder's own controls (decision 4). They read the open site's catalogue from two builder routes,
  `GET /ycode/api/platform/store-elements/categories` and `.../products?q=&page=` (`manage_content` `r`; they work before
  the store sells, since a site is built first).
- **Several categories.** The W2 products route also takes `categories={id},{id}` (up to 24; any of them and under them;
  not together with `category`), which is what a grid that lists chosen categories sends.
- **Store off.** A store that does not sell answers 404 `store_not_found` on the store routes and the elements render
  nothing (grid, card and indicator; the indicator asks `/ycode/api/store/settings`). A catalogue that cannot be read
  (503, or any other failure) shows the failure state with "Try again"; "Load more" adds the next page of the page size.
- **Cart seam** (`cart-store.ts`). The grid's "Add to cart" (a card without variants) and the indicator's count go
  through `CartStore`, kept on `globalThis.__wsCartStore` and set by `connectCartStore()`. Session W5 writes the real
  cart and connects it (below); with none connected the count is 0 and a change throws `CartStoreNotConnectedError`
  (loud, not silent).
- **Links** (`links.ts`): session W5 replaced W4's fixed paths with the lookup of "the page with role X" (below).
- **Colours.** The elements read `--ws-store-primary`, `--ws-store-primary-soft` and `--ws-store-dark`
  (`colours.ts`): the site's ycode colour variables named **Primary**, **Primary soft** and **Dark** (the plain names,
  case and spacing ignored, the first of a name used twice), set on the element's wrapper as `var(--{id})`. A site without
  one gets the design system's value (`#0F766E`, `#E7F3F1`, `#17201E`). Task B's templates must create variables by
  those names. The sections' own layers (headings, "View all") use the design system's values as plain classes.
- **Font.** IBM Plex Sans Arabic from the platform's mirror: the elements link `/ycode/api/store/font`, an anonymous
  route that serves the mirrored stylesheet for that one family with its files pointed at
  `/ycode/api/store/font/files/ibmplexsansarabic/...`. The mirror's own routes stay for the signed-in builder; any other
  family is a 404 on the anonymous file route. The first request fetches the family from Google into the mirror on the
  server (as the builder's fonts are); no visitor's browser reaches Google.
- **Language and direction.** The page's locale: Arabic locales read Arabic, right to left; any other reads English
  (`strings.ts`). Names come from `name_ar` on an Arabic page when the item has one. Prices are `25,000 IQD` / `25,000 د.ع`
  (`$` for USD in Arabic), Western digits.
- **Motion.** The skeleton pulses in opacity and the cart badge settles once on a change (160 ms, from 85 %, never
  from 0); both are off under `prefers-reduced-motion: reduce`, and colour changes on hover run only with hover and no
  reduced-motion request.
- **Test.** `e2e/store-elements.spec.ts` (the platform stub's catalogue organization gains an empty category, Toys) and the
  unit tests beside the modules (`lib/platform/store-elements/*.test.ts`).

## Orders API (part 2, session W8)
- **Routes** (all in the proxy's map under `webstudio.manage_orders`; each route file's comment gives the answer's shape):
  `GET /ycode/api/platform/orders` (r; `site_id`, `status`, `q`, `cursor`, `limit`), `GET .../orders/waiting-count` (r),
  `GET .../orders/{id}` (r), `POST .../orders/{id}/confirm` and `POST .../orders/{id}/cancel { reason }` (x). They sit under
  `platform/`, so they need a session and no open site. The logic is `lib/platform/orders.ts`, the shapes
  `orders-view.ts`, Sales' calls `sales.ts`, the buyers `contact-center.ts`, Sales' refusals `orders-errors.ts`.
- **Where a row comes from.** Sales `GET /internal/orders?source=storefront` (paged by Sales' cursor, `status` and
  `sourceReference` = the site id as filters; its `total` counts the rows matching them across all pages), then
  `platform_storefront_orders` joined with `platform_sites` for the site and its name and the checkout id (an order with no
  record is placed by its `sourceReference`; a deleted site's orders stay, with its name), then Contact Center
  `POST /api/v1/directory/lookup-ids` for the buyer's name and phone, in chunks of 100. `q` (the order's code or the buyer's
  name) is matched on the page just fetched, so a page can have fewer rows than `limit` and still have a `next_cursor`.
  Web Studio keeps no buyer or order data. Contact Center out of reach: the rows come back with no buyer name or phone and
  `buyer_error: 'contact_center_unavailable'`; Sales out of reach: 503 `sales_unavailable`.
- **Waiting count** is the `total` of Sales' list for `status=draft` with `limit=1`: one call, exact.
- **Detail.** Sales `GET /internal/orders/{id}` plus the buyer and the site: the lines with their axes, the address (the phone
  as typed), the fee, the payment method, the notes, and the status history with its actors. **The history is whatever
  Sales sends**: the service read built in SL1 carries none (the user-token read does), so it is `[]` until Sales adds
  `history` (`fromStatus`, `toStatus`, `reason`, `changedBy { id, kind, name }`, `changedAt`) to `OrderObjectDetailSchema`
  (OPEN_QUESTIONS 38 and 39; still the case on production after SL1 to SL3 went live on 8 Nov 2026, D1). `links.open_in_sales` is `torch://app/<SALES_APP_ID>/orders/<id>`, the target Sales' own notification
  uses; `links.open_in_web_studio` is the same with `WS_APP_ID`; each is null when its variable is unset (logged once).
- **Confirm and cancel** call Sales' service status route (`POST /internal/orders/{id}/status`, SL3) with the session's user as
  `actingUserId`; nothing else identifies the user (the session holds no access token). Sales checks that user's own x flag on
  `sales.manage_orders`, names them in the history and publishes the event. Web Studio does not repeat the check from the
  sign-in snapshot: Sales' `403 permission_missing` is `403 { code: 'sales_permission_missing', required: 'sales.manage_orders.x' }`
  (Web Studio's own flag is the proxy's `403 { required: 'webstudio.manage_orders.x' }`); a rule of the order keeps Sales'
  status and code (`422 invalid_transition`, `409 order_invoiced`); no such order is 404. The answer is `{ data: { id, status } }`:
  the app reads the order again for its history. Delivered and finished are Sales-only.
- **The Sales flag for the read-only view.** The sign-in callback also reads `GET /authz/my-permissions?namespace=sales` with
  the user's token (with the two reads it already makes; the same auth-service, so it fails with them) and keeps x on
  `sales.manage_orders` in the session cookie as `sales_manage_orders_x`; `GET /ycode/api/auth/session` returns it (null with
  no session; false for a cookie from before). The app shows confirm and cancel only when it and `webstudio.manage_orders` x
  are both true; the server checks anyway.
- **Scope defaults.** `permission-scope.json` gives Member and Viewer r on `manage_orders` (Manager unchanged). The scope is
  published again at every start, but a profile that already exists is not rewritten: the test organizations' Member and
  Viewer profiles get the flag by hand in Organization Setup.
- **Before production:** Sales' service status route (SL3) deployed, and SL1's order fields; the environment above gains
  `SALES_APP_ID`. The e2e stands in for the status route as the session plan defines it. (All of it live on 8 Nov 2026,
  checked by session D1's server e2e against the real Sales.)
- **Test.** `e2e/orders-api.spec.ts`. The platform stub (`e2e/order-services-stub.ts`) answers Sales' list and status route
  (the acting user's flag is read from `e2e/auth-fixtures.ts`, the people the auth stub answers for) and Contact Center's
  `lookup-ids`.

## Product page and the cart (part 2, session W5)
The **Product page** element (`productDetail`, a leaf like W4's), a page **store role**, the buyer's **cart** in the browser
and the links between them. Platform code is `lib/platform/store-elements/`; the ycode files only name the element (the
same places as W4's), add the role to the page settings panel (`PageSettingsPanel.tsx` with `PageStoreRole.tsx`) and
resolve the product page in `fetchPageByPath`.
- **The role.** `PageSettings.store = { kind: 'product' }`, set in the page settings panel ("Store page"). Only an ordinary
  page can have one (not a collection page, an index page or an error page), and a site has one page for each role (the
  panel refuses a second). W6 adds `cart`, `checkout` and `confirmation` (`PANEL_PAGE_KINDS` in `pages.ts`); the lookup is
  already written for all four.
- **The address.** The page answers at its own path and one more segment, the item's id: `/products/{itemId}` for a page
  with the slug `products` (the slug is not reserved; the role is what matters), under a language's code and with
  translated slugs in another language. `fetchPageByPath` resolves it after the exact match and the collection pages
  (`matchProductPage`), reads the item from the catalogue (W2's `getProduct`, through `readProductPage`) and injects it as
  `PageData.storeProduct` (`found`, `gone`, or `unknown` when the catalogue cannot be asked). A store that does not sell
  answers the site's own not-found page. The page's own address, with no item, is `gone`.
- **404 with the page.** An item that is not on sale (unknown, inactive, no price, no rate, outside the site's
  categories, a variant's own id, not an id) answers 404, and the 404 boundary renders the product page itself with the
  element in its "This product is no longer available" state (`app/(site)/not-found.tsx`), through the same cached
  entry the page route read. The same for the pagination route.
- **Cached per item for 60 seconds** (owner, W5 grill-me): the data-cache entry of a product page request (its path, or
  its path and an item) lives 60 s with the tenant's tags instead of until a publish (`pageRevalidate` in
  `lib/published-page-cache.ts`), and the response is rendered live (`connection()`) rather than kept as a static page,
  so a product put on sale, repriced or gone shows within a minute and a 404 does not stick. Whether a request is for the
  product page comes from the `store_pages` setting, read through a cached lookup.
- **Pages with roles, once per publish.** The publish writes the setting `store_pages` (role → path per language,
  `{ product: { '*': '/products', ar: '/ar/products' } }`: `publishStorePages` in `product-page.ts`, called by the publish
  route and the MCP publish tool). A publish that changes it renders every page again (a full invalidation, as a colour
  variable change does), because every page with a store element carries the paths. `PageRenderer` hands the elements
  `serverSettings.store = { site_id, pages, product? }`; the links are `createStoreLinks` in `links.ts`: a card to the
  product page's path and the item (`/product/{id}` when no page has the role), the indicator and the "added" notice to the
  cart page (`#` until W6 offers the cart role).
- **The element.** `ProductDetail.tsx` (state: the picker, the quantity, the notice) over `ProductDetailView.tsx` (the
  markup of `browse-product-*`): gallery with thumbnails (the variant's own image, else the product's), name, SKU of the
  chosen variant, price with the unit (`/ pcs`), one row of chips per axis, a quantity stepper (1 to 999), Add to cart,
  the notice, the description. The server and the first browser render are the injected product; the element then reads
  the item again from `/ycode/api/store/products/{id}` (owner, W5 grill-me): an item that has gone shows "no longer
  available" (status stays what was served), one that changed shows as it is. Three render paths as W4: the canvas draws a
  sample T-shirt with no network call; the HTML shell is the element's skeleton (`html.ts`); the published element is
  the client component. The element may be dropped on any page with a product chosen in its settings
  (`ProductDetailSettings.tsx`), and then shows nothing when none is chosen.
- **The picker** (`picker.ts`). The page opens on the cheapest variant that can be bought. An option is unavailable
  ("unavailable", disabled, struck through) when no variant that can be bought has it. Picking an option that goes with the
  other axes' choice changes that axis only; picking one that does not moves the others to the nearest variant that has
  it. A variant that cannot be bought cannot be picked.
- **The cart** (`cart-store.ts`). `localStorage["ws-cart:{siteId}"] = { version: 1, lines }`, a line being
  `{ item_id (the variant's id when picked), product_id, quantity, snapshot: { name, name_ar, axes, price, image, unit } }`.
  `add` merges the same item, `setQuantity` (1 to 999), `remove`, `clear`, `count`, `totals` (exact decimals; a cart
  holding two currencies says so), `subscribe`; at most 50 different items (a checkout takes 50: the fifty-first is
  refused with `CartFullError`, which the card and the page tell the buyer); other tabs of the site are followed through
  the `storage` event; what storage holds that is not a cart is an empty cart; a browser that will not store keeps the
  cart for the visit and says so once in the console. Every published store element connects it when it starts
  (`connectBrowserCart(siteId)`, idempotent). The snapshot is for display only: prices are read again at checkout.
- **Motion.** The "added" notice rises 4 px and fades in over 200 ms on the strong ease-out; chips and thumbnails change
  colour, border and ring over 150 ms and press in to 97 % over 100 ms; under `prefers-reduced-motion: reduce` the notice
  only fades and the chips change at once.
- **Design values I had to choose** (the handoff does not draw them): the unit is a muted `/ pcs` after the price; the
  loading and "no longer available" states use W4's skeleton and empty patterns; the cart-full message is a dark-bordered
  alert on the page and a small note on a card.
- **Test.** `e2e/product-page.spec.ts` and the unit tests beside the modules (`cart-store`, `picker`, `pages`, `links`,
  `add-to-cart`, `settings`, `strings`, `html`, `card-data`, `store-money`).


## Cart, checkout and confirmation (part 2, session W6)
Three more store elements (`cart`, `checkout`, `orderConfirmation`; leaves like W4's and W5's), the page roles `cart`,
`checkout` and `confirmation`, and the buyer's way through them. Platform code is `lib/platform/store-elements/`; the ycode
files only name the elements (the same places as W4's), add the roles to the page settings panel text and answer the
not-found page for a store that does not sell.
- **The roles.** `PANEL_PAGE_KINDS` is now all four (`product`, `cart`, `checkout`, `confirmation`); a site has one page for
  each. The cart indicator, the "added" notice and the product page lead to the cart page, the cart's Checkout button to the
  checkout page, and a placed order to the confirmation page as `?order={checkout id}` (`createStoreLinks`: `cart()`,
  `checkout()`, `confirmation(id)`; `#` until a page has the role). A site with no confirmation page shows the order
  inside the checkout element instead of sending the buyer nowhere.
- **A store that does not sell** answers the cart, checkout and confirmation pages with the site's own not-found page, as the
  product page does (PRD V1.1 "Store settings"): `fetchPageByPath` asks `storeSells`. Those pages are live requests like the
  product page's (`isStorePageRequest`, 60 s data cache, `connection()`), so the answer follows the setting within a minute.
- **The cart store** gained the checkout id and a snapshot refresh. `checkoutId()` makes a UUID (random bytes, not
  `crypto.randomUUID`, which a plain-http address does not have) the first time the checkout asks and keeps it in the
  stored cart (`{ version: 1, lines, checkout_id }`); it goes with the cart when the cart is cleared or its last line is
  removed, so one cart is one checkout whatever happens between the first try and the last. `refresh(itemId, snapshot)` replaces what a line shows and nothing else.
- **The cart element** (`Cart.tsx`, state; `CartView.tsx`, the markup of `checkout-cart-*`). Lines from the cart store:
  picture, name (a link to the product page), the variant's options, the unit price with the unit (`25,000 IQD / pcs`, or
  `each`), a quantity stepper (1 to 999, typed or stepped), the line total, Remove. The summary beside them (under them on a
  phone): subtotal, delivery fee and total from `GET /ycode/api/store/settings` (currency and fee), the exact arithmetic of
  `store-money.ts` (`order-summary.ts`). Empty: the designed empty state with Browse products. **Prices are refreshed on
  load** (`cart-refresh.ts`, `use-cart.ts`): each product in the cart is read once from `/ycode/api/store/products/{id}`;
  a line still on sale takes the catalogue's name, options, price, picture and unit (and is marked "Price updated · was …"
  when the price changed); a line the catalogue no longer sells (product gone, variant gone, no price, cannot be bought) is
  marked "Unavailable" (the handoff's tag) and Checkout is off, with the reason, until it is removed; a catalogue that cannot be read
  leaves the lines as they are and says so.
- **The checkout element** (`Checkout.tsx`, state; `CheckoutView.tsx`, the markup of `checkout-form-*`). The order summary
  (a collapsed bar on a phone that opens, a column on a desktop; both are in the page and CSS shows one), the form (name,
  phone, city as a select of `iraq-governorates.ts` in the page's language, address, landmark and notes optional), the
  cash-on-delivery note, Place order with the total. The form carries ycode's decoy field (`FormHoneypotField`) in a box of
  no size that clips it (`ws-decoy`): the field sat 9999 px to the left, which widened a right to left page by as much
  (W6 review fix; the component itself is direction-aware since session 22, and the box stays as a second guard). The rules for the fields are the route's (`checkout-input.ts`): the
  form sends what was typed with `locale` and shows the route's messages under their fields, with the designed alert listing
  the fields (each a link to its field); typing in a refused field takes its message away. On submit: one request at a
  time (a ref guard, and the button and the fields disabled with the spinner and "Placing your order…"),
  `POST /ycode/api/store/checkout` with the cart's `checkout_id`; `item_unavailable` names the items (the route's name, else
  the cart's) with a Remove that drops them, each line marked with its own Remove, Place order off until they are gone;
  `service_unavailable` (and a lost connection, and any answer that is not ours, logged) is the designed alert with Try
  again, the cart and the form kept; `rate_limited` its own alert; success clears the cart and goes to the confirmation
  page. The page refreshes the cart on load like the cart does.
- **The confirmation element** (`OrderConfirmation.tsx`, `ConfirmationView.tsx`, `checkout-confirmation-default`). Reads
  `GET /ycode/api/store/orders/{checkout_id}` for the checkout in `?order=`: the thank-you with the number the buyer typed,
  the order code, the lines with their options (Sales names a variant's line by the variant's own item, so the name reads
  "Linen shirt - Small / White" beside "Size: Small · Colour: White"), the fee, the total, the cash-on-delivery note, Back to
  shop. An address with no checkout, or one this site has no order for, is "We can't find this order"; Sales that cannot be
  asked is an alert with Try again.
- **Copy fixes (notebook decision 16g).** The phone message names both forms ("0770 123 4567 or +964 770 123 4567"; the
  route's, W3, now shown); nothing says "out of stock" (the handoff's sentence is "… is no longer available"); the unit is
  on the cart, checkout and confirmation lines. Strings are `STORE_STRINGS` in both languages (`strings.ts`); a test fails
  if a word about stock comes back.
- **Three render paths as W4.** The canvas draws the handoff's sample cart (three lines, 115,000 IQD) and order
  (`SO-2026-0142`) with no network call; the HTML shell (`html.ts`) is each element's skeleton; the published elements are
  the client components. The Store category of the library gains Cart, Checkout and Order confirmation, and the Layouts tab
  the sections Cart page, Checkout page and Order confirmation (one element in a band each, as the Product page section is).
- **Motion.** The Place order spinner turns (0.8 s linear) and the summary chevron turns (150 ms), the alerts and the
  confirmation rise 4 px and fade in over 200 ms on the strong ease-out, Place order presses in to 97 % over 100 ms. Under
  `prefers-reduced-motion: reduce` the spinner stops (a ring, with the words beside it), the chevron turns at once, and the
  alerts and the confirmation only fade.
- **Test.** `e2e/checkout-flow.spec.ts` (the flow and the error paths on a published site, Arabic, a phone, motion, a store
  that does not sell, the canvas, the library, the static export) and the unit tests beside the modules (`cart-store`,
  `cart-refresh`, `order-summary`, `checkout-form`, `store-client`, `format`, `strings`, `links`, `pages`, `html`). The
  platform stub gained `POST /__item { id, status?, base_price? }` and `POST /__items/reset`.


## Part 2 in production (session D1, 8 Nov 2026)
Part 2 (the store) runs in the same container as part 1. What it added, in one place; the sessions above give each piece's rules.

- **Keys.** Nine, in the compose service `web-studio` on the server (`/root/core-backend/docker-compose.yml`, which is not in
  this repository), the keys taken from the root `.env` variable the receiving service reads as its own `SERVICE_API_KEY`
  (as `DOMAIN_SERVICE_API_KEY` was, part 1 OPEN_QUESTIONS 14). Names only; never a value in a repository file:

  | Key | Set to | Root `.env` variable | Used by |
  |---|---|---|---|
  | `ORG_SETUP_URL`, `ORG_SETUP_API_KEY` | `http://auth-service:6001` | `AUTH_INTERNAL_SERVICE_API_KEY` | branches (W1), the day's rate and unit names (W2) |
  | `PRODUCT_SERVICES_URL`, `PRODUCT_SERVICES_API_KEY` | `http://product-services-service:6024` | `PS_SERVICE_API_KEY` | category tree (W1), items, variants, images (W2) |
  | `CONTACT_CENTER_URL`, `CONTACT_CENTER_API_KEY` | `http://contact-center-service:6017` | `CC_SERVICE_API_KEY` | the checkout's buyer (W3), the orders' buyers (W8) |
  | `SALES_URL`, `SALES_API_KEY` | `http://sales-service:6029` | `SALES_SERVICE_API_KEY` | the checkout's order (W3), the Orders API (W8) |
  | `SALES_APP_ID` | the Sales catalogue id | `SALES_APP_ID` | the Orders API's deep link into Sales (W8) |

  Every call carries `x-service-api-key` and the organization in `x-entity-id`. A key that is missing makes that service
  "unavailable" (503 `*_unavailable`), never a guess. Each key was proven by a real call in the server e2e.
- **Tables.** One migration, `20261108000001_torch_site_store.ts`, run at start (knex: "Batch 2 run: 1 migrations"):
  `platform_site_store` (one row per site, made on its first read: `selling`, `currency` IQD or USD, `branch_id`,
  `category_ids`, `delivery_fee`; the database refuses selling without a branch, a fee below 0, another currency) and
  `platform_storefront_orders` (per checkout that became a Sales order: site, checkout id, Sales order id and code, the time;
  unique per site and checkout). Neither is a tenant table, a template copy does not copy them, and neither holds a buyer or an item.
- **Routes.** On the builder host, with a session, under `platform/`: `GET` and `PATCH sites/{id}/store` (`manage_sites` r / u),
  `GET orders`, `GET orders/waiting-count`, `GET orders/{id}` (`manage_orders` r), `POST orders/{id}/confirm` and
  `POST orders/{id}/cancel` (x), and the element settings' `store-elements/products` and `store-elements/categories`.
  On a selling site's own host, anonymous: `GET /ycode/api/store/{settings,products,products/{id},categories}`, `GET
  /store-media/{documentId}?item=`, `GET /ycode/api/store/font` (the IBM Plex Sans Arabic stylesheet from the platform's font
  mirror, and its files), `POST /ycode/api/store/checkout`, `GET /ycode/api/store/orders/{checkout_id}`. All of them answer 404
  `store_not_found` on the builder host and for a store that does not sell.
- **The checkout, end to end.** The page makes a `checkout_id` once per cart and posts it with the buyer and the lines (item
  ids and quantities, never prices) to its own host; the route screens it (same origin, size, honeypot, a rate limit per site
  and IP); the lines are checked against the site's catalogue (at most 60 s old); a USD store asks for the day's rate; Contact
  Center finds or creates the person by the phone in its canonical form (`964` and ten digits); Sales `POST /internal/orders`
  makes the draft order (source `storefront`, the site as `sourceReference`, cash on delivery, the prices and the fee by Sales,
  idempotent per checkout id); Web Studio stores the order's id and code and answers `{ checkout_id, code }`; the confirmation
  page reads the order from Sales each time. Afterwards the app confirms or cancels through `POST /internal/orders/{id}/status`
  with the signed-in user as `actingUserId` (Sales checks that user's own `sales.manage_orders` x). Nothing of the buyer is
  stored here.
- **The image cache.** A product's image is fetched once from Document Center (`GET /documents/{id}/download`, the service
  key and the organization) and kept on the `web_studio_storage` volume at `PLATFORM_STORAGE_DIR/_store-media/{organization}/
  {document}/{sha256}` with a `current.json`, in either storage mode; it is checked against the document's current version at
  most once a day, and a failure to ask serves the copy. Served by the site as `/store-media/{documentId}?item={productId}`,
  `cache-control: public, max-age=86400`, ETag the sha256, raster types only, and only the product's, a variant's or one of the
  product's own images for a product the site sells. Proven on production: the bytes come back identical, with the same ETag
  on the second read. The volume survives a container recreation; deleting `_store-media` only makes the next read fetch again.
- **How it was deployed (8 Nov 2026), and how to roll back.**
  1. *Preconditions, read only:* Sales's live `/documentation/json` lists `POST /internal/orders` and
     `POST /internal/orders/{id}/status` (SL1 to SL3 released 18:42 UTC); Product & Services and Contact Center were on their
     8 Nov images (P1, C1).
  2. *Backup:* `docker exec web-studio-db pg_dump -U postgres --no-owner webstudio | gzip > /root/backups/webstudio-20261108-pre-part2.sql.gz`
     (36 tables, 52 migrations, 18 sites; checked with `gunzip -t`).
  3. *Rollback tag:* `docker tag web-studio:local web-studio:7ee115f-20261108`: part 1's image, built from `main` 7ee115f (a
     checksum comparison of `/root/web-studio` with that tree showed only generated files differing).
  4. *Migration rehearsal:* `pg_dump --schema-only` of the production database plus the `migrations` data restored into a scratch
     database, `knex migrate:latest` run as the entrypoint does (52 to 53 migrations, both tables and their constraints), then dropped.
  5. *Compose:* a copy kept as `docker-compose.yml.bak-20261108-part2`; the nine keys inserted after `WS_TEMPLATES_ORG`;
     `docker compose config --quiet` valid.
  6. *Sync and rebuild:* an `rsync -azcn --delete` by checksum listed exactly the files of `git diff origin/main..HEAD` (137
     added, 42 modified, 5 deleted) and nothing else; then the real `rsync`, `docker compose build web-studio` (about two and a
     half minutes) and `docker compose up -d --no-deps web-studio`. Healthy at once, 0 restarts, the permission scope registered
     again for the one installed organization.
  7. *Check:* `pnpm e2e:server`, 38 tests, all pass (the section "Server e2e").
  *Roll back* with `docker tag web-studio:7ee115f-20261108 web-studio:local && cd /root/core-backend && docker compose up -d
  --no-deps web-studio`. Part 1's code ignores the two new tables and the nine keys, so neither the migration nor the compose
  lines need undoing. A restore of the dump is only for damaged data and was not rehearsed. The compose and the rollback tag
  are on the server only. The `Found orphan containers (vault-service ...)` line `docker compose` prints is another service's
  leftover; it was not pruned.
- **Found while checking, not fixed here (outside D1's goal; each has an owner in OPEN_QUESTIONS).**
  *The builder's page contacts one public host.* `web-studio.torchcorp.com` is proxied by Cloudflare, whose edge adds its Web
  Analytics beacon (`https://static.cloudflareinsights.com/beacon.min.js`, `data-cf-beacon`) to every HTML answer: the same route
  read from the origin (`127.0.0.1:6030`) has no such script, and the app and `docker/nginx` never name it. The published store
  pages are not affected (`sites.torchcorp.com` is DNS only). `storefront-browser.spec.ts` records it as a known exception and
  fails on any other host; turning it off is Cloudflare's Web Analytics setting or a `Cache-Control: no-transform` answer
  (OPEN_QUESTIONS 53). *Checked again on 9 Nov 2026 (session 22):* the owner's answer was to turn Web Analytics off for the zone;
  a real browser on production still requested the beacon (`GET /ycode` with a browser User-Agent still carries the
  `data-cf-beacon` script at the edge, and the origin's HTML has none), so the exception stays in the spec until it does not.
  *The order history is empty in the Orders API on production* (OPEN_QUESTIONS 38 and 39): Sales's own read has it, its service
  read does not yet. *A published page keeps Google URLs for a font a designer picks* (session 3, above): the store check ran on
  a site with the default fonts, and the store elements' own font is the mirror's. *The server e2e leaves the test organization
  with no ECOMMERCE item:* its one fixture item is switched off at the end, so Task B's templates need their own items there.
- **Not rehearsed:** the rollback itself, and a restore from the dump.

## Part 2 release fixes (session 22, 9 Nov 2026)
Seven fixes the owner decided on 9 Nov 2026 (notebook decision 17; OPEN_QUESTIONS 22, 34, 35, 37, 45, 47, 51, 52), one light
path, `fix/web-studio-part2-release-fixes`, each with a unit test and an e2e case. The ones that touch ycode's own files are
the platform seams of this section: `lib/request-utils.ts`, `components/FormHoneypotField.tsx`, `lib/generate-page-metadata.ts`,
`app/(published)/[[...slug]]/page.tsx` (`generateMetadata` only), `app/(site)/sitemap.xml/route.ts` and `lib/sitemap-utils.ts`
(one `export`).
- **Client IP (35).** `getClientIp` reads `X-Real-IP` first (nginx sets it to `$remote_addr`, which a visitor cannot choose), then
  the **last** `X-Forwarded-For` entry, never the first, which is the one the visitor wrote: nginx appends the address it saw
  (`$proxy_add_x_forwarded_for`), so a script that sent its own header used to get a fresh count on every request. Seam in
  ycode's `lib/request-utils.ts`; its three callers, the form route's and the checkout's rate limit (`screenFormSubmission`)
  and the page-password route's, all gain it. `lib/request-utils.test.ts` and an e2e case (`checkout.spec.ts`) send a different
  `X-Forwarded-For` each time behind one `X-Real-IP` and are counted as one.
- **Name parts (37).** The checkout checks the buyer's name as Contact Center's find-or-create does (`splitFullName`): the first
  word and the rest (the other words joined by single spaces) each at most 100 characters, counted in UTF-16 units as it counts
  them, so a name it would refuse is refused here, with a field error under the name in the page's language
  (`namePartTooLong`, `checkout-input.ts`) instead of a 503 the buyer cannot correct. The whole name stays 2 to 120 characters.
  Contact Center is unchanged.
- **Arabic counts (51).** `STORE_STRINGS.ar` `cartCount`, `itemCount` and `summaryCount` use the invariant singular after the
  number ("4 قطعة"), as `context/rules/rtl-and-i18n.md` asks; the handoff's "4 قطع" is right for 3 to 10 only.
- **Honeypot on a right to left page (52).** `FormHoneypotField` offsets the decoy with `inset-inline-start: -9999px` instead of
  `left`: on an Arabic page (`<html dir="rtl">`) a negative `left` is the scrollable side, and every published form made the page
  as much wider (measured 11,279 px on a 1,280 px window before). It is still absolutely positioned, 1 px and clipped, not
  `display: none`, so a bot still sees and fills it. Seam in ycode's component; `e2e/form-rtl.spec.ts` checks an Arabic and an
  English published page with a contact form, on a desktop and a phone.
- **Confirmation line names (47).** The confirmation read (`GET /ycode/api/store/orders/{checkout_id}`) returns for each line
  `product_name` and `product_name_ar` beside Sales's own `name` and `name_ar` (which stay as Sales wrote them): for a variant
  line, the product's name from the site's catalogue (the product whose variants include the line's item, that is the variant's
  `parent_item_id`; the catalogue is the one every page reads, kept 60 seconds); null for a plain item and for a variant whose
  product the catalogue no longer has. The confirmation element draws `product_name` above the options
  (`confirmationLineName`, `card-data.ts`) and Sales's name when there is none. An order with no variant line never reads the
  catalogue. When the catalogue cannot be read (Product & Services or Organization Setup down) the confirmation is still
  answered, with Sales's names, and the failure is logged as a warning: the order exists and its code must reach the buyer.
- **Templates meta (22, 34).** `GET /ycode/api/platform/templates` returns `page_count` (the template's draft pages, the error
  pages left out, as the Pages list shows them) and `languages` (locale codes, the default first) for each template, for the
  cards' "5 pages · Arabic · English" line (session 24 shows it in the app).
- **Product page SEO (45).** On a published product page (`storeProduct` found) `generateMetadata` fills what the page's own SEO
  fields leave empty, field by field and ahead of the site's defaults: the title is "{product name} · {site name}" (the
  `site_name` setting; the name alone when the site has none) and the description is the product's, its first 160 characters on
  one line, both in the page's language (Arabic when the request or the site's default is Arabic and the product has an Arabic
  text); the canonical path is the page's path with the item's id (lower case) as its last segment, per language. The pure
  parts are `store-elements/product-seo.ts`; the seam is `GenerateMetadataOptions.productSeo` and `GlobalPageSettings.siteName`
  in `generate-page-metadata.ts`. `sitemap.xml` lists one entry per product the store sells and per language, with the same
  hreflang cluster as every page, and leaves out the page with the product role (its bare address keeps answering 404): the
  rules are `store-elements/product-sitemap.ts`, the read is `lib/platform/store-sitemap.ts`, and the route calls both. A store
  that does not sell, a site with no product page and a `noindex` product page list no products; a catalogue that cannot be
  read is a 503 with `Retry-After` for a crawler to retry, not a sitemap without the products. Not changed: with a canonical URL
  set in the site settings ycode also writes hreflang links for a page from the page's own path, which for the product page is
  the bare address; the sitemap's hreflang is right, the `<link>`s of a product page's head are ycode's (found, outside the brief).
- **Cloudflare (53).** Not done: the owner's switch for the zone was not in effect on 9 Nov 2026 (see "Part 2 in production"):
  the exception stays in `e2e/server/storefront-browser.spec.ts`.
- **Tests.** `pnpm test` (unit, new cases beside each module) and `pnpm e2e` (`checkout.spec.ts`, `checkout-flow.spec.ts`,
  `templates.spec.ts`, and the new `product-seo.spec.ts` and `form-rtl.spec.ts`; each case that sets a product page's own SEO fields has a
  site of its own, because a product page's data lives 60 seconds per item address and a publish purges only the page's own route).

## What the templates need (part 2, session 25)
What Task B's templates could not draw from the Store elements as `handoff/store/` draws it (OPEN_QUESTIONS 55 to 58 of
`features/storefront-and-cart`, answered by the owner on 9 Nov 2026), and the online-store template in the seed. Platform
code is `lib/platform/store-elements/`; the ycode files only name the new element (the same places as W4's).
- **Category cards** (`categoryCards`, a leaf with no settings) and the section **Shop by category** in the Store category
  of the Layouts tab (a heading and the element in a band). `CategoryCards.tsx` reads `GET /ycode/api/store/categories` (W2:
  the site's chosen categories, or the top level of the tree when it chose none) and `CategoryCardsView.tsx` draws the cards
  of `browse-home-default`: three to a row, the first product's picture (`first_product_image`) or the placeholder tile the
  product card has, the category's name, each a link to `links.category(id)`: the products page (`/products`, the path
  "View all" uses) with `?category={id}`, which the grid reads. A category the site sells nothing in has no card
  (`category-cards.ts`); a store that does not sell, or one with no such category, renders nothing; a catalogue that cannot
  be read shows the designed error with "Try again". The picture is hidden from assistive technology, so the link is read
  by the category's name. Three render paths as W4: the canvas draws the handoff's three categories and calls nothing, the
  HTML shell is the skeleton.
- **The grid's count** (`showCount` in `layer.settings.store.productGrid`; "Show product count" in the grid's panel). Off
  unless set: a grid saved before it, the library's element and the "Products grid" section (whose board draws none) are
  unchanged; a products page turns it on. The count is of everything the grid lists (its own categories), whatever chip or
  search is on, as `browse-products-*` writes "8 products" over every state: the `meta.total` of the first unfiltered
  answer, or, when the page opens on a category or a search, one more request for one product. Its line is drawn empty
  until the count is known, so nothing under it moves. Arabic is the invariant singular, "8 منتج".
- **Featured products with nothing picked** (`featured.ts`). A product card with no product picked shows one of the
  store's first products, so the section's four cards are full on a shop new from a template. The card's wrapper carries
  `data-ws-unpicked`, or `data-ws-picked="{id}"`; the unpicked cards of a page take the first products in the grid's order
  (by name), each by its place among the unpicked ones, leaving out what the picked cards show; they share one request
  (`page_size` = unpicked + picked, 48 at most). A picked card shows its pick as before. A card with nothing to show (fewer
  products than cards, a pick no longer on sale, a store that does not sell) now takes no room: `StoreShell`'s `collapsed`
  sets `display: none` on the wrapper, where the empty wrapper used to keep its cell in the row. The canvas still draws
  the one sample card.
- **The breadcrumb.** `ProductDetailView` draws `Products › {category} › {product}` above the product
  (`browse-product-*`): `links.products()`, then `links.category(product.category.id)` (the item's own category, which
  the product read already carried; a product with none has two steps), then the name as the current page. The skeleton
  and the HTML shell keep its place.
- **The seed.** `SEEDED_TEMPLATES` is `PART_1_TEMPLATES` and `PART_2_TEMPLATES`: `online-store`, id
  `c0a8e7d6-0000-4000-8000-000000000004`, created Arabic first, with the name and description of the app's Templates
  board. `pnpm templates:seed` creates it empty, as it did part 1's three; its content is Task B's.
- **Design values I had to choose** (in the pull request's Notes): the count is a setting and off by default; a category
  with no product has no card; a category card has no hover (the handoff draws none); the breadcrumb's category is the
  item's own, which can be a sub-category that is not one of the grid's chips, and the products page then lists it with
  no chip pressed.
- **Review fix, found building the templates (9 Nov 2026): the default language.** The renderer names a page's locale
  only under a language's prefix, so on a page in the site's default language the store elements had none and read
  English, left to right: an Arabic-first site showed English store elements at its root (the e2e sites were all
  English first; session 22 had met the same gap for the product page's meta tags). `LayerRendererPublic` now hands the
  elements `pageLocaleOf(currentLocale, availableLocales)` (`links.ts`): the page's own locale, else the site's default
  one. Links are unchanged: the default locale has no prefix. Not changed: the HTML string path (`layerToHtml`, the
  static export) still has only the page's own locale, so its loading shell reads English on a default-language page.
  (Checked in part 3, session W10: this does not hold for the static export, see "Carried items" below.)
- **Test.** `e2e/shop-home.spec.ts` and the unit tests beside the modules (`featured`, `category-cards`, `settings`,
  `links`, `strings`, `html`).


## The published pages' font (part 2, session 26)
A published page loads its site's Google fonts from the platform's font mirror on the site's own host, never from
`fonts.googleapis.com` or `fonts.gstatic.com` (OPEN_QUESTIONS 60 of `features/storefront-and-cart`: Task B found the
templates' and part 1's sites preloading IBM Plex Sans Arabic from `fonts.gstatic.com`; the fork's rule and PRD V1.1
"Platform").
- **The rules.** `PageRenderer` inlines `publishedGoogleFontsCss(urls)` (`lib/platform/published-fonts.ts`) where it
  inlined ycode's `fetchGoogleFontsCss`: each font's stylesheet read through the mirror on the server
  (`getMirroredCss`: fetched from Google once, then kept in the platform storage), its files pointed at
  `/ycode/api/fonts/published/{family}/{version}/{file}`. The file it preloads for the first heading is read from those
  rules, so it is on the site's host too. The rules are cached as before, per font configuration until the next
  publish (the cache key is new, so nothing cached before is served).
- **The files.** `GET /ycode/api/fonts/published/[...path]`: anonymous (a visitor has no session; `isPublic` in the
  proxy's map), read through the mirror, `immutable`. It serves only a file that a published page's rules name: when
  the rules are made, each file they name gets an empty marker in `PLATFORM_STORAGE_DIR/_mirror/fonts/published/`
  (named by the sha256 of its mirror path), and a file with no marker is a 404. So a visitor cannot make the server
  fetch whatever Google serves: only fonts that someone who may edit a site installed on it. The mirror's own routes
  (`/ycode/api/fonts/mirror/`) stay the signed-in builder's, and the store elements keep their two routes
  (`/ycode/api/store/font`).
- **Nothing names Google any more.** `PageRenderer` writes no `preconnect` to Google's hosts and no stylesheet link to
  them, and `next.config.ts` no longer sends `Link: <https://fonts.gstatic.com>; rel=preconnect` with every public
  page (the one header of that block; a platform seam in ycode's file).
- **When the mirror cannot be asked** (Google out of reach and no copy kept): the page is served without the font's
  rules, in its fallback family, the failure is logged (`[PageRenderer] The font mirror could not give the site's
  fonts`), and nothing is cached, so the next request asks again. ycode fell back to a stylesheet link to Google;
  there is none now.
- **A site already published** gets it on its next publish, or as soon as its cached pages are made again (a deploy
  starts with an empty cache).
- **Not changed:** the static export (`lib/apps/static-export/engine.ts`) still writes Google's URLs into the files
  it exports: an exported site has no platform behind it. Uploaded custom fonts were always the site's own files.
  (Done in part 3, session W10: the export carries the font files itself, see "Carried items" below.)
- **Test.** `e2e/published-fonts.spec.ts` (a site with the font: no Google host in the HTML or the headers, the rules
  and the preload on the site's host, the route's refusals, a real browser that contacts one host),
  `lib/platform/published-fonts-url.test.ts`, and on the server `e2e/server/storefront-browser.spec.ts`, whose store
  site now carries the font, so its "only the site's own host" check covers it on production.


## The permission map for part 3 (part 3, session W1)
- **What changed** (PRD V1.0 of part 3, "Roles and permissions"; notebook decisions 18 and 20c). No screen changed, and
  Collections and Forms were still hidden behind `WS_PARTS` (session W2, the next section, shows them with no flag).
- **Collections are content.** Every `collections/...` route in `lib/platform/permissions.ts` is on `webstudio.manage_content`,
  mapped like pages: read `r` (the two lookups that use POST, `items/batch` and `items/slugs`, too), create `c` (a collection,
  a field, an item, a duplicate, the sample, an import), change `u` (PUT, the reorders, an item's status), publish `u`,
  delete `d` (`items/delete` too). A visitor's `items/filter` and `items/load-more` stay anonymous on POST. A collection
  write still waits for the site's editor lock. The public API under `v1/` keeps its own API-key credential.
- **Submissions are the forms leaf.** `form-submissions` and `form-submissions/[id]` stay on `webstudio.manage_forms`: `r`
  to list and read, `u` to change a status, `d` to delete (one, several, or a form's); the visitor's POST stays anonymous.
  Webhooks, API keys and the integrations stay on the forms leaf too, and stay hidden; their reads need `x` (they return a
  webhook's secret and a connection's settings), so the `r` a Member or Viewer now holds opens submissions and nothing else.
- **A fifth leaf, `webstudio.manage_reports`,** for Traffic, Conversions and the Dashboard's visit numbers: in
  `permission-scope.json` (module Reports), `WEB_STUDIO_LEAF.manageReports` and the session's `WebStudioLeaf`. The callback
  reads it from `GET /authz/my-permissions?namespace=webstudio` with the others (`WEB_STUDIO_LEAVES`), and
  `GET /ycode/api/auth/session` returns its flags in `permissions`. Session W9 (the Reports API, below) puts its three routes on it. No leaf was renamed
  or removed; the matrix names of two leaves follow what they now cover ("Pages, collections and publishing",
  "Form submissions").
- **Defaults.** Manager every flag on the five leaves. Member and Viewer gain `r` on `manage_forms` and `r` on
  `manage_reports`; `manage_content` (Member c r u, Viewer r), `manage_sites` and `manage_orders` are unchanged.
- **Existing profiles are not rewritten.** The scope is published again at every start, but a profile that already exists
  keeps the grants an administrator set on the leaves it already has: an existing Member or Viewer gets `r` on
  `manage_forms` by hand in Organization Setup, and an existing profile that held only `manage_forms` loses collections
  until it is given `manage_content`. A leaf that is new to the scope is merged in by auth-service
  (`mergeWithScopeDiff`): `manage_reports` reaches an existing system profile with the defaults above and a custom
  profile with every flag off, so only a custom profile needs it by hand.
- **Tests.** `permissions.test.ts` (every collections route and its flag; the Member, the Viewer and a forms-only user,
  from the scope's own defaults), `web-studio-scope.test.ts` (five leaves, the defaults), `auth-service.test.ts` (the leaf
  at sign-in), `e2e/session.spec.ts` (the same through the proxy, and the session's answer).

## Forms and Collections shown (part 3, session W2)
Forms and Collections are on the port for every site, with no flag. PRD V1.0 "Forms" and "Collections"; the app's own
screens for them are sessions W3 to W6 and A1 to A3.

- **No `WS_PARTS`.** `lib/platform/parts.ts` no longer reads the environment, `hooks/use-ws-parts.tsx` and the
  layout's provider are deleted, and the element library lists the Form element always. The header's CMS and Forms
  buttons are drawn from the user's flags, not from a role guess: CMS needs `webstudio.manage_content` `r`, Forms
  needs `webstudio.manage_forms` `r` and a role that may edit (`lib/platform/use-flag.ts`, `useHasFlag`, from the flags
  the session cookie carries). A profile that existed before part 3 holds no forms flag until an administrator sets it,
  so its designer would otherwise see a button that leads to 403s. The server answers the same 403 either way.
- **What stays hidden, whatever the user's flags** (PRD Out-of-Scope; `REMOVED_ROUTES`, `HIDDEN_ROUTES`,
  `HIDDEN_API_ROUTES` and `HIDDEN_APP_IDS` in `lib/platform/parts.ts`). `proxy.ts` answers 404 before it looks at the
  session, for the `/ycode` and the public `/studio` names alike: the webhooks screen and routes (`integrations/webhooks`,
  `api/webhooks`), the API keys screen ("Web Studio API", `integrations/api`) and routes (`api/api-keys`), and every route of
  the Airtable, MailerLite and Webflow apps and of the three placeholders (Mailchimp, Zapier, Make). The Integrations
  screen keeps Apps (Static HTML Export, Mapbox, Google Map) and MCP; `GET /ycode/api/apps` lists those three only; the
  Airtable client asks for no connection (`lib/apps/airtable/client.ts`), so the CMS does not call a 404 on every open. The
  public API under `/ycode/api/v1` is not hidden: it only answers a request that carries an API key, and no key can be made.
  The permission map keeps its entries for the hidden routes (the route test needs a rule per file).
- **The email setting of a form** is gone from the form's settings panel (`FormSettings.tsx`: only Success and
  Redirect stay), from the MCP tool `update_form_settings`, and from the body both renderers post. A form layer that
  already carries `email_notification` keeps the data and nothing reads it. Settings > Email stays as ycode ships it (it
  now configures nothing a form uses: see the pull request's notes).
- **The submit route does one thing: it stores.** `POST /ycode/api/form-submissions` (the `/studio` name from a published
  page) screens the post (same origin, payload caps, honeypot, rate limit per site and address), strips the honeypot's field,
  stores the row with its metadata (the address, the user agent, the page) and answers 201 with the row. It no longer sends
  ycode's email, dispatches the `form.submitted` webhook, or runs the app integrations; a bot's post is stored as `spam` and
  answered the same. Publishing still calls `dispatchSitePublishedEvent`, which finds no webhook.
- **A form in Arabic and English.** A form's texts (labels, the button, the success and the error message) are ordinary text
  layers: the localization screen lists them and the page uses a translation once it is marked complete (an incomplete one
  is a draft and never shown, ycode's rule). The page's `lang` and `dir` follow the locale, so labels, the success message and
  the error message come out in the page's language and direction. Not translatable in ycode: an input's placeholder
  (the Form element's three fields carry one that repeats the label: it stays English on an Arabic page until the user clears
  it; OPEN_QUESTIONS, part 3), and the honeypot's own label, which no person or screen reader reaches.
- **A collection's items on a page** show through a Collection element bound to the collection (its Settings > CMS), and on
  a dynamic page ("CMS page": slug `*`, `settings.cms` names the collection and its slug field) at `/{slug}` and
  `/{locale}/{slug}`. An item's words in Arabic are the localization screen's translations of the item
  (`source_type cms`, `field:key:{key}` or `field:id:{id}` for a field the user added). A new item's manual position is 0
  (ycode's own default), so a list with no sort shows the newest first; the builder's reorder sets positions.
- **Tests.** `e2e/forms.spec.ts` (the Form element, the Forms screen and the missing email block; the Forms button for a
  user with and without the forms flag; a visitor on an English page and on an Arabic page, each in its own language and
  direction; the row for that site only, and another site's own rows apart; the rate limit refusing a visitor with the error
  message in Arabic; the honeypot's spam row; a post from another origin refused; no webhook called), `e2e/collections.spec.ts`
  (a collection with two added fields and two items made in the builder; a list bound in the builder; an item page; both
  items on the list and each on its page, in both languages; a second site with none; the editor lock and a reader), and
  `e2e/offline.spec.ts` (Collections and Forms open; the hidden screens and routes answer 404, `/studio` too; Apps lists
  three apps). `lib/platform/parts.test.ts` pins the hidden set against the app registry.

## Carried items (part 3, session W10, 11 Nov 2026)
Four small items from parts 1 and 2 (PRD V1.0 "Carried from parts 1 and 2"); all in the fork.
- **The site's name on a published page** (part 1's OPEN_QUESTIONS 17, notebook decision 12). `generatePageMetadata` adds
  `og:site_name` (`openGraph.siteName`) from the `site_name` setting, which `fetchGlobalPageSettings` already read for the
  product page's title; it is written wherever the page's Open Graph tags are: every published page, in every language,
  whatever its own SEO fields say. A page's title is its SEO title, else its name, else the site's name, else the caller's
  fallback (`pageTitle` in `lib/platform/site-seo.ts`; before, the fallback came before the site's name was asked).
  Changing the name in Site settings reaches the pages on the next publish: the global settings are cached under the
  all-pages and global-settings tags, which every publish refreshes. Not changed: an error page keeps its own title
  ("Page Not Found", the custom page's name) and has no Open Graph tags, as before; the static export writes its own
  `<title>` and Open Graph tags (`buildDocument`) and has no site name yet.
- **The unit's name** (part 2's OPEN_QUESTIONS 68, owner 10 Nov 2026). `unitText` (`store-elements/format.ts`) reads the
  unit's name ("Each"), not its symbol ("ea"); the symbol stands in only for a unit with no name. The product page used
  its own symbol-first expression and now calls `unitText` too, so the product page, the cart, the checkout and the
  confirmation (which already showed Sales' name) read the same word. Organization Setup keeps one name per unit, so
  Arabic and English show the same word: there is no Arabic unit name to read. A cart a buyer already holds shows the
  new text without being rebuilt: the line keeps the unit's name and symbol and `unitText` picks.
- **The export's fonts** (part 2's OPEN_QUESTIONS 63). `exportSite` no longer calls ycode's `fetchGoogleFontsCss`:
  `exportedGoogleFonts(urls)` (`lib/platform/exported-fonts.ts`) reads each family's stylesheet and its files through the
  font mirror (`getMirroredCss`, `getMirroredFontFile`), writes the rules with their files at `/studio/fonts/{family}/{version}/{file}`
  (`toExportedFontCss`, `EXPORTED_FONT_FILES_BASE` in `published-fonts-url.ts`) and returns the files, which the engine adds
  to the export under the same keys (`studio/fonts/...`, with the other bundled assets). `relativizePaths` makes the two
  places that name them relative to the page, as it does the other bundled assets: `url(/studio/fonts/...)` in the
  inlined rules and the `href` of the first heading's preload (`./studio/fonts/...` at the root, `../studio/fonts/...`
  under `/en`). No exported file names `fonts.googleapis.com`, `fonts.gstatic.com` or a route of the platform. A family
  whose stylesheet or any file the mirror cannot give is left out whole (so no rule names a missing file) and the engine
  logs `[Static Export] The font mirror could not give ...`; the export completes without that font, as a published page
  is served without it, and nothing reads Google instead. Before, a Google failure was swallowed with no log.
- **The loading shell's language in the export** (part 2's OPEN_QUESTIONS 62): **no change to the code.** The note of
  session 25 above says the export's HTML string path has only the page's own locale. It does not: the engine builds the
  default pass's context with the site's default locale (`engine.ts`, `ctx`), and `renderResolved` hands
  `data.locale ?? ctx.locale` to `layerToHtml`, so an Arabic-first site's root and pages read `dir="rtl" lang="ar"` in the
  export already (`e2e/static-export.spec.ts` passed on the code of 9 Nov). The routes that do render with only the page's
  own locale are the collection filter and load-more routes (`locale` stays null there unless the request names a
  non-default language, so a store element inside a collection item would read English on a default-language page);
  the item names the export, so they are left, and whether any site puts a store element in a collection item was not
  checked.
- **Tests.** `lib/platform/site-seo.test.ts` (the title order), `published-fonts-url.test.ts` (the export's rules and
  keys), `store-elements/format.test.ts` (the unit's name); e2e: `e2e/site-name.spec.ts` (`og:site_name` once on every
  page of a two-language site, the title, a rename after a publish), `e2e/static-export.spec.ts` (the shells' language;
  no Google host in any exported file, the files in the export, named relative to each page, a real woff2 and the
  heading's preload), `product-page.spec.ts` and `checkout-flow.spec.ts` (the unit's name in English and Arabic).
  The font case needs the mirror to read the family from Google the first time; where the run has no network it checks
  only that no file names a Google host.

## Visit counting (part 3, session W7)
- **How a view reaches the server.** The published page tells its own host: `lib/platform/VisitBeacon.tsx`, a client
  component that renders nothing, mounted by `components/PageRenderer.tsx` (one line) on a published page that is not an
  error page, sends one `POST /studio/api/visits` after the page has loaded (`fetch` with `keepalive`, a relative address,
  `lib/platform/visit-client.ts`), and again when the visitor moves to another page without a full load. The reason: a
  published page is served from the cache (`revalidate = false`), so the server does not run when it is viewed and cannot
  count it while rendering; a script after load delays nothing; a relative address cannot leave the site's host; and with
  scripts off nothing is sent and nothing is counted. The canvas and the preview render drafts, so they never mount it. A
  page the browser prerendered waits for `prerenderingchange`. No cookie is set and nothing is read from or written to the
  browser's storage.
- **The route.** `POST /ycode/api/visits` (public name `/studio/api/visits`), `{ page_id, path, referrer }`, where
  `referrer` is the host of `document.referrer` only. Anonymous, in the proxy's map as public; the site comes from the host
  alone, so the builder host, a template and an unknown host answer 404 `site_not_found`. Same origin only (403
  `cross_origin`), a 2 KB body (413 `too_large`), `invalid_body` 400, and 600 requests per ten minutes per site and IP
  (429 `rate_limited`; in memory, `lib/platform/visit-limit.ts`: the form route's ten a window is a number one reader
  passes, so the route has its own). Everything else is 204, counted or not.
- **Not counted** (204, no row): a known bot by its user agent (`isBot`, a program-driven browser included, so the e2e's
  headless browsers are not visitors), a request with a prefetch header, a request that carries a valid `bos_session`
  (an editor where his session reaches the published host), a page id that is not a published, non-error page of the
  host's site, a request with no client address, and a view whose insert failed (logged; "the count never fails a page").
- **The visitor key.** `visitorKey` in `lib/platform/visit-rules.ts`: HMAC-SHA-256, keyed with `WS_VISIT_SALT`, of the
  site id, the day, the client IP (`getClientIp`, nginx's `X-Real-IP`) and the user agent. The day is the platform's day
  in Baghdad (`VISIT_TIME_ZONE`, `visitDay`), so the totals of W8 must use the same day. Changing the salt starts every
  visitor anew from that moment.
- **Source and device.** `sourceOf`: no referrer `direct`; a search engine `search`; a social network or messenger
  (their short links and Android apps included) `social`; any other host `referral` ("another site"). A view reached from
  the site's own host takes the source of the visitor's first row of the day (one statement, `lib/platform/visits.ts`),
  `direct` when there is none. `deviceOf`: `phone`, `tablet`, `desktop`; an iPad asking for the desktop site says it is a
  Mac and counts as a desktop.
- **Tables** (`20261111000001_torch_visits.ts`, direct knex, not tenant tables, not copied from a template).
  `platform_visits`: `site_id`, `page_id`, `path` (decoded, no query, no trailing slash), `created_at`, `visitor_key`,
  `source`, `device`, `kind` (`view`; the events of W8 below may have no page: the page columns are required for a view
  only). `platform_visit_days`: `site_id`, `day`, `path`, `source`, `device`, `views`, `visitors`, primary key on the
  first five; the daily run of W8 fills it. No IP address, user agent, referrer, name or country anywhere.
- **Not done here.** The static export's pages carry no beacon: an exported site is on a host with no Web Studio behind
  it. The events, the totals and the 90-day clean-up are W8's (next section); the reports are W9's.
- **Test.** `lib/platform/visit-rules.test.ts`, `visit-limit.test.ts`, `visit-client.test.ts`; `e2e/visits.spec.ts`
  (three views of two pages from two visitors; a bot, a prefetch, an editor, the preview, an error page and scripts off
  give none; a real browser contacts its own host only and gets no cookie; the refusals; a failing insert; the limit).

## Collections API for the app (part 3, session W6)
- **The route.** `GET /ycode/api/platform/sites/{id}/collections`, `webstudio.manage_content` `r` in the proxy's map. It is
  under `platform/`, so it needs a session and no site cookie, and it takes no editor lock: the app reads a site's
  collections without opening the site, as it reads the site's images. A site of another organization, an unknown id and
  an id that is not a uuid are 404; no session 401; a user without the content leaf 403 `{ required:
  'webstudio.manage_content.r' }`. Logic in `lib/platform/collections.ts`, the route file's comment gives the answer's shape.
- **The answer.** `{ data: [{ id, name, item_count, last_change, builder_path }], can_change }`, in the builder's own
  order (`order`, then newest first). One statement (direct knex on `tenant_id`, the way `lib/platform/templates.ts` reads
  a site's content): the site's draft collections that are not deleted, each with a left join on its draft items.
  - `item_count` is the items that are not deleted.
  - `last_change` is the later of the collection's `updated_at` and the latest `updated_at` of its items, as an ISO date.
    No person: the fork records none (plan decision 20a). An item's edit moves only the item's date, and a rename only the
    collection's, so the date is the latest of both. **A deleted item's date counts**: ycode's soft delete sets
    `updated_at`, and removing an item is a change to the collection, though the item is no longer counted.
  - `builder_path` is `/ycode/collections/{id}`, the builder's route for the collection (`app/(builder)/ycode/collections/[id]`).
  - `can_change` is whether the session holds `webstudio.manage_content` `u`, from the sign-in snapshot like the editor
    lock's own rule (`mayHoldSiteLock`): the app shows "Open in builder" when it is true and the read-only note when it is not.
    It tells the screen what to draw; the builder itself refuses a reader's writes (403, and 423 while another user holds the lock).
- **Opening the builder on a collection is session A2's.** The app opens a site's builder at
  `{service}/ycode/api/auth/callback?token=…&site=…`, which always redirects to `/ycode`; it takes no target. Carrying
  `builder_path` into the opened builder needs either a target the callback accepts (limited to paths under `/ycode/`, so it
  is not an open redirect) or the app's webview navigating to it once the callback has set the cookies. Neither is built here
  (out of this session's bounds); the builder route itself is whole and reads the site from the `ws_site` cookie.
- **Not here.** Creating, renaming and deleting a collection, its fields and its items are the builder's, and stay on the
  `collections/...` routes (session W1's map). No paging: a site has a handful of collections and the builder lists them all.
- **Test.** `lib/platform/collections.test.ts` (the row: the count as a number, the later of two dates, no items, a
  missing date) and `lib/platform/permissions.test.ts`; `e2e/collections-api.spec.ts` (two collections with items give the
  counts and the path; a deleted collection is not listed and a deleted item not counted; editing an item, adding one,
  deleting one and renaming the collection each move the date of that collection and no other's; another site's
  collections are not listed; a Viewer reads the list with `can_change: false`, a create-only user too, a Member gets
  `true`; 401, 403 and 404).


## The prospect switch and the Contact Center link (part 3, session W3)

A form can send its submissions to Contact Center, and each submission knows what became of it (PRD V1.0 "Forms",
"Prospects").

- **The switch.** `settings.form.create_prospect` on the form layer, next to the success action; "Create a prospect
  in Contact Center" in the form's settings (`FormSettings.tsx`). Off for the Form element; on for the new
  **Contact form** element (`lib/templates/forms.ts`, `contactForm`: the Form element with a phone field; name and
  phone required, email and message optional).
- **The rule.** `lib/platform/form-prospect.ts`, with nothing of Next or the database in it. While the switch is on
  the form holds an input named `name` and an input named `phone`, both required. The builder refuses a change that
  takes one away (removed, moved out, renamed, made optional) and a switch-on for a form that lacks one, with a
  toast that says why. The rule sits once, around the pages store's `set`
  (`lib/platform/form-prospect-guard.ts`; two lines in `stores/usePagesStore.ts`), so ycode's actions are
  untouched. A form that is new to the tree or was already out of order (a paste, a page as it loads) is let
  through, so a page is never locked. A form inside a **component** is edited in the component store, which has
  no guard: the server's check below is what holds there.
- **The phone.** Checkout's rule (`canonicalIraqiMobile`): an Iraqi mobile with or without the country code. The
  page checks before it sends and shows the message on the field with the browser's own validation bubble, in the
  page's language (`lib/platform/form-prospect-page.ts`, called by the two renderers); the server checks again and
  answers `400 { code: 'invalid_fields', fields: { name?, phone? } }`, storing nothing.
- **Where the switch is read.** `POST /ycode/api/form-submissions` reads it from the site's **published** layers
  (pages and components) by the form id and the layer id the body names (`publishedSwitch` in
  `lib/platform/form-links.ts`, `planSubmission` in `lib/platform/form-submit.ts`). Nothing in the body turns it on
  or off. Form ids are not unique, so the layer id tells two forms with one id apart; a body that names no
  published layer is read by the form id alone and is on when any published form with that id is on.
- **The link.** `platform_form_links` (`20261111000002_torch_form_links.ts`): one row per submission, direct knex:
  `submission_id` (primary key, goes with the submission), `site_id`, `state`, `contact_center_id`, `attempts`,
  `last_attempt_at`, `created_at`. The migration gives every existing submission a `stored` row.

  | state | when |
  |---|---|
  | `stored` | the switch is off, or the submission is spam: Contact Center is not asked |
  | `waiting` | the switch is on and Contact Center has not answered |
  | `prospect` | Contact Center answered with a prospect (new, or the one that already holds the phone) |
  | `contact` | the phone is a contact's; no prospect is made |

- **The call.** `findOrCreateProspect` in `lib/platform/contact-center.ts`: `POST
  /api/v1/internal/prospects/find-or-create { name, phone (964…), email?, notes?, origin: 'web_form' }`, the
  message as the notes. The visitor's request gives it 3 seconds (`FIRST_ATTEMPT_TIMEOUT_MS`); the answer to the
  visitor is a success once the submission is stored, whatever Contact Center does.
- **The retry.** A timer in the server process, started from `instrumentation.ts`
  (`lib/platform/form-link-retry.ts`), every `WS_FORM_RETRY_TICK_SECONDS` (30). Each run takes up to 20 waiting
  rows of live sites whose delay has passed and asks again with the submission's stored fields. The delay between
  a row's attempts doubles from one minute to six hours and stays there until Contact Center answers
  (`retryDelaySeconds`). A row is taken by counting its attempt under `FOR UPDATE SKIP LOCKED`, so a second process
  would share the rows, not repeat them. What waits is in the table, so a restart loses nothing. The service has no
  job queue; a queue, a cron container or a cron route called from outside would each add a piece to deploy and
  watch for one small job.
- **Before production.** Contact Center's route (torch-core-backend, session 1 of part 3) deployed;
  `CONTACT_CENTER_URL` and `CONTACT_CENTER_API_KEY` are part 2's.
- **Tests.** `lib/platform/form-prospect.test.ts` (the four states, the required-field rule, the fields, the
  delay), `contact-center.test.ts` (the call), `e2e/form-prospects.spec.ts` (the builder, the page, the stub
  Contact Center up and down, the retry).

## Visit events, daily totals and the 90-day clean-up (part 3, session W8)
- **Four kinds in `platform_visits`.** `view` (session W7) and three events of the same visitor: `add_to_cart`, `order`,
  `form`. An event has no page (`page_id` and `path` null). Each carries the visitor key that visitor's page view has that
  day: the same `visitorKey` of the same site, day, client IP and user agent, worked out by the request that causes it
  (`lib/platform/visit-events.ts`, `visitorOf`), and the source of the visitor's first row of the day, `direct` when there
  is none (`recordEvent` in `lib/platform/visits.ts`; the device is the request's own). The same rules as a view decide
  whether it is counted: a known bot, a prefetch, a request that carries a valid `bos_session`, a request with no client
  address and a missing `WS_VISIT_SALT` count nothing (the salt message is logged once per process and now says "no view or
  event"). A failure to store is logged and never touches what the visitor did: the order, the submission and the page go
  on (`countEvent` never throws).
- **Where each is written.**
  - `add_to_cart`: the store's add to cart (`lib/platform/store-elements/add-to-cart.ts`, the one place every card, grid
    and product page ends in) calls `reportAddToCart()` (`lib/platform/visit-client.ts`): one `POST /studio/api/visits`
    with `{ kind: 'add_to_cart' }` to the page's own host, nothing else in the body, no cookie, no storage. It reports only
    where a counted page is connected: `VisitBeacon` connects its `window` while it is mounted (a published page, never the
    canvas or the preview) and disconnects on unmount, so an add to cart in the builder reports nothing. The route
    (`parseReport` in `lib/platform/visit-rules.ts`) reads a view as before (no `kind`, or `kind: 'view'`) or exactly
    `{ kind: 'add_to_cart' }`; **any other kind, `order` and `form` included, is 400 `invalid_body`**: those two are the
    server's to write, never a browser's word. The row is one per visitor and day: a partial unique index
    (`platform_visits_cart_once_index`, on the visitor key, which is already per site and day) refuses a repeat, so the
    page sends on every add and a bot's hundred leave one row. The add to cart is not checked against the store: a site
    that does not sell has the row, and the Conversions report shows form submissions only for it (PRD).
  - `order`: `POST /ycode/api/store/checkout` passes `placeOrder` a callback that `place` runs once, after the Sales order
    is created and recorded (`order.created`): **not** for a replayed checkout (200, its order already existed), a refused
    item (422), a Sales or other service that could not be asked (503), the honeypot (201 with no order), and **not twice
    for a double click**: a second request for a checkout in flight waits on the first's flight and gets its outcome
    (`created: true` as well), so the event is written by the flight that made the order, not by each response. It is every
    order: a visitor who orders twice has two rows.
  - `form`: `POST /ycode/api/form-submissions` writes one when the submission is stored with status `new`: spam (the
    honeypot) is stored for review as before and is not a conversion, and a refused post (403, 400) writes nothing. The
    site comes from the request's host (`countEventOnHost`); the builder host and a host of no site count nothing.
- **Which number each total holds** (`lib/platform/visit-totals.ts`, the comment at its top):
  `visitors` is visitors with at least one counted view that day, each once; `views` is every view; `cartVisitors`,
  `orderVisitors` and `formVisitors` are visitors, each once however many times; `orders` and `forms` are the true number
  of Sales orders created and forms stored. An event does not make its visitor a `visitor`: an add to cart, an order or a
  form whose view was not counted (refused as too frequent, or sent before the salt was set) is in its own column only, so
  a share of visitors can in principle pass 100 %; W9's reports clamp what they show.
- **Tables** (`20261111000002_torch_visit_events.ts`). `platform_visits` gets a check on `kind` (the four) and the unique
  index above. `platform_visit_site_days`: `site_id`, `day`, `visitors`, `cart_visitors`, `order_visitors`, `orders`,
  `form_visitors`, `forms`, primary key `(site_id, day)`, numbers only. It is also the record that a day is totalled.
  `platform_visit_days` (W7) now holds the page rows: views and visitors per site, day, page path, source and device.
  Neither totals table is ever deleted from; both go with their site.
- **The daily run** (`lib/platform/visit-totals-run.ts`; the numbers are `totalsOfDay`, unit-tested on a fixture of three
  days). One transaction, behind an advisory lock (a second run at the same moment answers `skipped: true`): (1) every
  finished day (before today, in the platform's day, Baghdad) of every site that has detailed rows and **no row in
  `platform_visit_site_days`** is read, totalled and written (its site row and its page rows, inserts that ignore a
  conflict), so a day is totalled once, the first run after it ends, and running again changes nothing; a backlog of
  missed days is caught up in the same run; (2) detailed rows older than 90 days (`RETENTION_DAYS`) are deleted, only
  those whose day has its site row, so a day the run could not total is never lost. The day boundary is the database's
  `AT TIME ZONE 'Asia/Baghdad'`, the same zone `visitDay` gives the visitor key. A row written for a finished day after
  that day was totalled is not in the totals: the scheduled run is at 01:00, an hour after the day ends, and a row is
  written within a second of its request.
- **How it runs.** The service starts a timer (`startVisitTotalsSchedule`, called from `instrumentation.ts`): at 01:00
  Baghdad time (22:00 UTC the evening before) every day, logged as `[visit totals] {"skipped":false,"siteDays":N,"deleted":M}`;
  a failed run is logged and the next day's run totals the days it missed. By hand, and for the e2e: `pnpm visits:totals`
  (`scripts/visit-totals.ts`, `DATABASE_URL`), the last line of its output is the same JSON; in the container, the way the
  template seed runs: `docker exec web-studio sh -c 'cd /tooling && TS_NODE_TRANSPILE_ONLY=1 TS_NODE_PROJECT=tsconfig.test.json
  node -r ts-node/register -r tsconfig-paths/register scripts/visit-totals.ts'`. It needs no new environment key: the salt
  of W7 is the only one the events use. A server with several processes is safe (the lock).
- **Rollback.** The migration's `down` drops `platform_visit_site_days`, the unique index and the kind check. The
  totals are never read to serve a page, so nothing else depends on them; a rolled-back image simply stops adding events and
  totals (the detailed rows then stay until the run is back).
- **Test.** `lib/platform/visit-totals.test.ts` (the three-day fixture), `visit-totals-schedule.test.ts` (the next run,
  and the timer under mocked time: once a day, armed again after a failure), `visit-rules.test.ts` (`parseReport`), `visit-client.test.ts` (the report and where it does nothing);
  `e2e/visit-events.spec.ts`: a visitor who views, adds to the cart twice and orders is one cart visitor and one order under
  one key; a refused item, Sales down and a replayed checkout write no order; a form gives one event, spam and refusals none;
  a browser cannot report an order or a form; the product card's button in a real browser reports once however many times
  it is pressed; the new table holds numbers only; the daily run totals every finished day once (the day boundary at
  midnight in Baghdad included), twice over changes nothing, and a row of 91 days ago is gone while its total stays.

## Submissions API for the app (part 3, session W4)
- **The routes.** All under `platform/`: a session and no site cookie, and **no editor lock**, so the app reads and deletes
  without opening the site and a delete never answers 423 while another editor holds the lock (the proxy skips the lock
  under `/ycode/api/platform/`; `e2e/submissions-api.spec.ts` has an editor hold the lock and a second Manager delete).
  All are `webstudio.manage_forms`: `r` reads, `d` deletes. A site of another organization, an unknown id and an id that is
  not a uuid are 404; no session 401; no forms leaf 403 `{ required: 'webstudio.manage_forms.r' }` (or `.d`). The site is
  checked before the query, so a stranger learns nothing from a bad query.

  | Route | Answers |
  |---|---|
  | `GET sites/{id}/submissions?form_id=&unread=&cursor=&limit=` | the site's submissions, newest first, spam left out |
  | `GET sites/{id}/submissions/{submissionId}` | one submission with every field; **reading it sets it read** |
  | `DELETE sites/{id}/submissions/{submissionId}` | `{ data: { id } }`; the submission and its link row |
  | `GET sites/{id}/submissions/forms` | `{ data: [{ id, name }] }`: the site's forms, for the list's filter |
  | `GET submissions/unread-count` | `{ data: { count, sites: [{ id, count }] } }`: the organization's and each live site's (0 when none) |

  Logic in `lib/platform/submissions.ts` (the database), the shapes and rules in `lib/platform/submissions-view.ts` (pure,
  unit-tested), the shape of each answer in its route file's comment.
- **The list.** A row is `{ id, date, form: { id, name }, sender: { name, phone }, unread, contact_center: { state, kind, id } }`
  and the page `{ data, next_cursor }`. `sender` is the payload's `name` and `phone` fields, trimmed; null for a form that has
  none (the app shows "Not given"). `unread` is the status `new`. `contact_center` is `platform_form_links` (W3): `state`
  `stored` | `waiting` | `prospect` | `contact`, and for the last two `kind` and `id` name the Contact Center record (null
  otherwise); a submission with no link row reads `stored`. `date` is `created_at` as an ISO date. `form_id` filters by form;
  `unread=true` is the unread, `unread=false` the read, absent both; the two combine. Any other query key, a bad value or a
  `limit` outside 1 to 100 (25 by default) is 400 naming the parameter; a cursor this route did not give is 400
  `{ code: 'invalid_cursor' }`.
- **Paging.** Keyset, on `(created_at, id)` newest first, `limit + 1` rows read to know whether there is a next page. The
  cursor is opaque (base64url of `{ at, id }`) and `at` is the date **as text to the microsecond** (`to_char(... AT TIME ZONE
  'UTC', '...US')`): a JavaScript date has milliseconds, so two submissions in one millisecond would be skipped or repeated at a
  page edge. A cursor is only decoded when it has exactly those two keys, a timestamp of that shape and a uuid, and the
  values go to the database as parameters.
- **The detail.** The row, and `fields: [{ name, label, value }]`, and `links: { open_in_contact_center }`. The fields are what
  the visitor sent: the form's fields in the form's order with the form's labels, then what the form does not have (a field
  removed since, or one invented) in the payload's order under its own name; a field of the form that was not sent is not
  listed. The payload is jsonb, which keeps no order of its own, so the order can only come from the form. `value` is text, or
  a list of text for a field sent more than once; the payload is free JSON (the submit route takes any object), so a number or
  a nested value is made into text.
- **The link.** `torch://app/<CONTACT_CENTER_APP_ID>/prospects/{id}` for a prospect and
  `torch://app/<CONTACT_CENTER_APP_ID>/contacts/persons/{id}` for a contact, the same shape the Orders API gives for Sales and
  Contact Center's own routes (`Contact-Center/src/app/App.tsx`: `prospects/:id`, `contacts/persons/:id`). A contact here is a
  person: the route of C1 answers `contact` for a person who holds the phone. Null while the state is `waiting` or `stored`,
  and null without `CONTACT_CENTER_APP_ID` (then the app cannot offer "Open in Contact Center"; the log says so once, as the
  Orders API's does).
- **Forms and their names.** ycode has no form name and no field label of its own: a form is the form layer's `settings.id`
  (what the page sends as `form_id`, `unnamed-form` when it has none) and its fields are inputs. They are read from the site's
  layers, the pages' and the components' (a form in a component is stored there), published and draft, by one jsonpath
  statement like W3's. **A form's name is its layer's own name in the layers panel (`customName`), else its id** (open
  question). Published layers lead and name the form, the draft adds what it has more; two layers with one id are one form
  (the submit route stores the id only); a password form never submits here and is left out. A field's label is the text of
  the nearest `label` wrapper around its input (the Form element's own layout), else the text of a label that names it with
  `for`, else its placeholder, else its name. A form that no layer holds any more keeps its submissions and is listed under its
  id.
- **What is never answered.** The stored `metadata` (IP address, user agent, referrer, the page's URL) is not selected, and the
  record type that the row and the detail are made from has no such field. `e2e/submissions-api.spec.ts` posts with a marker
  user agent and address and finds neither in any answer. (The builder's own `/ycode/api/form-submissions` still answers the
  whole row with its `metadata`, to any user who holds `manage_forms` `r`, which since W1 includes the Member and the Viewer.
  Noted in the pull request.)
- **Spam** is stored for review and is not a submission of the app: it is not listed, counted, read or deleted here (404).
- **Delete.** One statement on the site's id; the link row goes with it through the table's foreign key (`ON DELETE CASCADE`).
  Contact Center is never called: the prospect or contact a submission became stays there (the e2e compares the stub's call
  log before and after).
- **Unread count.** One statement over the organization's live sites with a left join on their `new` submissions: a deleted
  site's are not counted, another organization's never. The Navigator takes `sites[].count` for the site's Contact form and
  `count` for the module.
- **Not here** (handoff decision 2): "Mark as unread", "Copy link", the page a submission came from.
- **Before production.** Session 18 sets `CONTACT_CENTER_APP_ID` in web-studio's environment (the value is in
  contact-center-service's block of the compose). No migration.
- **Test.** `lib/platform/submissions-view.test.ts` (the query and its cursor, the sender, the Contact Center marker, the link,
  the forms' names, fields and labels, the detail, the filter's forms), `lib/platform/permissions.test.ts`;
  `e2e/submissions-api.spec.ts` (made by real submissions through the site's submit route against the stub Contact Center: the
  four link states, a spam one and a form no layer holds; the list newest first and by cursor, both filters alone and together,
  400s; the forms; the count by site and organization; the detail marks it read and the count drops; the deep link; no IP or user
  agent; delete as a Manager with the link row gone and Contact Center untouched; 403 on delete for a Member and a Viewer who
  can read; 401 and 403; another site, another organization, spam and unknown ids 404 with nothing changed; the editor lock;
  a deleted site's count).

## Reports API for the app (part 3, session W9)
- **Three reads, all `webstudio.manage_reports` r** (`lib/platform/permissions.ts`, siteless under `platform/`: no site cookie,
  no editor lock). Manager, Member and Viewer hold it by default (session W1); a user without it is 403 with
  `required: 'webstudio.manage_reports.r'`, no session is 401, and a site of another organization, one that does not exist
  or an id that is no id is 404 (`getSiteForOrganization`; the site is checked before the period, so a stranger is never
  told 400).
  - `GET /ycode/api/platform/sites/{id}/reports/traffic`: `{ data: { period, no_data, views, visitors_per_day, series, pages,
    sources, devices } }`. `series` has one `{ day, views, visitors }` for every day of the period, oldest first, a day with
    no visit with zeros; `visitors_per_day` is the average over the period's days (each day's own value is in the series);
    `pages` is `{ total, top }`: `total` counts the pages viewed, `top` the 6 most viewed (the handoff's "Top 6 of 38") by views
    then path, each `{ path, name, views, share }`, `name` being the page's name in the builder or `null` when no page has that
    path now; `sources` is all four (`direct`, `search`, `social`, `referral`, which is "another site") and `devices` all three
    (`phone`, `desktop`, `tablet`), always in that order, with `views` and `share`. No countries.
  - `GET /ycode/api/platform/sites/{id}/reports/conversions`: `{ data: { period, no_data, sells, steps } }`
    with `steps` in the funnel's order, each `{ step, count, share }`: `visitors`, `cart`, `orders`, `forms`. A site that does not
    sell has `sells: false` and only `visitors` and `forms`: the cart and orders steps are **absent**, whatever the site holds of them
    (a site that does not sell can hold `add_to_cart` rows, W8).
  - `GET /ycode/api/platform/reports/summary`: `{ data: { period, no_data, total: { views, visitors_per_day }, sites } }`,
    `sites` being the organization's live sites oldest first (the order of All sites) with `{ id, name, status, views,
    visitors_per_day, views_by_day }`; `views_by_day` is `[{ day, views }]`, one per day, for the Dashboard's small chart. A site
    that was never published (`status: 'draft'`, no `published_at`) has `views`, `visitors_per_day` and `views_by_day` all `null`,
    not zero, is not read and adds nothing to the total. An organization with no site answers `sites: []` and `no_data: true`.
- **The period.** `?period=today|last_7_days|last_30_days`, or `?from=YYYY-MM-DD&to=YYYY-MM-DD`: one kind, never both,
  never neither. The days are the platform's (Baghdad, `visitDay`), both ends counted; the last 7 days end today and count it. A
  range is real days, `from` not after `to`, `to` not after today, and at most **366** days ("one year"). Anything else is 400
  `{ error, code: 'invalid_period' }` with what to change. The answer's `period` is `{ key, from, to, days }`, `key` being
  `today`, `last_7_days`, `last_30_days` or `custom`, so the app shows the days it read. (`lib/platform/report-period.ts`.)
- **No data is not an error.** A period with nothing to show answers 200 with `no_data: true`, zeros, empty lists and (for
  Traffic and the summary) the zero-filled series. "Nothing to show" is: no view (Traffic); no shown step with a count
  (Conversions, so a site that does not sell looks at its two steps only); no view and no visitor in any site (summary).
  In Conversions a share is `null` when there are no visitors to divide by.
- **Which number is which** (the daily totals', `lib/platform/visit-totals.ts`). A visitor is counted once a day, so there is no
  "visitors in the period": `visitors_per_day` is the visitors of every day added up over the number of days of the period, days
  nobody visited included, to one decimal (8 visitor-days over 7 days is 1.1). In Conversions `visitors` is those visitor-days
  added up, `cart` the visitors who added to the cart (once a day each), `orders` the orders placed (every one: a visitor who
  orders twice is two) and `forms` the form submissions that were not spam. A **share of visitors** is the count over the
  visitors, one decimal, **clamped to 100**: an order or a form whose visitor's view was not counted (a refused view, a missing
  salt) is in its own count only, so the count can pass the visitors. The **shares of a whole list** (sources, devices, all pages)
  are percentages with one decimal that add up to exactly 100.0 (the largest remainders get the tenths left over, the earlier one
  on a tie: `sharesOf` in `lib/platform/report-numbers.ts`); the top pages' shares are of **all** the views, so the six shown
  add up to less than 100 when there are more pages.
- **Where a day is read from.** The days up to the site's **latest totalled day** (`platform_visit_site_days`) come from the
  totals (`platform_visit_site_days` and `platform_visit_days`); the days after it come from the detailed rows
  (`platform_visits`), made into numbers by `totalsOfDay`, the function the daily run uses. That is today, which is never in the
  totals, and a finished day the run has not reached yet (the hour after midnight, 00:00 to 01:00 Baghdad, or a run that
  failed). A day is never read from both, so nothing is counted twice; the detailed rows are gone after 90 days, so a range
  over 90 days is read from the totals alone. The rule needs no new table or column and no environment key. (`lib/platform/reports.ts`.)
- **The page names** come from the site's own pages (the draft rows that are not deleted and are not error pages), because the
  totals keep a path and not a page id: each page's path is built the way the builder builds it (`buildSlugPath`), a dynamic
  page names every path its collection makes, and a path that begins with one of the site's language codes (`/ar/about`) is
  the page without it. A page deleted since the visit, or whose slug changed, has `name: null` and the app shows the path.
  Not translated: the name is the builder's. (`lib/platform/report-pages.ts`.)
- **Left out** (plan decisions): countries, the busiest day and a table view of the chart (handoff decision 3), export, revenue.
  The answers carry nothing of a visitor: no key, no address.
- **One side effect.** Conversions reads whether the site sells through `storeOf` (as the published site and Orders do), which
  makes the site's store row with its defaults on the first read of any site: the same idempotent insert the Store settings
  screen does. Nothing else a report does writes.
- **Test.** `lib/platform/report-period.test.ts`, `report-numbers.test.ts` (shares that add up for any counts, the average, the
  series, the three reports) and `report-pages.test.ts` (folders, index pages, dynamic pages, language codes);
  `permissions.test.ts` (the three routes on the leaf, a Viewer reads, a user with the other four leaves does not);
  `e2e/reports-api.spec.ts` on a fixture of visits and events for a selling site, a site that does not sell and a draft: the
  numbers of the three routes with every figure written out by hand; the shares add up; the finished days' detailed rows are
  deleted after the daily run, so their numbers can only come from the totals, and today's rows are never totalled; a finished
  day the run has not reached is read from the detailed rows; the cart and order steps absent for the site that does not sell;
  a period with no visit; a draft with no numbers; the period's refusals and the 366-day limit; a Viewer reads; 401, 403 without
  `manage_reports` r, 404 for another organization's site.

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

Session 4: `e2e/templates.spec.ts` (the seeded templates listed for any
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

Part 2, session W1: `e2e/store-settings.spec.ts` (the defaults from the first read, the stub's branches and summed-up
category tree, 401 / 404 across organizations / 403 for a Viewer, a branch with two categories and a fee saved, selling only
with a branch, only the organization's active branches and live categories, a currency change only with its fee, values
archived or deleted since they were chosen kept and marked, both services down, a template that never sells and whose store
a copy does not inherit) passes with `pnpm test` (397) and `pnpm e2e` (92); the migration runs from empty and on a copy of
the production schema (8 Nov 2026), and rolls back.

Part 2, session W3: `e2e/checkout.spec.ts` (one person and one order per checkout with the bodies Contact Center and Sales
receive, the repeat and the concurrent pair answered by one order, ineligible lines and a Sales refusal named, field errors in
Arabic, Sales or Contact Center down storing nothing and the retry finding the person, the confirmation read and its 404s, a USD
store without the day's rate, cross-origin, honeypot, the rate limit per site and IP, the builder host and a store that does not
sell) passes with `pnpm test` (471) and `pnpm e2e` (125), against stand-ins of SL2's service create (8 Nov 2026).

Part 2, session D1 (8 Nov 2026, on the production server, the test organization): `pnpm e2e:server` passes, 38 tests. Part 1's
five; `store-settings.spec.ts` (the real branches and category tree, a branch, a category and a fee saved, selling only with a
branch, an unknown or archived branch and an unknown category refused, a currency change only with its fee); `catalogue.spec.ts`
(the item on the ECOMMERCE channel with its price and unit, its image through Document Center byte for byte with the same ETag
on the second read, search, category, paging, one product, the shop home's categories, a fee change seen at once, a store that
does not sell and the builder host answering 404); `checkout.spec.ts` (one real order with the code Sales gave, read back in
Sales as a draft from the storefront for this site with cash on delivery, the fee and the buyer from Contact Center, the retry
answered by the same order, the confirmation, bad bodies in Arabic and English, an unknown item 422, another origin, the
honeypot, the builder host, a store that stops selling, the cancel with its reason and acting user in Sales's history);
`orders-api.spec.ts` (list by site, status and code, the waiting count, one order with its buyer, lines, address and links,
confirm and cancel as the signed-in user, a repeat refused, 404s); `storefront-browser.spec.ts` (a buyer in Chromium on
`https://{slug}.sites.torchcorp.com/products` finds the real item with its real image, adds it, checks out and reads the code;
the same pages in Arabic; the builder opens the site and its Store elements; the hosts contacted are recorded). Every order the
runs made (9 in all, including those of the runs that failed on the way while the specs were written) is cancelled in
Sales: none draft, none confirmed. `POST
/ycode/api/auth/dev-login` answers 404 on the server.

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
  the first time and keeps it in `PLATFORM_STORAGE_DIR/_mirror/fonts`. Published pages kept
  Google URLs until part 2, session 26 ("The published pages' font", below); the static
  export still does. ycode's template service has no default
  host any more (`TEMPLATE_API_URL` unset: the gallery is empty, apply and export refuse);
  its hard-coded upload key is gone.
- **No Supabase package.** `@supabase/supabase-js` and `@supabase/ssr` are out of
  `package.json`; `lib/platform/types.ts` has the types the code used (User, Session,
  RealtimeChannel, SupabaseClient). `database/scripts/backfill-content-hashes.ts` (a
  Supabase-only upstream script) is deleted.
- **Removed screens** (404 from `proxy.ts`, files deleted): settings/users, profile,
  accept-invite, welcome (the Supabase setup wizard), with their API stubs and the invite
  button. A server without `DATABASE_URL` shows a message instead of redirecting to the wizard.
- **`WS_PARTS=1`** (server env, read by `lib/platform/parts.ts`) showed Collections and Forms.
  Unset, `/ycode/collections*` and `/ycode/forms*` answered 404, the header had no CMS and
  Forms buttons, and the element library had no Form element. The flag is gone since part 3,
  session W2: both are always shown ("Forms and Collections shown", above).
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
  manage_orders: no route yet (part 2). (Part 3, session W1, moved collections to manage_content and added
  manage_reports: see "The permission map for part 3".) Public routes have their own credential; a few are
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

## Part 2, session 13: the update check, tanween in the canvas
- **No update check.** ycode's "Update available" asked `/ycode/api/updates/check`, which
  asked `api.github.com` for ycode's releases; Web Studio is updated only through this fork.
  The header's check and button, both `updates` routes, `lib/updates/`, the unused
  `components/UpdateNotification.tsx` and Settings > Updates (page and menu entry) are
  deleted; the two routes are out of `lib/platform/permissions.ts`'s map. `e2e/offline.spec.ts`
  fails if the builder calls `/ycode/api/updates`, shows the notice or the menu entry, or
  one of the removed routes answers anything but 404 (its blocked-host guard could not see
  this one: the browser only reached the app's own host, the server made the outside call).
- **Tanween in the canvas is WebKitGTK's, not the canvas's.** In WebKitGTK (Tauri's webview
  on Linux) a word that ends in an Arabic mark is drawn above the line, in the canvas and
  on a published page alike; Chromium draws it right (WebView2 on Windows is Chromium and
  WKWebView on macOS shapes with CoreText; neither was run). No CSS changes it. `lib/platform/arabic-marks.ts` has the cause and the measurements. The canvas
  (`components/LayerRenderer.tsx` only; published pages use `LayerRendererPublic`) puts a
  combining grapheme joiner (U+034F) after each run of Arabic marks, in the text it puts on
  screen, when the user agent is WebKit on Linux. The layer's data and the in-place text
  editor never see it, and the published page is untouched, so a visitor on WebKitGTK still
  sees the defect. Drop `arabic-marks.ts` and its calls in `LayerRenderer.tsx` when WebKitGTK is fixed.
  `e2e/canvas-marks.spec.ts` checks where the joiner is and is not.

## Not done (c1 and after)
- Part 2's open findings are in "Part 2 in production": Cloudflare's beacon on the builder host (still requested on
  9 Nov 2026, see "Part 2 release fixes"), the Orders API's empty history, the rollback not rehearsed.
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

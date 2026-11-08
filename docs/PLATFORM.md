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
account; its organization is the test organization) and starts nothing. The local `pnpm e2e` leaves `e2e/server` out
(`testIgnore` in `playwright.config.ts`) and must never be given the production `DATABASE_URL_TEST`: it drops the schema.

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
    DOCUMENT_CENTER_URL=http://document-center-service:6016   # document-center mode, and the store's item images in either mode (W2)
    DOCUMENT_CENTER_API_KEY=<Document Center's SERVICE_API_KEY>
    WS_SITES_DOMAIN=sites.torchcorp.com   # default addresses are {slug}.{this}; required, never guessed
    DOMAIN_SERVICE_URL=http://domain-service:6012   # with DOMAIN_SERVICE_API_KEY: the organization's verified domains
    DOMAIN_SERVICE_API_KEY=<domain-service's SERVICE_API_KEY>   # (session 7); see WS_DOMAIN_CHECK below
    WS_DOMAIN_CHECK=on   # `off` accepts any host name as a custom host, with no check against verified domains
    PAGE_AUTH_SECRET=<signs the password-protected page cookies; Web Studio's own>
    ALLOW_DEV_LOGIN=false   # absent in production; true only on a dev box: POST /ycode/api/auth/dev-login
    WS_PARTS=1   # absent in production: shows Collections and Forms (parts 2 and 3)
    WS_TEMPLATES_ORG=<uuid>  # the Business OS organization whose sites are TORCH's templates (session 4); on the server "TORCH corp"
    ORG_SETUP_URL=http://auth-service:6001   # Organization Setup (served by auth-service): the branches (W1), the day's rate and unit names (W2)
    ORG_SETUP_API_KEY=<auth-service's SERVICE_API_KEY>   # the internal routes take the service key (and x-entity-id for the rate and units); Sales holds the same key
    PRODUCT_SERVICES_URL=http://product-services-service:6024   # Product & Services: the category tree (W1), the items, variants and images (W2)
    PRODUCT_SERVICES_API_KEY=<product-services' SERVICE_API_KEY>   # with x-entity-id = the organization
    CONTACT_CENTER_URL=http://contact-center-service:6017   # the checkout's buyer: find or create a person by phone (W3)
    CONTACT_CENTER_API_KEY=<contact-center's SERVICE_API_KEY>   # ${CC_SERVICE_API_KEY} in the root .env; with x-entity-id
    SALES_URL=http://sales-service:6029   # the checkout's order: the service create and the order read (W3)
    SALES_API_KEY=<sales-service's SERVICE_API_KEY>   # ${SALES_SERVICE_API_KEY} in the root .env; with x-entity-id
    SALES_APP_ID=<Sales's catalogue app id>   # the Orders API's deep link into Sales (W8): torch://app/<this>/orders/<id>; unset: open_in_sales is null
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
  8 Nov 2026).
- **Test.** `e2e/checkout.spec.ts`. The platform stub answers Contact Center and Sales (`e2e/order-services-stub.ts`),
  records every call (`GET /__calls?service=`), and can refuse the next order (`POST /__sales/refuse`) or slow every create
  (`POST /__sales/delay`). Next fills a missing `x-forwarded-for` with the socket's address, so the spec's requests share one
  IP and the spec raises its site's limit.

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
  (OPEN_QUESTIONS 36). `links.open_in_sales` is `torch://app/<SALES_APP_ID>/orders/<id>`, the target Sales' own notification
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
  `SALES_APP_ID`. The e2e stands in for the status route as the session plan defines it.
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
  no size that clips it (`ws-decoy`): the field sits 9999 px to the left, which would widen a right to left page by as much
  (W6 review fix). The rules for the fields are the route's (`checkout-input.ts`): the
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

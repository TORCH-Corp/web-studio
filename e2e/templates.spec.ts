/**
 * Session 4 "done when": TORCH's templates are sites, and creating a site
 * from a template copies it.
 *
 * A template site with three pages, one component, two locales and one
 * asset is created through the API in the templates organization; a site
 * created from it in another organization has three pages, the component,
 * both locales and the asset, with new ids, and renders the same HTML;
 * editing the template afterwards leaves the site unchanged and the
 * reverse; creating with one language copies only that language; creating
 * blank gives the homepage and the three error pages; a template never
 * answers on a host.
 */

import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { createSite, listSites, openSite, publish, publishedSite, signIn, TEMPLATES_ORG, TEST_SITES_DOMAIN, type SiteRecord } from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const ORG_A = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';
const USER_T = { sub: '1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e', email: 'templates@example.com', name: 'Template Builder', org: TEMPLATES_ORG };
const USER_A = { sub: '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', email: 'owner-c@example.com', name: 'Owner C', org: ORG_A };
const HOST_1 = `c1-${RUN}.sites.test`;
const HOST_2 = `c2-${RUN}.sites.test`;
const BLANK_TEMPLATE_ID = 'c0a8e7d6-0000-4000-8000-000000000003';
/** A 1x1 PNG, uploaded as the template's asset. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const WELCOME = `Welcome to the template ${RUN}`;
const WELCOME_AR = `مرحبا بكم في القالب ${RUN}`;
const COMPONENT_TEXT = `From the component ${RUN}`;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

interface PageRow { id: string; name: string; slug: string; error_page: number | null; is_index: boolean }
interface IdRow { id: string; name?: string }
interface LocaleRow { id: string; code: string; is_default: boolean }
interface AssetRow { id: string; filename: string; storage_path: string | null; public_url: string | null }
interface TemplateRow {
  id: string;
  slug: string;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  page_count: number;
  languages: string[];
}
interface LayersRow { id: string; page_id: string; layers: unknown[] }

let baseURL: string;
let templates: APIRequestContext;
let orgA: APIRequestContext;
let template: SiteRecord;
let templatePages: PageRow[];
let templateHomepage: PageRow;
let templateAsset: AssetRow;
let templateComponent: IdRow;
let templateLocales: LocaleRow[];
let copy1: SiteRecord;
let copy1Pages: PageRow[];

async function json<T>(response: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await response;
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()).data as T;
}

const pagesOf = (api: APIRequestContext) => json<PageRow[]>(api.get('/ycode/api/pages'));
const componentsOf = (api: APIRequestContext) => json<IdRow[]>(api.get('/ycode/api/components'));
const assetsOf = (api: APIRequestContext) => json<AssetRow[]>(api.get('/ycode/api/assets'));
const localesOf = (api: APIRequestContext) => json<LocaleRow[]>(api.get('/ycode/api/locales'));
const layersOf = (api: APIRequestContext, pageId: string) => json<LayersRow>(api.get(`/ycode/api/layers?page_id=${pageId}&is_published=false`));

/**
 * HTML with every id (uuids, and the asset ids ycode encodes in image paths),
 * every row timestamp and the site's own name taken out, and without the
 * scripts (Next streams its React payload in an order that varies per
 * request), so two sites' renderings can be compared.
 */
function normalise(html: string, siteNames: string[]): string {
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(UUID, '<id>')
    .replace(/\/a\/[A-Za-z0-9_-]{22}\//g, '/a/<id>/')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<time>');
  for (const name of siteNames) out = out.split(name).join('<site>');
  return out;
}

function textLayer(id: string, content: string) {
  return { id, name: 'text', classes: '', settings: { tag: 'p' }, children: [], variables: { text: { type: 'dynamic_text', data: { content } } } };
}

test.beforeAll(async ({ baseURL: configured }) => {
  baseURL = configured!;
  templates = await signIn(baseURL, USER_T);
  orgA = await signIn(baseURL, USER_A);
});

test.afterAll(async () => {
  await templates?.dispose();
  await orgA?.dispose();
});

test('Templates lists TORCH\'s three templates for any organization, and needs manage_sites r', async () => {
  const list = await json<TemplateRow[]>(orgA.get('/ycode/api/platform/templates'));
  expect(list.map((t) => t.slug)).toEqual(['company-site', 'landing-page', 'blank']);
  for (const t of list) {
    expect(t.name.ar).not.toBe('');
    expect(t.name.en).not.toBe('');
    expect(t.description.ar).not.toBe('');
    expect(t.description.en).not.toBe('');
  }
  expect(list[2].id).toBe(BLANK_TEMPLATE_ID);
  expect(list[0].name).toEqual({ ar: 'موقع شركة', en: 'Company site' });
  // The meta line of the picker's cards (OPEN_QUESTIONS 22 and 34): a seeded template is a blank site, one homepage, the error pages not counted;
  // the seed makes English the default language, so it comes first.
  for (const t of list) {
    expect(t.page_count).toBe(1);
    expect(t.languages).toEqual(['en', 'ar']);
  }

  const contentOnly = await request.newContext({ baseURL });
  const anonymous = await request.newContext({ baseURL });
  try {
    const signedIn = await contentOnly.post('/ycode/api/auth/dev-login', { data: { ...USER_A, perms: { 'webstudio.manage_content': ['r', 'u'] } } });
    expect(signedIn.status()).toBe(200);
    expect((await contentOnly.get('/ycode/api/platform/templates')).status()).toBe(403);
    expect((await anonymous.get('/ycode/api/platform/templates')).status()).toBe(401);
  } finally {
    await contentOnly.dispose();
    await anonymous.dispose();
  }
});

test('the templates organization creates a template; another organization cannot, and a template has no hosts', async () => {
  const refused = await orgA.post('/ycode/api/platform/sites', { data: { name: 'Not mine', slug: `nm-${RUN}`, languages: ['en'], default_language: 'en', is_template: true } });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).details).toEqual(['is_template: not allowed for this organization']);

  const withHosts = await templates.post('/ycode/api/platform/sites', { data: { name: 'Hosted', slug: `h-${RUN}`, languages: ['en'], default_language: 'en', is_template: true, hosts: [`tpl-${RUN}.sites.test`] } });
  expect(withHosts.status()).toBe(400);
  expect((await withHosts.json()).details).toEqual(['hosts: a template has no hosts: it is never published on a host']);

  template = await createSite(templates, {
    name: 'Shop template',
    slug: `tpl-${RUN}`,
    languages: ['ar', 'en'],
    default_language: 'en',
    is_template: true,
    template: { name: { ar: 'قالب متجر' }, description: { en: 'For shops' } },
  });
  expect(template.organization_id).toBe(TEMPLATES_ORG);
  expect(template.is_template).toBe(true);
  expect(template.template).toEqual({ name: { ar: 'قالب متجر', en: 'Shop template' }, description: { ar: '', en: 'For shops' } });

  // Not even the default address every other site gets on creation (session 5): a template never answers on a host.
  expect(template.hosts).toEqual([]);
  const wouldBeAddress = await publishedSite(baseURL, `tpl-${RUN}.${TEST_SITES_DOMAIN}`);
  try {
    expect((await wouldBeAddress.get('/')).status()).toBe(404);
  } finally {
    await wouldBeAddress.dispose();
  }

  const list = await json<TemplateRow[]>(orgA.get('/ycode/api/platform/templates'));
  expect(list.map((t) => t.slug)).toEqual(['company-site', 'landing-page', 'blank', `tpl-${RUN}`]);
  expect(list[3]).toMatchObject({ id: template.id, name: { ar: 'قالب متجر', en: 'Shop template' }, description: { ar: '', en: 'For shops' } });

  // Nor through the settings API (session 7): renaming the template moves no address, and a custom host is refused.
  const renamed = await templates.patch(`/ycode/api/platform/sites/${template.id}/settings`, { data: { slug: `tpl2-${RUN}` } });
  expect(renamed.status(), await renamed.text()).toBe(200);
  expect((await renamed.json()).data.domain.hosts).toEqual([]);
  const hosted = await templates.patch(`/ycode/api/platform/sites/${template.id}/settings`, { data: { custom_host: `tpl-${RUN}.example.test` } });
  expect(hosted.status(), await hosted.text()).toBe(400);
  const renamedAddress = await publishedSite(baseURL, `tpl2-${RUN}.${TEST_SITES_DOMAIN}`);
  try {
    expect((await renamedAddress.get('/')).status()).toBe(404);
  } finally {
    await renamedAddress.dispose();
  }
});

test('the template gets three pages, a component, an asset, a style, a colour and a translation', async () => {
  expect((await openSite(templates, template.id)).status()).toBe(303);

  for (const page of [{ name: 'About', slug: 'about' }, { name: 'Contact', slug: 'contact' }]) {
    const created = await templates.post('/ycode/api/pages', { data: page });
    expect(created.ok(), await created.text()).toBe(true);
  }
  templatePages = await pagesOf(templates);
  expect(templatePages.filter((p) => p.error_page === null).map((p) => p.name).sort()).toEqual(['About', 'Contact', 'Homepage']);
  templateHomepage = templatePages.find((p) => p.is_index)!;
  // The list counts the three pages and not the three error pages beside them.
  const listed = (await json<TemplateRow[]>(orgA.get('/ycode/api/platform/templates'))).find((t) => t.id === template.id);
  expect(listed).toMatchObject({ page_count: 3, languages: ['en', 'ar'] });

  const uploaded = await templates.post('/ycode/api/assets', { multipart: { file: { name: 'pixel.png', mimeType: 'image/png', buffer: PNG }, source: 'file-manager' } });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  templateAsset = (await uploaded.json()).data as AssetRow;
  expect(templateAsset.storage_path).toBeTruthy();
  expect(templateAsset.public_url).toContain(`/platform-storage/${template.id}/assets/`);
  expect((await templates.get(templateAsset.public_url!)).status()).toBe(200);

  const colour = await templates.post('/ycode/api/color-variables', { data: { name: 'Brand', value: '#123456' } });
  expect(colour.ok(), await colour.text()).toBe(true);
  const colourId = ((await colour.json()).data as IdRow).id;

  const style = await templates.post('/ycode/api/layer-styles', { data: { name: 'Lead', classes: `text-[var(--${colourId})] text-[18px]` } });
  expect(style.ok(), await style.text()).toBe(true);
  const styleId = ((await style.json()).data as IdRow).id;

  const component = await templates.post('/ycode/api/components', {
    data: { name: 'Promo', layers: [{ id: 'cmp-root', name: 'div', classes: 'p-4', children: [textLayer('cmp-text', COMPONENT_TEXT)] }] },
  });
  expect(component.ok(), await component.text()).toBe(true);
  templateComponent = (await component.json()).data as IdRow;

  const homepageLayers = [
    {
      id: 'body', name: 'body', classes: '', children: [
        {
          id: 'hero', name: 'section', classes: 'p-8', children: [
            { ...textLayer('welcome', WELCOME), styleIds: [styleId] },
            {
              id: 'picture', name: 'image', classes: '', children: [],
              variables: { image: { src: { type: 'asset', data: { asset_id: templateAsset.id } }, alt: { type: 'dynamic_text', data: { content: 'Pixel' } } } },
            },
            { id: 'promo', name: 'component', classes: '', children: [], componentId: templateComponent.id },
          ],
        },
      ],
    },
  ];
  const saved = await templates.put(`/ycode/api/layers?page_id=${templateHomepage.id}`, { data: { layers: homepageLayers } });
  expect(saved.ok(), await saved.text()).toBe(true);

  templateLocales = await localesOf(templates);
  const arabic = templateLocales.find((l) => l.code === 'ar')!;
  const translation = await templates.post('/ycode/api/translations', {
    data: { locale_id: arabic.id, source_type: 'page', source_id: templateHomepage.id, content_key: 'layer:welcome:text', content_type: 'text', content_value: WELCOME_AR, is_completed: true },
  });
  expect(translation.ok(), await translation.text()).toBe(true);
});

test('a site created from the template in another organization has its content with new ids', async () => {
  copy1 = await createSite(orgA, { name: 'Copy One', slug: `c1-${RUN}`, languages: ['ar', 'en'], default_language: 'en', hosts: [HOST_1], template_id: template.id });
  expect(copy1.organization_id).toBe(ORG_A);
  expect(copy1.is_template).toBe(false);
  expect(copy1.default_locale).toBe('en');
  expect((await listSites(orgA)).map((s) => [s.id, s.status])).toContainEqual([copy1.id, 'draft']);

  expect((await openSite(orgA, copy1.id)).status()).toBe(303);

  copy1Pages = await pagesOf(orgA);
  const contentPages = copy1Pages.filter((p) => p.error_page === null);
  expect(contentPages.map((p) => p.name).sort()).toEqual(['About', 'Contact', 'Homepage']);
  expect(copy1Pages.filter((p) => p.error_page !== null).map((p) => p.error_page).sort()).toEqual([401, 404, 500]);
  const templateIds = new Set(templatePages.map((p) => p.id));
  for (const page of copy1Pages) expect(templateIds.has(page.id), `page ${page.name} keeps the template's id`).toBe(false);

  const components = await componentsOf(orgA);
  expect(components.map((c) => c.name)).toEqual(['Promo']);
  expect(components[0].id).not.toBe(templateComponent.id);

  const assets = await assetsOf(orgA);
  expect(assets.map((a) => a.filename)).toEqual([templateAsset.filename]);
  expect(assets[0].id).not.toBe(templateAsset.id);
  expect(assets[0].storage_path).toBe(templateAsset.storage_path);
  expect(assets[0].public_url).toContain(`/platform-storage/${copy1.id}/assets/`);
  const file = await orgA.get(assets[0].public_url!);
  expect(file.status()).toBe(200);
  const templateFile = await templates.get(templateAsset.public_url!); // the template keeps its own file
  expect(templateFile.status()).toBe(200);
  expect(Buffer.from(await file.body()).equals(Buffer.from(await templateFile.body()))).toBe(true);

  const homepage = copy1Pages.find((p) => p.is_index)!;
  const layers = JSON.stringify((await layersOf(orgA, homepage.id)).layers);
  expect(layers).toContain(`"componentId":"${components[0].id}"`);
  expect(layers).toContain(`"asset_id":"${assets[0].id}"`);
  expect(layers).not.toContain(templateComponent.id);
  expect(layers).not.toContain(templateAsset.id);

  const colours = await json<IdRow[]>(orgA.get('/ycode/api/color-variables'));
  expect(colours.map((c) => c.name)).toEqual(['Brand']);
  const styles = await json<Array<IdRow & { classes: string }>>(orgA.get('/ycode/api/layer-styles'));
  expect(styles.map((s) => s.name)).toEqual(['Lead']);
  expect(styles[0].classes).toContain(`var(--${colours[0].id})`);
  expect(layers).toContain(`"styleIds":["${styles[0].id}"]`);

  const locales = await localesOf(orgA);
  expect(locales.map((l) => l.code).sort()).toEqual(['ar', 'en']);
  expect(locales.find((l) => l.is_default)?.code).toBe('en');
  expect(locales.map((l) => l.id)).not.toContain(templateLocales.find((l) => l.code === 'ar')!.id);
  const translations = await json<Array<{ source_id: string; content_key: string; content_value: string }>>(orgA.get(`/ycode/api/translations?locale_id=${locales.find((l) => l.code === 'ar')!.id}`));
  expect(translations).toEqual([expect.objectContaining({ source_id: homepage.id, content_key: 'layer:welcome:text', content_value: WELCOME_AR })]);
});

test('the copy renders what the template renders, and shows it once published', async () => {
  const templatePreview = await templates.get('/ycode/preview');
  expect(templatePreview.status()).toBe(200);
  const copyPreview = await orgA.get('/ycode/preview');
  expect(copyPreview.status()).toBe(200);
  const templateHtml = await templatePreview.text();
  expect(templateHtml).toContain(WELCOME);
  expect(templateHtml).toContain(COMPONENT_TEXT);
  expect(normalise(await copyPreview.text(), ['Copy One'])).toBe(normalise(templateHtml, ['Shop template']));

  await publish(orgA);
  const site = await publishedSite(baseURL, HOST_1);
  try {
    const home = await site.get('/');
    expect(home.status()).toBe(200);
    const html = await home.text();
    expect(html).toContain(WELCOME);
    expect(html).toContain(COMPONENT_TEXT);
    expect(html).toContain('data-layer-id="picture"');
    expect(html).not.toContain(template.id);

    const arabic = await site.get('/ar');
    expect(arabic.status()).toBe(200);
    const arabicHtml = await arabic.text();
    expect(arabicHtml).toContain('dir="rtl"');
    expect(arabicHtml).toContain(WELCOME_AR);
    expect((await site.get('/about')).status()).toBe(200);
  } finally {
    await site.dispose();
  }
});

test('editing the template afterwards leaves the site unchanged, and the reverse', async () => {
  const templateAbout = templatePages.find((p) => p.name === 'About')!;
  expect((await templates.put(`/ycode/api/pages/${templateAbout.id}`, { data: { name: 'About (template)' } })).status()).toBe(200);
  expect((await templates.post('/ycode/api/pages', { data: { name: 'Team', slug: 'team' } })).status()).toBe(200);
  const edited = await templates.put(`/ycode/api/layers?page_id=${templateHomepage.id}`, { data: { layers: [{ id: 'body', name: 'body', classes: '', children: [textLayer('welcome', 'Changed in the template')] }] } });
  expect(edited.status()).toBe(200);

  const copyPagesNow = await pagesOf(orgA);
  expect(copyPagesNow.filter((p) => p.error_page === null).map((p) => p.name).sort()).toEqual(['About', 'Contact', 'Homepage']);
  const copyHomepage = copyPagesNow.find((p) => p.is_index)!;
  expect(JSON.stringify((await layersOf(orgA, copyHomepage.id)).layers)).toContain(WELCOME);
  expect(await (await orgA.get('/ycode/preview')).text()).toContain(WELCOME);

  const copyContact = copyPagesNow.find((p) => p.name === 'Contact')!;
  expect((await orgA.put(`/ycode/api/pages/${copyContact.id}`, { data: { name: 'Contact (copy)' } })).status()).toBe(200);
  expect((await orgA.delete(`/ycode/api/pages/${copyPagesNow.find((p) => p.name === 'About')!.id}`)).status()).toBe(200);

  const templatePagesNow = await pagesOf(templates);
  expect(templatePagesNow.filter((p) => p.error_page === null).map((p) => p.name).sort()).toEqual(['About (template)', 'Contact', 'Homepage', 'Team']);
  expect(JSON.stringify((await layersOf(templates, templateHomepage.id)).layers)).toContain('Changed in the template');
});

test('a second site takes the template as it is now; the first keeps what it was made from', async () => {
  const copy2 = await createSite(orgA, { name: 'Copy Two', slug: `c2-${RUN}`, languages: ['ar', 'en'], default_language: 'en', hosts: [HOST_2], template_id: template.id });
  expect((await openSite(orgA, copy2.id)).status()).toBe(303);
  await publish(orgA);

  // The template changed after copy 1 was made: copy 2 has the template as it is now.
  const second = await publishedSite(baseURL, HOST_2);
  try {
    const html = await (await second.get('/')).text();
    expect(html).toContain('Changed in the template');
    expect(html).not.toContain(WELCOME);
    expect((await second.get('/team')).status()).toBe(200);
  } finally {
    await second.dispose();
  }

  // And copy 1 still renders what it was made from.
  const first = await publishedSite(baseURL, HOST_1);
  try {
    expect(await (await first.get('/')).text()).toContain(WELCOME);
    expect((await first.get('/team')).status()).toBe(404);
  } finally {
    await first.dispose();
  }

  expect((await openSite(orgA, copy1.id)).status()).toBe(303);
});

test('creating with one language copies only that language', async () => {
  const english = await createSite(orgA, { name: 'Copy English', slug: `c3-${RUN}`, languages: ['en'], default_language: 'en', template_id: template.id });
  expect((await openSite(orgA, english.id)).status()).toBe(303);
  const locales = await localesOf(orgA);
  expect(locales.map((l) => l.code)).toEqual(['en']);
  expect(locales[0].is_default).toBe(true);
  expect((await pagesOf(orgA)).filter((p) => p.error_page === null).length).toBe(4);
  expect((await componentsOf(orgA)).length).toBe(1);
  expect((await assetsOf(orgA)).length).toBe(1);
});

test('creating blank, by the blank template or with no template, gives the homepage and the three error pages', async () => {
  for (const [slug, template_id] of [[`b1-${RUN}`, BLANK_TEMPLATE_ID], [`b2-${RUN}`, undefined]] as const) {
    const blank = await createSite(orgA, { name: 'Blank', slug, languages: ['ar', 'en'], default_language: 'en', template_id });
    expect((await openSite(orgA, blank.id)).status()).toBe(303);
    const pages = await pagesOf(orgA);
    expect(pages.filter((p) => p.error_page === null).map((p) => p.name)).toEqual(['Homepage']);
    expect(pages.filter((p) => p.error_page !== null).map((p) => p.error_page).sort()).toEqual([401, 404, 500]);
    expect(await componentsOf(orgA)).toEqual([]);
    expect(await assetsOf(orgA)).toEqual([]);
    expect((await localesOf(orgA)).map((l) => l.code).sort()).toEqual(['ar', 'en']);
  }
});

test('an unknown template, or a site that is not a template, is refused', async () => {
  const unknown = await orgA.post('/ycode/api/platform/sites', { data: { name: 'X', slug: `x1-${RUN}`, languages: ['en'], default_language: 'en', template_id: '3f0b2c7e-2d7a-4c3e-9a1e-7b1d2e3f4a5b' } });
  expect(unknown.status()).toBe(404);
  const ordinarySite = await orgA.post('/ycode/api/platform/sites', { data: { name: 'X', slug: `x2-${RUN}`, languages: ['en'], default_language: 'en', template_id: copy1.id } });
  expect(ordinarySite.status()).toBe(404);
  expect((await listSites(orgA)).map((s) => s.slug)).not.toContain(`x1-${RUN}`);
});

test('a site whose default language is not the template\'s reads each language from its own text (OPEN_QUESTIONS 24)', async () => {
  // The template's default is English with an Arabic welcome; this copy's default is Arabic. An earlier
  // test edited the template's welcome, which left its Arabic translation incomplete: complete it again.
  const englishNow = 'Changed in the template';
  expect((await openSite(templates, template.id)).status()).toBe(303);
  const templateArabic = (await localesOf(templates)).find((l) => l.code === 'ar')!;
  const refreshed = await templates.post('/ycode/api/translations/bulk', {
    data: { translations: [{ locale_id: templateArabic.id, source_type: 'page', source_id: templateHomepage.id, content_key: 'layer:welcome:text', content_type: 'text', content_value: WELCOME_AR, is_completed: true }] },
  });
  expect(refreshed.status(), await refreshed.text()).toBe(201);

  const slug = `c4-${RUN}`;
  const arabicFirst = await createSite(orgA, { name: 'Copy Arabic', slug, languages: ['ar', 'en'], default_language: 'ar', template_id: template.id });
  expect((await openSite(orgA, arabicFirst.id)).status()).toBe(303);
  const locales = await localesOf(orgA);
  expect(locales.find((l) => l.is_default)?.code).toBe('ar');
  const english = locales.find((l) => l.code === 'en')!;
  const englishRows = await json<Array<{ source_type: string; content_key: string; content_value: string }>>(orgA.get(`/ycode/api/translations?locale_id=${english.id}`));
  expect(englishRows).toEqual([expect.objectContaining({ source_type: 'page', content_key: 'layer:welcome:text', content_value: englishNow })]);

  await publish(orgA);
  const site = await publishedSite(baseURL, `${slug}.${TEST_SITES_DOMAIN}`);
  try {
    const root = await (await site.get('/')).text();
    expect(root).toContain('dir="rtl"');
    expect(root).toContain(WELCOME_AR);
    expect(root).not.toContain(englishNow);
    const en = await (await site.get('/en')).text();
    expect(en).toContain('dir="ltr"');
    expect(en).toContain(englishNow);
    expect(en).not.toContain(WELCOME_AR);
  } finally {
    await site.dispose();
  }

  // Arabic only: the template's English stays behind, the Arabic welcome is the text.
  const arabicOnlySlug = `c5-${RUN}`;
  const arabicOnly = await createSite(orgA, { name: 'Copy Arabic only', slug: arabicOnlySlug, languages: ['ar'], default_language: 'ar', template_id: template.id });
  expect((await openSite(orgA, arabicOnly.id)).status()).toBe(303);
  expect((await localesOf(orgA)).map((l) => l.code)).toEqual(['ar']);
  await publish(orgA);
  const only = await publishedSite(baseURL, `${arabicOnlySlug}.${TEST_SITES_DOMAIN}`);
  try {
    const root = await (await only.get('/')).text();
    expect(root).toContain(WELCOME_AR);
    expect(root).not.toContain(englishNow);
  } finally {
    await only.dispose();
  }
});

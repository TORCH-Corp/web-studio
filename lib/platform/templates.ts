/**
 * TORCH's templates (part 1, session 4).
 *
 * A template is a live site with `is_template` true in the TORCH templates
 * organization (env `WS_TEMPLATES_ORG`, a fixed uuid). Its content is built
 * in the builder by a user of that organization like any site; it is never
 * published on a host: lib/platform/site.ts leaves templates out of the host
 * lookup and the sites API refuses hosts on one. Creating a site from it
 * copies it (lib/platform/template-copy.ts); the blank template is
 * provisioning, not a copy.
 *
 * Part 1 has three templates, created by `pnpm templates:seed`
 * (scripts/seed-templates.ts) with fixed ids, so every environment and the
 * shell know each by the same id. Their content is built by hand (Task B);
 * the seed only gives them their names and descriptions.
 */

import { getKnexClient } from '@/lib/knex-client';
import { getSite, type Site } from '@/lib/platform/site';
import type { TemplateMeta } from '@/lib/platform/site-input';

export const TEMPLATES_ORG_ENV = 'WS_TEMPLATES_ORG';

/** The template whose "copy" is blank provisioning. */
export const BLANK_TEMPLATE_SLUG = 'blank';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function configuredTemplatesOrganization(): string | null {
  const id = process.env[TEMPLATES_ORG_ENV]?.trim().toLowerCase();
  return id && UUID_PATTERN.test(id) ? id : null;
}

/** The templates organization's id; an error when the environment does not name one. */
export function templatesOrganizationId(): string {
  const id = configuredTemplatesOrganization();
  if (!id) throw new Error(`${TEMPLATES_ORG_ENV} is not set to the uuid of the TORCH templates organization`);
  return id;
}

/** Whether this organization's sites can be templates. Nobody's are when the environment names none. */
export function isTemplatesOrganization(organizationId: string): boolean {
  const configured = configuredTemplatesOrganization();
  return configured !== null && configured === organizationId.toLowerCase();
}

/** A template as the Templates list shows it. */
export interface TemplateSummary extends TemplateMeta {
  id: string;
  slug: string;
  default_locale: string;
  created_at: string;
  /**
   * The pages a site made from it starts with (part 2 release fixes,
   * OPEN_QUESTIONS 22 and 34): its draft pages, the error pages left out, as
   * the builder's Pages list shows them. The cards read "5 pages · Arabic ·
   * English".
   */
  page_count: number;
  /** The language codes it has, the default one first. */
  languages: string[];
}

/** A template's languages: its locale codes, the default one first and the others by code, each once. */
export function templateLanguages(locales: ReadonlyArray<{ code: string; is_default: boolean }>): string[] {
  const codes = Array.from(new Set(locales.map((locale) => locale.code)));
  const defaults = new Set(locales.filter((locale) => locale.is_default).map((locale) => locale.code));
  return codes.sort((a, b) => Number(defaults.has(b)) - Number(defaults.has(a)) || (a < b ? -1 : a > b ? 1 : 0));
}

/** TORCH's live templates, oldest first; the same for every organization. */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const knex = await getKnexClient();
  const rows = (await knex('platform_sites')
    .select('id', 'slug', 'name', 'template', 'default_locale', 'created_at')
    .where({ organization_id: templatesOrganizationId(), is_template: true })
    .whereNull('deleted_at')
    .orderBy('created_at', 'asc')) as Array<Pick<Site, 'id' | 'slug' | 'name' | 'template' | 'default_locale' | 'created_at'>>;
  const ids = rows.map((row) => row.id);
  // A template's content is under its own site id (tenant_id), as any site's is: the draft rows, not the published twins.
  const [pageCounts, locales] = ids.length
    ? await Promise.all([
        knex('pages')
          .select('tenant_id')
          .count({ count: '*' })
          .whereIn('tenant_id', ids)
          .where({ is_published: false })
          .whereNull('deleted_at')
          .whereNull('error_page')
          .groupBy('tenant_id') as Promise<Array<{ tenant_id: string; count: string | number }>>,
        knex('locales')
          .select('tenant_id', 'code', 'is_default')
          .whereIn('tenant_id', ids)
          .where({ is_published: false })
          .whereNull('deleted_at') as Promise<Array<{ tenant_id: string; code: string; is_default: boolean }>>,
    ])
    : [[], []];
  const pagesOf = new Map(pageCounts.map((row) => [row.tenant_id, Number(row.count)]));
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.template?.name ?? { ar: row.name, en: row.name },
    description: row.template?.description ?? { ar: '', en: '' },
    default_locale: row.default_locale,
    created_at: row.created_at,
    page_count: pagesOf.get(row.id) ?? 0,
    languages: templateLanguages(locales.filter((locale) => locale.tenant_id === row.id)),
  }));
}

/** A live template by id: a template site of the templates organization; null for anything else. */
export async function getTemplate(id: string): Promise<Site | null> {
  const site = await getSite(id);
  return site && site.is_template && isTemplatesOrganization(site.organization_id) ? site : null;
}

export function isBlankTemplate(template: Site): boolean {
  return template.slug === BLANK_TEMPLATE_SLUG;
}

/** One of part 1's templates as the seed creates it. */
export interface TemplateSeed {
  id: string;
  slug: string;
  /** The site's name in the builder. */
  name: string;
  meta: TemplateMeta;
}

/** The three templates of part 1 (PRD V1.0 "Templates"), with fixed ids. */
export const PART_1_TEMPLATES: readonly TemplateSeed[] = [
  {
    id: 'c0a8e7d6-0000-4000-8000-000000000001',
    slug: 'company-site',
    name: 'Company site',
    meta: {
      name: { ar: 'موقع شركة', en: 'Company site' },
      description: {
        ar: 'موقع متعدد الصفحات لشركة: الرئيسية، من نحن، الخدمات، اتصل بنا.',
        en: 'A multi-page site for a business: home, about, services, contact.',
      },
    },
  },
  {
    id: 'c0a8e7d6-0000-4000-8000-000000000002',
    slug: 'landing-page',
    name: 'Landing page',
    meta: {
      name: { ar: 'صفحة هبوط', en: 'Landing page' },
      description: {
        ar: 'صفحة واحدة لحملة أو عرض، مع دعوة إلى إجراء.',
        en: 'One page for a campaign or an offer, with a call to action.',
      },
    },
  },
  {
    id: 'c0a8e7d6-0000-4000-8000-000000000003',
    slug: BLANK_TEMPLATE_SLUG,
    name: 'Blank',
    meta: {
      name: { ar: 'فارغ', en: 'Blank' },
      description: {
        ar: 'موقع فارغ: صفحة رئيسية وصفحات الخطأ.',
        en: 'An empty site: a homepage and the error pages.',
      },
    },
  },
];

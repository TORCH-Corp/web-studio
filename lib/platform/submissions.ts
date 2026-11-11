/**
 * A site's form submissions for the Tauri app (part 3, session W4; PRD V1.0
 * "Submissions in Web Studio"): list, read, delete, the forms for the list's
 * filter and the unread counts. The rules and the shapes are
 * lib/platform/submissions-view.ts; this file asks the database.
 *
 * A submission is ycode's `form_submissions` row under its site (`tenant_id` is
 * the site id), joined to `platform_form_links` (W3) for what became of it in
 * Contact Center. The app has no site cookie (taking one takes the site's editor
 * lock), so everything is by site id, as lib/platform/collections.ts reads a
 * site's collections: the caller has checked that the site is the session's
 * organization's, and every statement here names the site, so a submission of
 * another site is never found.
 *
 * Spam is stored for review (the submit route) and is not a submission of the
 * app: it is never listed, counted, read or deleted here.
 *
 * Not selected, so never answered: the row's `metadata` (the visitor's IP
 * address, user agent, referrer and page URL).
 */

import type { Knex } from 'knex';
import { getKnexClient } from '@/lib/knex-client';
import type { Site } from '@/lib/platform/site';
import {
  encodeCursor,
  formChoices,
  formsOfLayers,
  submissionDetailView,
  submissionRow,
  type FormInfo,
  type FormLayer,
  type SubmissionDetailView,
  type SubmissionRecord,
  type SubmissionRowView,
  type SubmissionsQuery,
} from '@/lib/platform/submissions-view';

/** Every form layer, at any depth of a layer tree. */
const FORMS_PATH = 'strict $.** ? (@.name == "form")';

/** `created_at` as text to the microsecond, in UTC: the cursor compares it back exactly, which a JavaScript date (milliseconds) could not. */
const CREATED_AT_TEXT = `to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * The forms the site's layers hold, from its pages (published and draft) and its components (a form in a
 * component is stored there, not in the page). The page's own row must be live; the site is `tenant_id`.
 */
export async function formsOfSite(siteId: string): Promise<Map<string, FormInfo>> {
  const knex = await getKnexClient();
  const result = await knex.raw(
    `SELECT forms.form, forms.published FROM (
       SELECT jsonb_path_query(layers.layers, ?::jsonpath) AS form, layers.is_published AS published
       FROM page_layers layers
       JOIN pages ON pages.id = layers.page_id AND pages.is_published = layers.is_published AND pages.deleted_at IS NULL AND pages.tenant_id = layers.tenant_id
       WHERE layers.tenant_id = ?::uuid AND layers.deleted_at IS NULL
       UNION ALL
       SELECT jsonb_path_query(components.layers, ?::jsonpath) AS form, components.is_published AS published
       FROM components
       WHERE components.tenant_id = ?::uuid AND components.deleted_at IS NULL
     ) forms`,
    [FORMS_PATH, siteId, FORMS_PATH, siteId],
  );
  const rows = (result as { rows: Array<{ form: FormLayer; published: boolean }> }).rows;
  return formsOfLayers(rows.map((row) => ({ published: row.published, layer: row.form })));
}

/** The submissions of the site that the app may see, with their links. Not async: a knex builder is a thenable, and awaiting it would run it. */
function selectSubmissions(knex: Knex, siteId: string) {
  return knex('form_submissions as s')
    .leftJoin('platform_form_links as l', 'l.submission_id', 's.id')
    .where('s.tenant_id', siteId)
    .whereNot('s.status', 'spam')
    .select('s.id', 's.form_id', 's.payload', 's.status', knex.raw(`${CREATED_AT_TEXT} AS created_at`), 'l.state as link_state', 'l.contact_center_id as link_contact_center_id');
}

/** One page of the site's submissions, newest first; `nextCursor` is null on the last page. */
export async function listSubmissions(site: Site, query: SubmissionsQuery): Promise<{ rows: SubmissionRowView[]; nextCursor: string | null }> {
  const select = selectSubmissions(await getKnexClient(), site.id);
  if (query.formId) select.where('s.form_id', query.formId);
  if (query.unread === true) select.where('s.status', 'new');
  if (query.unread === false) select.whereNot('s.status', 'new');
  if (query.cursor) select.whereRaw('(s.created_at, s.id) < (?::timestamptz, ?::uuid)', [query.cursor.at, query.cursor.id]);
  const found = (await select.orderBy([{ column: 's.created_at', order: 'desc' }, { column: 's.id', order: 'desc' }]).limit(query.limit + 1)) as SubmissionRecord[];

  const page = found.slice(0, query.limit);
  const forms = await formsOfSite(site.id);
  const last = page[page.length - 1];
  return {
    rows: page.map((record) => submissionRow(record, forms)),
    nextCursor: found.length > query.limit && last ? encodeCursor({ at: last.created_at, id: last.id }) : null,
  };
}

let warnedAboutLinks = false;

/** One submission with every field the visitor sent. Reading it sets it 'read'. Null when the site has no such submission (spam is none). */
export async function readSubmission(site: Site, submissionId: string): Promise<SubmissionDetailView | null> {
  const knex = await getKnexClient();
  await knex('form_submissions').where({ id: submissionId, tenant_id: site.id, status: 'new' }).update({ status: 'read' });
  const record = (await selectSubmissions(knex, site.id).where('s.id', submissionId).first()) as SubmissionRecord | undefined;
  if (!record) return null;
  const view = submissionDetailView(record, await formsOfSite(site.id));
  if (view.contact_center.id && !view.links.open_in_contact_center && !warnedAboutLinks) {
    warnedAboutLinks = true;
    console.warn('[submissions] CONTACT_CENTER_APP_ID is not set: a submission\'s deep link into Contact Center is null, so the app cannot offer it');
  }
  return view;
}

/**
 * Delete a submission of the site. Its link row goes with it (the table's foreign key cascades); Contact Center is
 * never asked: the prospect or contact it became is Contact Center's. False when the site has no such submission.
 */
export async function deleteSubmission(site: Site, submissionId: string): Promise<boolean> {
  const knex = await getKnexClient();
  const removed = await knex('form_submissions').where({ id: submissionId, tenant_id: site.id }).whereNot('status', 'spam').delete().returning('id');
  return removed.length > 0;
}

/** The site's forms for the list's filter: those in its layers, and any form that has submissions. */
export async function listSiteForms(site: Site): Promise<Array<{ id: string; name: string }>> {
  const knex = await getKnexClient();
  const [forms, submitted] = await Promise.all([
    formsOfSite(site.id),
    knex('form_submissions').where('tenant_id', site.id).whereNot('status', 'spam').distinct('form_id').pluck('form_id') as Promise<string[]>,
  ]);
  return formChoices(forms, submitted);
}

/** The unread submissions of the organization and of each of its live sites (a site with none counts 0), oldest site first. */
export async function unreadCounts(organizationId: string): Promise<{ count: number; sites: Array<{ id: string; count: number }> }> {
  const knex = await getKnexClient();
  const rows = (await knex('platform_sites as s')
    .leftJoin('form_submissions as f', function joinUnread() {
      this.on('f.tenant_id', '=', 's.id').andOn(knex.raw("f.status = 'new'"));
    })
    .where('s.organization_id', organizationId)
    .whereNull('s.deleted_at')
    .groupBy('s.id')
    .orderBy('s.created_at', 'asc')
    .select('s.id', knex.raw('count(f.id)::int AS count'))) as Array<{ id: string; count: number }>;
  return { count: rows.reduce((sum, row) => sum + row.count, 0), sites: rows.map((row) => ({ id: row.id, count: row.count })) };
}

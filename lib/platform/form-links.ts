/**
 * A submission's link to Contact Center, in the database (part 3, session W3;
 * PRD V1.0 "Forms", "Prospects"). The rules are lib/platform/form-prospect.ts;
 * the table is database/migrations/20261111000002_torch_form_links.ts.
 *
 * The submit route calls `publishedSwitch` (is the form's switch on, as the
 * site was published) and, once the submission is stored, `linkSubmission`:
 * one row, and for a form with the switch on one call to Contact Center that
 * is given FIRST_ATTEMPT_TIMEOUT_MS. A call that fails or is too slow leaves
 * the row 'waiting'; `retryWaitingLinks` (lib/platform/form-link-retry.ts runs
 * it) asks again, each row after its own growing delay.
 */

import { getKnexClient } from '@/lib/knex-client';
import { ContactCenterUnavailableError, findOrCreateProspect } from '@/lib/platform/contact-center';
import {
  RETRY_BASE_SECONDS,
  RETRY_CEILING_SECONDS,
  createsProspect,
  firstLinkState,
  linkFromAnswer,
  parseProspectFields,
  type FormLinkState,
  type ProspectInput,
  type PublishedSwitch,
} from '@/lib/platform/form-prospect';

const TABLE = 'platform_form_links';

/** How long the visitor's answer waits on Contact Center; a slower answer is the retry's. */
export const FIRST_ATTEMPT_TIMEOUT_MS = 3_000;
/** The retry is nobody's wait. */
const RETRY_TIMEOUT_MS = 10_000;
/** Waiting rows taken by one run. */
const RETRY_BATCH = 20;

/** Every form layer with this form id, anywhere in a tree of layers. */
const FORMS_PATH = 'strict $.** ? (@.name == "form" && @.settings.id == $form)';

/**
 * What the site's published layers say about a form: its pages as they were
 * published, and its published components (a form inside a component is
 * stored there, not in the page).
 */
export async function publishedSwitch(siteId: string, formId: string, layerId: string | null): Promise<PublishedSwitch> {
  const knex = await getKnexClient();
  const variables = JSON.stringify({ form: formId });
  const result = await knex.raw(
    `SELECT form->>'id' AS id, form->'settings'->'form' AS settings FROM (
       SELECT jsonb_path_query(layers.layers, ?::jsonpath, ?::jsonb) AS form
       FROM page_layers layers
       JOIN pages ON pages.id = layers.page_id AND pages.is_published = true AND pages.deleted_at IS NULL AND pages.tenant_id = layers.tenant_id
       WHERE layers.tenant_id = ?::uuid AND layers.is_published = true AND layers.deleted_at IS NULL
       UNION ALL
       SELECT jsonb_path_query(components.layers, ?::jsonpath, ?::jsonb) AS form
       FROM components
       WHERE components.tenant_id = ?::uuid AND components.is_published = true AND components.deleted_at IS NULL
     ) forms`,
    [FORMS_PATH, variables, siteId, FORMS_PATH, variables, siteId],
  );
  const forms = (result as { rows: Array<{ id: string; settings: { create_prospect?: boolean; form_type?: string } | null }> }).rows.map((row) => ({
    id: row.id,
    on: createsProspect({ id: row.id, name: 'form', settings: { form: row.settings ?? undefined } }),
  }));
  const named = layerId ? forms.filter((form) => form.id === layerId) : [];
  return { named: named.length > 0, namedOn: named.some((form) => form.on), anyOn: forms.some((form) => form.on) };
}

/** Ask Contact Center for a waiting row's record and set the row; 'waiting' when it could not be asked. */
async function ask(organizationId: string, submissionId: string, prospect: ProspectInput, timeoutMs: number): Promise<FormLinkState> {
  let answer;
  try {
    answer = await findOrCreateProspect(organizationId, prospect, timeoutMs);
  } catch (error) {
    if (!(error instanceof ContactCenterUnavailableError)) throw error;
    console.warn(`[form link] submission ${submissionId} waits: ${error.message}`);
    return 'waiting';
  }
  const { state, recordId } = linkFromAnswer(answer);
  const knex = await getKnexClient();
  await knex(TABLE).where({ submission_id: submissionId, state: 'waiting' }).update({ state, contact_center_id: recordId });
  return state;
}

/**
 * The link of a submission that was just stored. `prospect` is what Contact
 * Center is asked with, null when the form's switch is off.
 */
export async function linkSubmission(
  site: { id: string; organization_id: string },
  submission: { id: string; spam: boolean },
  prospect: ProspectInput | null,
): Promise<FormLinkState> {
  const first = firstLinkState({ spam: submission.spam, switchOn: prospect !== null });
  const knex = await getKnexClient();
  await knex(TABLE).insert({
    submission_id: submission.id,
    site_id: site.id,
    state: first,
    attempts: first === 'waiting' ? 1 : 0,
    last_attempt_at: first === 'waiting' ? knex.fn.now() : null,
  });
  if (first === 'stored' || !prospect) return 'stored';
  return ask(site.organization_id, submission.id, prospect, FIRST_ATTEMPT_TIMEOUT_MS);
}

/**
 * One retry run: the waiting rows of live sites whose delay has passed
 * (retryDelaySeconds, written here in SQL), oldest attempt first. A row is
 * taken by counting its attempt, with SKIP LOCKED, so two runs at once (two
 * processes of the service) never ask for the same row.
 */
export async function retryWaitingLinks(): Promise<{ taken: number; set: number }> {
  const knex = await getKnexClient();
  const claimed = await knex.raw(
    `UPDATE ${TABLE} link SET attempts = link.attempts + 1, last_attempt_at = now()
     WHERE link.submission_id IN (
       SELECT due.submission_id FROM ${TABLE} due
       WHERE due.state = 'waiting'
         AND (due.last_attempt_at IS NULL
           OR due.last_attempt_at + make_interval(secs => LEAST(?::float8 * power(2, LEAST(GREATEST(due.attempts - 1, 0), 30)), ?::float8)) <= now())
         AND EXISTS (SELECT 1 FROM platform_sites site WHERE site.id = due.site_id AND site.deleted_at IS NULL)
       ORDER BY due.last_attempt_at NULLS FIRST
       LIMIT ?
       FOR UPDATE SKIP LOCKED
     )
     RETURNING link.submission_id`,
    [RETRY_BASE_SECONDS, RETRY_CEILING_SECONDS, RETRY_BATCH],
  );
  const ids = (claimed as { rows: Array<{ submission_id: string }> }).rows.map((row) => row.submission_id);
  if (ids.length === 0) return { taken: 0, set: 0 };

  const rows = (await knex('form_submissions as submission')
    .join('platform_sites as site', 'site.id', 'submission.tenant_id')
    .whereIn('submission.id', ids)
    .select('submission.id', 'submission.payload', 'site.organization_id', 'site.default_locale')) as Array<{
    id: string;
    payload: Record<string, unknown>;
    organization_id: string;
    default_locale: string;
  }>;

  let set = 0;
  for (const row of rows) {
    const parsed = parseProspectFields(row.payload ?? {}, row.default_locale === 'ar' ? 'ar' : 'en');
    if (!parsed.ok) {
      // The route stores a submission of such a form only when both fields hold, so this is a payload changed since.
      console.error(`[form link] submission ${row.id} waits but holds no name or no Iraqi phone (${Object.keys(parsed.fields).join(', ')}); Contact Center is not asked`);
      continue;
    }
    if ((await ask(row.organization_id, row.id, parsed.value, RETRY_TIMEOUT_MS)) !== 'waiting') set += 1;
  }
  return { taken: ids.length, set };
}

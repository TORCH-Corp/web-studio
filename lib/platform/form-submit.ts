/**
 * What the submit route asks before it stores a submission (part 3, session
 * W3): which site the request is for and whether its form creates a prospect.
 *
 * The switch is the published form's (lib/platform/form-links.ts,
 * `publishedSwitch`), found by the form id and the layer id the body names.
 * Nothing in the body can turn it on or off: a body that claims the switch,
 * or names a layer that is not published, changes nothing (`switchIsOn`).
 *
 * With the switch on, the name and the phone are checked again here, as the
 * page checked them (`parseProspectFields`): a submission that breaks a rule
 * is refused with the message for each field, in the page's language, and is
 * not stored. Spam is never checked and never sent: it is stored for review
 * and answered like a success.
 */

import { publishedSwitch } from '@/lib/platform/form-links';
import { parseProspectFields, prospectLocale, switchIsOn, type ProspectField, type ProspectInput } from '@/lib/platform/form-prospect';
import { getSite, resolveSiteId, type Site } from '@/lib/platform/site';

export type SubmissionPlan =
  /** Store it; `prospect` is what Contact Center is asked with, null when it is not asked. */
  | { ok: true; site: Site | null; prospect: ProspectInput | null }
  /** Refuse it: the required fields that break a rule. */
  | { ok: false; fields: Partial<Record<ProspectField, string>> };

export async function planSubmission(
  body: { form_id?: unknown; layer_id?: unknown; locale?: unknown },
  payload: Record<string, unknown>,
  spam: boolean,
): Promise<SubmissionPlan> {
  const siteId = await resolveSiteId();
  const site = siteId ? await getSite(siteId) : null;
  if (!site || spam) return { ok: true, site, prospect: null };

  const found = await publishedSwitch(site.id, String(body.form_id), typeof body.layer_id === 'string' ? body.layer_id : null);
  if (!switchIsOn(found)) return { ok: true, site, prospect: null };

  const parsed = parseProspectFields(payload, prospectLocale(body.locale, site.default_locale));
  return parsed.ok ? { ok: true, site, prospect: parsed.value } : { ok: false, fields: parsed.fields };
}

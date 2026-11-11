/**
 * The Business OS notification a new form submission raises (part 3, session
 * W5; PRD V1.0 "Notification"): the members of the site's organization who hold
 * `r` on `webstudio.manage_forms` are told, through Notification Center, that
 * a visitor sent a form.
 *
 * Who is told is chosen the way Sales chooses for a storefront order
 * (`storefrontOrderRecipients` in sales-service): no service lists the holders
 * of a flag, so the organization's first RECIPIENT_CAP members are read and
 * auth-service's evaluate is asked about each, RECIPIENT_CONCURRENCY at a
 * time. A site's own members cannot be asked either (no service-key read gives
 * them), so the holders are the organization's. A member whose check failed is
 * logged and left out; more members than the cap is logged.
 *
 * The text is English, as Sales's is: no service gives a recipient's language
 * (PRD V1.0 Out of Scope). The form is named as the app's list names it (its
 * custom name, else its id), so the words match what the user opens. The notification opens the submission in the Web
 * Studio app by its own deep link, `torch://app/<WS_APP_ID>/…`, the form the
 * shell opens (Orders uses it for the same app).
 *
 * Best effort, as the notification itself: the submission is already stored
 * and the visitor already answered, so nothing here throws; what could not be
 * done is logged. Kept free of Next imports so it runs under `node --test`.
 */

import { mapLimit } from '@/lib/platform/map-limit';
import type { Notification, NotifyResult } from '@/lib/platform/notification';

/** The permission whose `r` flag lets a user read submissions. */
const FORMS_LEAF = 'webstudio.manage_forms';

/** The most members the recipients are chosen from. */
export const RECIPIENT_CAP = 200;
/** How many of those members auth-service is asked about at the same time. */
export const RECIPIENT_CONCURRENCY = 5;

/** A name, a form or a site is cut to this many characters in the text, so the body stays short whatever the visitor typed. */
const PART_MAX = 80;

export interface NotificationLog {
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLog: NotificationLog = {
  warn: (message) => console.warn(`[web-studio submission notification] ${message}`),
  error: (message) => console.error(`[web-studio submission notification] ${message}`),
};

/** Control characters and runs of spaces become one space; a value that is only spaces is empty. */
function tidy(value: string): string {
  return value.replace(/[\p{Cc}\s]+/gu, ' ').trim();
}

function clip(value: string): string {
  const characters = Array.from(value);
  return characters.length > PART_MAX ? `${characters.slice(0, PART_MAX - 1).join('')}…` : value;
}

/** The name the visitor typed in the form's `name` field, tidied; null when the form has none or it is not text. */
export function senderNameOf(payload: Record<string, unknown>): string | null {
  const name = typeof payload.name === 'string' ? tidy(payload.name) : '';
  return name || null;
}

/** The text of the notification; a visitor who gave no name is "A visitor". */
export function submissionNotificationText(parts: { senderName: string | null; formName: string; siteName: string }): { title: string; body: string } {
  const sender = clip(tidy(parts.senderName ?? '')) || 'A visitor';
  return { title: 'New form submission', body: `${sender} sent ${clip(tidy(parts.formName))} on ${clip(tidy(parts.siteName))}.` };
}

/**
 * The link that opens the submission in the Web Studio app: its Contact form
 * screen inside the site, `/sites/<site>/contact-form/<submission>`. Null
 * without the app's catalogue id: there is no link the shell can open.
 */
export function submissionLink(appId: string | undefined, siteId: string, submissionId: string): string | null {
  const app = appId?.trim();
  return app ? `torch://app/${app}/sites/${siteId}/contact-form/${submissionId}` : null;
}

export interface ReaderPorts {
  /** The organization's first `limit` member ids, and whether there are more. */
  listMemberIds(organizationId: string, limit: number): Promise<{ ids: string[]; hasMore: boolean }>;
  /** Whether the member holds the flag; throws when auth-service could not be asked. */
  holds(organizationId: string, userId: string, leafKey: string, flag: string): Promise<boolean>;
  log: Pick<NotificationLog, 'warn'>;
}

/** The members who hold `r` on the forms leaf. A members read that failed throws; a member whose check failed is logged and left out. */
export async function findSubmissionReaders(organizationId: string, ports: ReaderPorts): Promise<string[]> {
  const members = await ports.listMemberIds(organizationId, RECIPIENT_CAP);
  if (members.hasMore) {
    ports.log.warn(`The organization ${organizationId} has more members than ${RECIPIENT_CAP}, so the rest were not asked and cannot be notified`);
  }
  const verdicts = await mapLimit(members.ids, RECIPIENT_CONCURRENCY, async (userId) => {
    try {
      return await ports.holds(organizationId, userId, FORMS_LEAF, 'r');
    } catch (error) {
      ports.log.warn(`Member ${userId} of ${organizationId}: the permission check failed, so they are not notified: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  });
  return members.ids.filter((_, index) => verdicts[index]);
}

export interface NotificationPorts {
  /** Web Studio's catalogue app id (WS_APP_ID), for the link. */
  appId: string | undefined;
  /** The form's name as the app shows it (its custom name, else its id); throws when it could not be read. */
  formName(siteId: string, formId: string): Promise<string>;
  readers(organizationId: string): Promise<string[]>;
  send(organizationId: string, notification: Notification): Promise<NotifyResult>;
  log: NotificationLog;
}

/**
 * Tells the readers of the forms leaf that the site's form got a submission.
 * Never throws: whatever could not be done is logged, with the submission's id.
 */
export async function notifyNewSubmission(
  submission: { id: string; form_id: string; payload: Record<string, unknown> },
  site: { id: string; organization_id: string; name: string },
  ports: NotificationPorts,
): Promise<void> {
  try {
    const target = submissionLink(ports.appId, site.id, submission.id);
    if (!target) {
      ports.log.error(`Submission ${submission.id}: WS_APP_ID is not set, so the notification has no link the shell can open and was not sent`);
      return;
    }
    const userIds = await ports.readers(site.organization_id);
    if (userIds.length === 0) return;
    const formId = String(submission.form_id);
    let formName = formId;
    try {
      formName = await ports.formName(site.id, formId);
    } catch (error) {
      ports.log.warn(`Submission ${submission.id}: the name of form ${formId} could not be read, so its id is used: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = submissionNotificationText({ senderName: senderNameOf(submission.payload), formName, siteName: site.name });
    const result = await ports.send(site.organization_id, { userIds, ...text, target });
    for (const failure of result.failed) {
      ports.log.warn(`Submission ${submission.id}: the notification was not sent to user ${failure.userId}: ${failure.error}`);
    }
  } catch (error) {
    ports.log.error(`Submission ${submission.id}: the notification was not sent: ${error instanceof Error ? error.message : String(error)}`);
  }
}

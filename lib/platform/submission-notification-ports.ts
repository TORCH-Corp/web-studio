/**
 * The ports of the new-submission notification over the platform (part 3,
 * session W5): Organization Setup's members and permission check, Notification
 * Center, and the site's own forms for the name the app shows. Apart from
 * lib/platform/submission-notification.ts because `formsOfSite` asks the
 * database, and that file stays free of it so it runs under `node --test`.
 */

import { listMemberIds, userHolds } from '@/lib/platform/org-setup';
import { sendNotification } from '@/lib/platform/notification';
import { formsOfSite } from '@/lib/platform/submissions';
import { consoleLog, findSubmissionReaders, type NotificationLog, type NotificationPorts } from '@/lib/platform/submission-notification';

/** The ports over the platform, from the environment. */
export function platformNotificationPorts(env: Record<string, string | undefined> = process.env, log: NotificationLog = consoleLog): NotificationPorts {
  return {
    appId: env.WS_APP_ID,
    formName: async (siteId, formId) => (await formsOfSite(siteId)).get(formId)?.name ?? formId,
    readers: (organizationId) =>
      findSubmissionReaders(organizationId, {
        listMemberIds: (organization, limit) => listMemberIds(organization, limit, env),
        holds: (organization, userId, leafKey, flag) => userHolds(organization, userId, leafKey, flag, env),
        log,
      }),
    send: (organizationId, notification) => sendNotification(organizationId, notification, env),
    log,
  };
}

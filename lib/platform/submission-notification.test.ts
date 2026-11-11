import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RECIPIENT_CAP,
  RECIPIENT_CONCURRENCY,
  findSubmissionReaders,
  notifyNewSubmission,
  senderNameOf,
  submissionLink,
  submissionNotificationText,
  type NotificationPorts,
} from './submission-notification';
import { OrgSetupUnavailableError } from './org-setup';
import { NotificationUnavailableError } from './notification';

const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const SITE = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
const SUBMISSION = '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c';
const APP = '7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d';
const USER_A = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const USER_B = '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b';
const USER_C = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
const USER_D = '3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d';

const SITE_ROW = { id: SITE, organization_id: ORG, name: 'Al Noor Trading' };
const SUBMISSION_ROW = { id: SUBMISSION, form_id: 'Contact form', payload: { name: 'Sara Ali', phone: '07701234567', message: 'Hello' } };

interface Logged {
  level: 'warn' | 'error';
  message: string;
}

function ports(overrides: Partial<NotificationPorts> = {}): { ports: NotificationPorts; logged: Logged[]; sent: Array<{ organizationId: string; userIds: string[]; title: string; body: string; target: string }> } {
  const logged: Logged[] = [];
  const sent: Array<{ organizationId: string; userIds: string[]; title: string; body: string; target: string }> = [];
  const base: NotificationPorts = {
    appId: APP,
    readers: async () => [USER_A, USER_B],
    send: async (organizationId, notification) => {
      sent.push({ organizationId, ...notification });
      return { notified: notification.userIds, failed: [] };
    },
    log: {
      warn: (message) => logged.push({ level: 'warn', message }),
      error: (message) => logged.push({ level: 'error', message }),
    },
  };
  return { ports: { ...base, ...overrides }, logged, sent };
}

test('the notification is in English: the title, and who sent which form on which site', () => {
  assert.deepEqual(submissionNotificationText({ senderName: 'Sara Ali', formName: 'Contact form', siteName: 'Al Noor Trading' }), {
    title: 'New form submission',
    body: 'Sara Ali sent Contact form on Al Noor Trading.',
  });
});

test('a visitor who gave no name is "A visitor", never an empty gap', () => {
  assert.equal(submissionNotificationText({ senderName: null, formName: 'Contact form', siteName: 'Al Noor Trading' }).body, 'A visitor sent Contact form on Al Noor Trading.');
});

test('a very long name is cut with an ellipsis so the body stays short', () => {
  const long = 'a'.repeat(300);
  const { body } = submissionNotificationText({ senderName: long, formName: long, siteName: long });
  assert.equal(body, `${'a'.repeat(79)}… sent ${'a'.repeat(79)}… on ${'a'.repeat(79)}….`);
});

test('the sender is the name the visitor typed, spaces tidied; no name, a blank name or a name that is not text is none', () => {
  assert.equal(senderNameOf({ name: '  Sara   Ali ' }), 'Sara Ali');
  assert.equal(senderNameOf({ name: '   ' }), null);
  assert.equal(senderNameOf({ name: 42 }), null);
  assert.equal(senderNameOf({ name: ['Sara'] }), null);
  assert.equal(senderNameOf({ email: 'sara@example.com' }), null);
});

test('control characters and line breaks in what a visitor typed never reach the text: they become one space', () => {
  assert.equal(senderNameOf({ name: 'Sara\u0000\nAli\t\u007f Hassan' }), 'Sara Ali Hassan');
  assert.equal(submissionNotificationText({ senderName: 'Sara', formName: 'contact\r\nform', siteName: 'Al\u0000Noor' }).body, 'Sara sent contact form on Al Noor.');
});

test('the link opens the submission in Web Studio by the app deep link, and is null without the app id', () => {
  assert.equal(submissionLink(APP, SITE, SUBMISSION), `torch://app/${APP}/sites/${SITE}/contact-form/${SUBMISSION}`);
  assert.equal(submissionLink(` ${APP} `, SITE, SUBMISSION), `torch://app/${APP}/sites/${SITE}/contact-form/${SUBMISSION}`);
  assert.equal(submissionLink(undefined, SITE, SUBMISSION), null);
  assert.equal(submissionLink('  ', SITE, SUBMISSION), null);
});

test('the readers are the members who hold r on the forms leaf; a member whose check failed is logged and left out', async () => {
  const asked: Array<[string, string, string, string]> = [];
  const logged: string[] = [];
  const readers = await findSubmissionReaders(ORG, {
    listMemberIds: async () => ({ ids: [USER_A, USER_B, USER_C, USER_D], hasMore: false }),
    holds: async (organizationId, userId, leafKey, flag) => {
      asked.push([organizationId, userId, leafKey, flag]);
      if (userId === USER_C) throw new OrgSetupUnavailableError('Organization Setup answered 503 to POST /api/internal/authz/evaluate');
      return userId === USER_A || userId === USER_D;
    },
    log: { warn: (message) => logged.push(message) },
  });
  assert.deepEqual(readers, [USER_A, USER_D]);
  assert.deepEqual(asked.map(([organizationId, , leafKey, flag]) => [organizationId, leafKey, flag]), Array(4).fill([ORG, 'webstudio.manage_forms', 'r']));
  assert.equal(logged.length, 1);
  assert.match(logged[0], new RegExp(USER_C));
  assert.match(logged[0], /not notified/);
});

test('more members than the cap are not all asked, and the log says so', async () => {
  const logged: string[] = [];
  let limit = 0;
  const readers = await findSubmissionReaders(ORG, {
    listMemberIds: async (_organizationId, asked) => {
      limit = asked;
      return { ids: [USER_A], hasMore: true };
    },
    holds: async () => true,
    log: { warn: (message) => logged.push(message) },
  });
  assert.equal(limit, RECIPIENT_CAP);
  assert.deepEqual(readers, [USER_A]);
  assert.equal(logged.length, 1);
  assert.match(logged[0], new RegExp(`${RECIPIENT_CAP}`));
});

test('members are asked a few at a time, never all at once', async () => {
  const ids = Array.from({ length: 23 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  let inFlight = 0;
  let peak = 0;
  await findSubmissionReaders(ORG, {
    listMemberIds: async () => ({ ids, hasMore: false }),
    holds: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return true;
    },
    log: { warn: () => undefined },
  });
  assert.equal(peak, RECIPIENT_CONCURRENCY);
});

test('one new submission sends one notification to each reader, with the text and the link', async () => {
  const { ports: p, sent, logged } = ports();
  await notifyNewSubmission(SUBMISSION_ROW, SITE_ROW, p);
  assert.deepEqual(sent, [
    {
      organizationId: ORG,
      userIds: [USER_A, USER_B],
      title: 'New form submission',
      body: 'Sara Ali sent Contact form on Al Noor Trading.',
      target: `torch://app/${APP}/sites/${SITE}/contact-form/${SUBMISSION}`,
    },
  ]);
  assert.deepEqual(logged, []);
});

test('nobody to tell, nothing is sent', async () => {
  const { ports: p, sent, logged } = ports({ readers: async () => [] });
  await notifyNewSubmission(SUBMISSION_ROW, SITE_ROW, p);
  assert.deepEqual(sent, []);
  assert.deepEqual(logged, []);
});

test('the members could not be read: nothing is sent, the failure is logged, and nothing is thrown', async () => {
  const { ports: p, sent, logged } = ports({
    readers: async () => {
      throw new OrgSetupUnavailableError('Organization Setup is not reachable (POST /api/internal/people/members): connect ECONNREFUSED');
    },
  });
  await notifyNewSubmission(SUBMISSION_ROW, SITE_ROW, p);
  assert.deepEqual(sent, []);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].level, 'error');
  assert.match(logged[0].message, new RegExp(SUBMISSION));
  assert.match(logged[0].message, /ECONNREFUSED/);
});

test('the notification service is down: the failure is logged, and nothing is thrown', async () => {
  const { ports: p, logged } = ports({
    send: async () => {
      throw new NotificationUnavailableError('Notification Center is not reachable (POST /api/notifications): connect ECONNREFUSED');
    },
  });
  await notifyNewSubmission(SUBMISSION_ROW, SITE_ROW, p);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].level, 'error');
  assert.match(logged[0].message, new RegExp(SUBMISSION));
  assert.match(logged[0].message, /ECONNREFUSED/);
});

test('a user the service refused is logged by id; the others were told', async () => {
  const { ports: p, logged } = ports({
    send: async () => ({ notified: [USER_A], failed: [{ userId: USER_B, error: 'Notification Center answered 400 to POST /api/notifications' }] }),
  });
  await notifyNewSubmission(SUBMISSION_ROW, SITE_ROW, p);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].level, 'warn');
  assert.match(logged[0].message, new RegExp(USER_B));
  assert.match(logged[0].message, /answered 400/);
});

test('without the app id there is no link the shell can open: nothing is sent, and the log says why', async () => {
  const { ports: p, sent, logged } = ports({ appId: undefined });
  await notifyNewSubmission(SUBMISSION_ROW, SITE_ROW, p);
  assert.deepEqual(sent, []);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].level, 'error');
  assert.match(logged[0].message, /WS_APP_ID/);
});

test('a submission with no name field is told as from "A visitor"', async () => {
  const { ports: p, sent } = ports();
  await notifyNewSubmission({ ...SUBMISSION_ROW, payload: { email: 'sara@example.com' } }, SITE_ROW, p);
  assert.equal(sent[0].body, 'A visitor sent Contact form on Al Noor Trading.');
});

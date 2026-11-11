/**
 * The organization and the people of the session e2e suite, with the answer
 * auth-service would give each of them: GET /authz/my-permissions (the leaf
 * map of their profile) and GET /users/me (their profile). The auth stub
 * (auth-stub.ts) serves exactly this; the specs sign tokens for these subjects.
 */

export const ORG = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';

type Flags = Record<string, boolean>;
const ALL: Flags = { c: true, r: true, u: true, d: true, x: true, export: true, use_ai: true };
const NONE: Flags = { c: false, r: false, u: false, d: false, x: false, export: false, use_ai: false };
const READ: Flags = { ...NONE, r: true };
const EDIT: Flags = { ...NONE, c: true, r: true, u: true };

export interface TestPerson {
  sub: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  permissions: Record<string, Flags>;
}

export const PEOPLE: Record<'owner' | 'salesless' | 'member' | 'viewer' | 'nobody', TestPerson> = {
  /** The Manager profile's defaults: every flag on all five leaves (plus another app's, which must not leak into the session). */
  owner: {
    sub: '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a',
    email: 'owner@example.com',
    name: 'Owner Person',
    firstName: 'Owner',
    lastName: 'Person',
    permissions: {
      'webstudio.manage_sites': ALL,
      'webstudio.manage_content': ALL,
      'webstudio.manage_forms': ALL,
      'webstudio.manage_orders': ALL,
      'webstudio.manage_reports': ALL,
      'sales.manage_leads': ALL,
      // Part 2, W8: a Manager of Web Studio who is also a Sales salesman, so Sales accepts their confirm and cancel.
      'sales.manage_orders': ALL,
    },
  },
  /** Part 2, W8: manages Web Studio's orders (x) but holds only r on Sales's: Sales refuses their confirm and cancel. */
  salesless: {
    sub: '2e2e2e2e-2e2e-4e2e-8e2e-2e2e2e2e2e2e',
    email: 'salesless@example.com',
    name: 'Web Only',
    firstName: 'Web',
    lastName: 'Only',
    permissions: {
      'webstudio.manage_sites': ALL,
      'webstudio.manage_content': ALL,
      'webstudio.manage_forms': NONE,
      'webstudio.manage_orders': ALL,
      'sales.manage_orders': READ,
    },
  },
  /** The Member profile's defaults: manage_content c r u, r on manage_sites, manage_orders, manage_forms and manage_reports (part 3, W1). No profile name: the builder shows first and last name. */
  member: {
    sub: '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b',
    email: 'member@example.com',
    name: null,
    firstName: 'Member',
    lastName: 'Person',
    permissions: {
      'webstudio.manage_sites': READ,
      'webstudio.manage_content': EDIT,
      'webstudio.manage_forms': READ,
      'webstudio.manage_orders': READ,
      'webstudio.manage_reports': READ,
    },
  },
  /** The Viewer profile's defaults: r on all five leaves (manage_forms and manage_reports from part 3, W1). */
  viewer: {
    sub: '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c',
    email: 'viewer@example.com',
    name: null,
    firstName: null,
    lastName: null,
    permissions: {
      'webstudio.manage_sites': READ,
      'webstudio.manage_content': READ,
      'webstudio.manage_forms': READ,
      'webstudio.manage_orders': READ,
      'webstudio.manage_reports': READ,
    },
  },
  /** A member of the organization with no Web Studio leaf at all. */
  nobody: {
    sub: '2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d',
    email: 'nobody@example.com',
    name: 'No Body',
    firstName: 'No',
    lastName: 'Body',
    permissions: {
      'sales.manage_leads': ALL,
    },
  },
};

export function personBySub(sub: string | undefined): TestPerson | undefined {
  return Object.values(PEOPLE).find((person) => person.sub === sub);
}

/** The claims auth-service puts in an access token for a person of the organization. */
export function claimsFor(person: TestPerson, organization = ORG): Record<string, unknown> {
  return {
    sub: person.sub,
    email: person.email,
    sessionId: `session-${person.sub}`,
    entityId: organization,
    holdingId: organization,
    entityRole: 'Member',
    permissionProfileId: `profile-${person.sub}`,
  };
}

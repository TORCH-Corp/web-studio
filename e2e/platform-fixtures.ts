/**
 * What the platform stub (e2e/platform-stub.ts) answers for Organization Setup
 * and Product & Services, per organization (part 2, session W1). Sessions W2
 * and W3 add items, rates, Sales and Contact Center here.
 *
 * Shapes are the live services' (8 Nov 2026): a branch as auth-service's
 * `POST /api/internal/branches/` row, a category as Product & Services'
 * `GET /categories/tree` node, with only the fields Web Studio reads plus the
 * ones that decide what it reads (status, archived, parent).
 */

export const ORG_SETUP_KEY = 'e2e-org-setup-key';
export const PRODUCT_SERVICES_KEY = 'e2e-product-services-key';

/** store-settings.spec.ts's organization and a second one, whose branches and categories must never show. */
export const STORE_ORG = '05050505-0505-4505-8505-050505050505';
export const OTHER_STORE_ORG = '06060606-0606-4606-8606-060606060606';

export interface FixtureBranch {
  id: string;
  entityId: string;
  code: string;
  name: string;
  type: 'hq' | 'branch' | 'warehouse' | 'retail';
  status: 'active' | 'archived';
}

export interface FixtureCategory {
  id: string;
  entityId: string;
  name: string;
  name_ar: string | null;
  parent_id: string | null;
  archived: boolean;
  /** Items assigned to this category itself (Product & Services' items_count). */
  items_count: number;
}

export const BRANCH = {
  karrada: '15151515-0001-4515-8515-151515151515',
  basra: '15151515-0002-4515-8515-151515151515',
  erbilArchived: '15151515-0003-4515-8515-151515151515',
  otherOrg: '16161616-0001-4616-8616-161616161616',
} as const;

export const CATEGORY = {
  household: '25252525-0001-4525-8525-252525252525',
  kitchen: '25252525-0002-4525-8525-252525252525',
  cookware: '25252525-0003-4525-8525-252525252525',
  tableware: '25252525-0004-4525-8525-252525252525',
  electronics: '25252525-0005-4525-8525-252525252525',
  gardenArchived: '25252525-0006-4525-8525-252525252525',
  otherOrg: '26262626-0001-4626-8626-262626262626',
} as const;

export const BRANCHES: FixtureBranch[] = [
  { id: BRANCH.karrada, entityId: STORE_ORG, code: 'HQ', name: 'Baghdad — Karrada', type: 'hq', status: 'active' },
  { id: BRANCH.basra, entityId: STORE_ORG, code: 'BSR', name: 'Basra warehouse', type: 'warehouse', status: 'active' },
  { id: BRANCH.erbilArchived, entityId: STORE_ORG, code: 'EBL', name: 'Erbil branch', type: 'branch', status: 'archived' },
  { id: BRANCH.otherOrg, entityId: OTHER_STORE_ORG, code: 'HQ', name: 'Other organization HQ', type: 'hq', status: 'active' },
];

export const CATEGORIES: FixtureCategory[] = [
  { id: CATEGORY.household, entityId: STORE_ORG, name: 'Household', name_ar: 'المنزل', parent_id: null, archived: false, items_count: 42 },
  { id: CATEGORY.kitchen, entityId: STORE_ORG, name: 'Kitchen', name_ar: 'المطبخ', parent_id: null, archived: false, items_count: 0 },
  { id: CATEGORY.cookware, entityId: STORE_ORG, name: 'Cookware', name_ar: 'أدوات الطبخ', parent_id: CATEGORY.kitchen, archived: false, items_count: 18 },
  { id: CATEGORY.tableware, entityId: STORE_ORG, name: 'Tableware', name_ar: 'أدوات المائدة', parent_id: CATEGORY.kitchen, archived: false, items_count: 13 },
  { id: CATEGORY.electronics, entityId: STORE_ORG, name: 'Electronics', name_ar: null, parent_id: null, archived: false, items_count: 24 },
  { id: CATEGORY.gardenArchived, entityId: STORE_ORG, name: 'Garden', name_ar: 'الحديقة', parent_id: null, archived: true, items_count: 9 },
  { id: CATEGORY.otherOrg, entityId: OTHER_STORE_ORG, name: 'Other organization category', name_ar: null, parent_id: null, archived: false, items_count: 5 },
];

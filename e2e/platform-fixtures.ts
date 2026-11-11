/**
 * What the platform stub (e2e/platform-stub.ts) answers for Organization Setup
 * and Product & Services, per organization (part 2, session W1). Session W2
 * adds the catalogue organization: items with variants, units, the day's rate,
 * and the item images the fake Document Center (e2e/fake-document-center.ts)
 * holds. Session W3 adds the keys of Sales and Contact Center, whose stubs keep
 * what they are sent (the persons and the orders) in memory.
 *
 * Shapes are the live services' (8 Nov 2026): a branch as auth-service's
 * `POST /api/internal/branches/` row, a category as Product & Services'
 * `GET /categories/tree` node, with only the fields Web Studio reads plus the
 * ones that decide what it reads (status, archived, parent).
 */

export const ORG_SETUP_KEY = 'e2e-org-setup-key';
export const PRODUCT_SERVICES_KEY = 'e2e-product-services-key';
/** Session W3: the keys the stub's Contact Center and Sales take (each service's own SERVICE_API_KEY). */
export const CONTACT_CENTER_KEY = 'e2e-contact-center-key';
export const SALES_KEY = 'e2e-sales-key';

/** Session W8: the catalogue ids of Sales and of Web Studio, which the Orders API's deep links name (SALES_APP_ID, WS_APP_ID). */
export const SALES_APP_ID = '6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c';
export const WS_APP_ID = '7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d';
/** Part 3, W4: Contact Center's catalogue id, which a submission's deep link names (CONTACT_CENTER_APP_ID). */
export const CONTACT_CENTER_APP_ID = '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e';

/** store-settings.spec.ts's organization and a second one, whose branches and categories must never show. */
export const STORE_ORG = '05050505-0505-4505-8505-050505050505';
export const OTHER_STORE_ORG = '06060606-0606-4606-8606-060606060606';
/** catalogue.spec.ts's organization (part 2, W2): its own tree, so store-settings.spec.ts's is untouched. */
export const CATALOGUE_ORG = '08080808-0808-4808-8808-080808080808';

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
  catalogue: '18181818-0001-4818-8818-181818181818',
} as const;

export const CATEGORY = {
  household: '25252525-0001-4525-8525-252525252525',
  kitchen: '25252525-0002-4525-8525-252525252525',
  cookware: '25252525-0003-4525-8525-252525252525',
  tableware: '25252525-0004-4525-8525-252525252525',
  electronics: '25252525-0005-4525-8525-252525252525',
  gardenArchived: '25252525-0006-4525-8525-252525252525',
  otherOrg: '26262626-0001-4626-8626-262626262626',
  clothing: '28282828-0001-4828-8828-282828282828',
  shirts: '28282828-0002-4828-8828-282828282828',
  home: '28282828-0003-4828-8828-282828282828',
  garden: '28282828-0004-4828-8828-282828282828',
  /** The catalogue organization's category with nothing in it (part 2, W4: the grid's empty-category state). */
  toys: '28282828-0005-4828-8828-282828282828',
} as const;

export const BRANCHES: FixtureBranch[] = [
  { id: BRANCH.karrada, entityId: STORE_ORG, code: 'HQ', name: 'Baghdad — Karrada', type: 'hq', status: 'active' },
  { id: BRANCH.basra, entityId: STORE_ORG, code: 'BSR', name: 'Basra warehouse', type: 'warehouse', status: 'active' },
  { id: BRANCH.erbilArchived, entityId: STORE_ORG, code: 'EBL', name: 'Erbil branch', type: 'branch', status: 'archived' },
  { id: BRANCH.otherOrg, entityId: OTHER_STORE_ORG, code: 'HQ', name: 'Other organization HQ', type: 'hq', status: 'active' },
  { id: BRANCH.catalogue, entityId: CATALOGUE_ORG, code: 'HQ', name: 'Mansour shop', type: 'retail', status: 'active' },
];

export const CATEGORIES: FixtureCategory[] = [
  { id: CATEGORY.household, entityId: STORE_ORG, name: 'Household', name_ar: 'المنزل', parent_id: null, archived: false, items_count: 42 },
  { id: CATEGORY.kitchen, entityId: STORE_ORG, name: 'Kitchen', name_ar: 'المطبخ', parent_id: null, archived: false, items_count: 0 },
  { id: CATEGORY.cookware, entityId: STORE_ORG, name: 'Cookware', name_ar: 'أدوات الطبخ', parent_id: CATEGORY.kitchen, archived: false, items_count: 18 },
  { id: CATEGORY.tableware, entityId: STORE_ORG, name: 'Tableware', name_ar: 'أدوات المائدة', parent_id: CATEGORY.kitchen, archived: false, items_count: 13 },
  { id: CATEGORY.electronics, entityId: STORE_ORG, name: 'Electronics', name_ar: null, parent_id: null, archived: false, items_count: 24 },
  { id: CATEGORY.gardenArchived, entityId: STORE_ORG, name: 'Garden', name_ar: 'الحديقة', parent_id: null, archived: true, items_count: 9 },
  { id: CATEGORY.otherOrg, entityId: OTHER_STORE_ORG, name: 'Other organization category', name_ar: null, parent_id: null, archived: false, items_count: 5 },
  { id: CATEGORY.clothing, entityId: CATALOGUE_ORG, name: 'Clothing', name_ar: 'ملابس', parent_id: null, archived: false, items_count: 0 },
  { id: CATEGORY.shirts, entityId: CATALOGUE_ORG, name: 'Shirts', name_ar: 'قمصان', parent_id: CATEGORY.clothing, archived: false, items_count: 5 },
  { id: CATEGORY.home, entityId: CATALOGUE_ORG, name: 'Home', name_ar: 'المنزل', parent_id: null, archived: false, items_count: 4 },
  { id: CATEGORY.garden, entityId: CATALOGUE_ORG, name: 'Garden', name_ar: 'الحديقة', parent_id: null, archived: false, items_count: 1 },
  { id: CATEGORY.toys, entityId: CATALOGUE_ORG, name: 'Toys', name_ar: 'ألعاب', parent_id: null, archived: false, items_count: 0 },
];

// ---------------------------------------------------------------------------
// The catalogue organization's items (part 2, W2): as Product & Services
// serialises them after its light path P1 (channel rows on parents and plain
// items; the Arabic axis labels). The site sells from Clothing and Home.
// ---------------------------------------------------------------------------

/** Organization Setup's USD→IQD spot rate of the day, while the stub has one (POST /__rate). */
export const USD_IQD_RATE = 1520;

export const UNIT = { piece: '38383838-0001-4838-8838-383838383838' } as const;
export const UNITS = [{ id: UNIT.piece, entityId: CATALOGUE_ORG, code: 'UOM-000001', symbol: 'pcs', name: 'Piece', status: 'active' as const }];

export const SPEC = {
  size: '58585858-0001-4858-8858-585858585858',
  colour: '58585858-0002-4858-8858-585858585858',
} as const;
export const OPTION = {
  s: '59595959-0001-4959-8959-595959595959',
  m: '59595959-0002-4959-8959-595959595959',
  l: '59595959-0003-4959-8959-595959595959',
  white: '59595959-0004-4959-8959-595959595959',
  blue: '59595959-0005-4959-8959-595959595959',
} as const;

export interface FixtureSpecification {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  options: Array<{ id: string; code: string; label: string; label_ar: string }>;
}

export const SPECIFICATIONS: FixtureSpecification[] = [
  { id: SPEC.size, code: 'SZ', name: 'Size', name_ar: 'المقاس', options: [
    { id: OPTION.s, code: 'S', label: 'Small', label_ar: 'صغير' },
    { id: OPTION.m, code: 'M', label: 'Medium', label_ar: 'وسط' },
    { id: OPTION.l, code: 'L', label: 'Large', label_ar: 'كبير' },
  ] },
  { id: SPEC.colour, code: 'CLR', name: 'Colour', name_ar: 'اللون', options: [
    { id: OPTION.white, code: 'WHT', label: 'White', label_ar: 'أبيض' },
    { id: OPTION.blue, code: 'BLU', label: 'Blue', label_ar: 'أزرق' },
  ] },
];

/** Item images: Document Center documents of the organization (the fake Document Center holds their bytes). */
export const IMAGE = {
  lamp: '68686868-0001-4868-8868-686868686868',
  shirt: '68686868-0002-4868-8868-686868686868',
  /** A document of the organization that is no item's image: the store must never serve it. */
  contract: '68686868-0003-4868-8868-686868686868',
} as const;

export const DOCUMENTS = [
  { id: IMAGE.lamp, entityId: CATALOGUE_ORG, filename: 'lamp.png', mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4sUADAAPEAZHWDX0gAAAAAElFTkSuQmCC' },
  { id: IMAGE.shirt, entityId: CATALOGUE_ORG, filename: 'shirt.png', mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQCDgBAAHkAUEYgvCnAAAAAElFTkSuQmCC' },
  { id: IMAGE.contract, entityId: CATALOGUE_ORG, filename: 'contract.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.4 supplier contract').toString('base64') },
];

export const ITEM = {
  lamp: '48484848-0001-4848-8848-484848484848',
  sample: '48484848-0002-4848-8848-484848484848',
  shirt: '48484848-0003-4848-8848-484848484848',
  shirtMediumWhite: '48484848-0004-4848-8848-484848484848',
  shirtLargeWhite: '48484848-0005-4848-8848-484848484848',
  shirtSmallBlue: '48484848-0006-4848-8848-484848484848',
  shirtSmallWhite: '48484848-0007-4848-8848-484848484848',
  hose: '48484848-0008-4848-8848-484848484848',
  chair: '48484848-0009-4848-8848-484848484848',
  oldLamp: '48484848-0010-4848-8848-484848484848',
} as const;

export interface FixtureItem {
  id: string;
  entityId: string;
  sku: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  description_ar: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  base_price: number | null;
  currency: 'IQD' | 'USD';
  category_id: string | null;
  parent_item_id: string | null;
  base_uom_id: string | null;
  /** The item's own ECOMMERCE channel row is active. */
  ecommerce: boolean;
  primary_image: string | null;
  axes: Array<{ specification_id: string; option_id: string }>;
}

const plain = (values: Partial<FixtureItem> & Pick<FixtureItem, 'id' | 'sku' | 'name'>): FixtureItem => ({
  entityId: CATALOGUE_ORG, name_ar: null, description: null, description_ar: null, status: 'ACTIVE', base_price: null, currency: 'IQD',
  category_id: CATEGORY.home, parent_item_id: null, base_uom_id: UNIT.piece, ecommerce: true, primary_image: null, axes: [], ...values,
});
const shirtVariant = (values: Partial<FixtureItem> & Pick<FixtureItem, 'id' | 'sku' | 'name'>, size: string, colour: string): FixtureItem =>
  plain({ category_id: CATEGORY.shirts, parent_item_id: ITEM.shirt, ecommerce: false, axes: [{ specification_id: SPEC.size, option_id: size }, { specification_id: SPEC.colour, option_id: colour }], ...values });

export const ITEMS: FixtureItem[] = [
  plain({ id: ITEM.lamp, sku: 'LMP-001', name: 'Desk lamp', name_ar: 'مصباح مكتب', description: 'A brass desk lamp.', description_ar: 'مصباح مكتب نحاسي.', base_price: 25000, primary_image: IMAGE.lamp }),
  plain({ id: ITEM.sample, sku: 'SMP-001', name: 'Free sample', name_ar: 'عينة مجانية', base_price: 0 }),
  plain({ id: ITEM.shirt, sku: 'SHT-001', name: 'Linen shirt', name_ar: 'قميص كتان', description: 'Washed linen.', description_ar: 'كتان مغسول.', base_price: 0, category_id: CATEGORY.shirts, primary_image: IMAGE.shirt }),
  shirtVariant({ id: ITEM.shirtMediumWhite, sku: 'SHT-001-M-WHT', name: 'Linen shirt - Medium / White', status: 'DISCONTINUED', base_price: 30000 }, OPTION.m, OPTION.white),
  shirtVariant({ id: ITEM.shirtLargeWhite, sku: 'SHT-001-L-WHT', name: 'Linen shirt - Large / White', base_price: null }, OPTION.l, OPTION.white),
  // A child that still has a channel row of its own (as some do on production before P1): never a product of its own.
  shirtVariant({ id: ITEM.shirtSmallBlue, sku: 'SHT-001-S-BLU', name: 'Linen shirt - Small / Blue', base_price: 20, currency: 'USD', ecommerce: true }, OPTION.s, OPTION.blue),
  shirtVariant({ id: ITEM.shirtSmallWhite, sku: 'SHT-001-S-WHT', name: 'Linen shirt - Small / White', base_price: 35000 }, OPTION.s, OPTION.white),
  plain({ id: ITEM.hose, sku: 'GDN-001', name: 'Garden hose', name_ar: 'خرطوم حديقة', base_price: 15000, category_id: CATEGORY.garden }),
  plain({ id: ITEM.chair, sku: 'CHR-001', name: 'Office chair', base_price: 90000, ecommerce: false }),
  plain({ id: ITEM.oldLamp, sku: 'LMP-000', name: 'Old lamp', status: 'INACTIVE', base_price: 10000 }),
];

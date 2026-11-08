/**
 * The words of the store elements, in the two languages of a site (Arabic, the
 * store pages' default, and English), taken from handoff/store/{ar,en}. The
 * states the handoff does not draw (the catalogue cannot be read, "Load more",
 * an empty store) are worded here after its alert and empty patterns (notebook
 * decision 16g).
 *
 * Any locale that is not Arabic reads English. Numbers are Western digits in
 * both languages (DESIGN_SYSTEM.md); the Arabic count is the invariant plural
 * the handoff uses ("4 قطع").
 *
 * Kept free of Next and React imports so it runs under `node --test`.
 */

export type StoreLang = 'ar' | 'en';

/** The store language of a ycode locale code (`ar`, `ar-IQ`, `en`, ...). */
export function storeLangOf(localeCode: string | null | undefined): StoreLang {
  return /^ar(?:$|[-_])/i.test(localeCode ?? '') ? 'ar' : 'en';
}

export function storeDirOf(lang: StoreLang): 'rtl' | 'ltr' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

export interface StoreStrings {
  searchLabel: string;
  searchPlaceholder: string;
  categoriesLabel: string;
  allCategories: string;
  addToCart: string;
  chooseOptions: string;
  from: string;
  loading: string;
  productImage: string;
  loadMore: string;
  tryAgain: string;
  errorTitle: string;
  errorText: string;
  emptyCategoryTitle: (category: string | null) => string;
  emptyCategoryText: string;
  showAll: string;
  noResultsTitle: (query: string) => string;
  noResultsText: string;
  clearSearch: string;
  emptyStoreTitle: string;
  emptyStoreText: string;
  cartLabel: string;
  cartEmpty: string;
  cartCount: (count: number) => string;
  /** The currency as the page's language writes it, after the amount. */
  currency: Record<'IQD' | 'USD', string>;
}

export const STORE_STRINGS: Record<StoreLang, StoreStrings> = {
  en: {
    searchLabel: 'Search products by name',
    searchPlaceholder: 'Search by product name',
    categoriesLabel: 'Categories',
    allCategories: 'All',
    addToCart: 'Add to cart',
    chooseOptions: 'Choose options',
    from: 'from',
    loading: 'Loading products…',
    productImage: 'Product image',
    loadMore: 'Load more',
    tryAgain: 'Try again',
    errorTitle: 'We couldn’t load the products',
    errorText: 'The catalogue is temporarily unavailable. Try again in a moment.',
    emptyCategoryTitle: (category) => (category ? `No products in “${category}” yet` : 'No products in this category yet'),
    emptyCategoryText: 'Browse the other categories, or check back later.',
    showAll: 'Show all products',
    noResultsTitle: (query) => `No results for “${query}”`,
    noResultsText: 'Check the spelling, or try a shorter word.',
    clearSearch: 'Clear search',
    emptyStoreTitle: 'No products yet',
    emptyStoreText: 'Check back later.',
    cartLabel: 'Cart',
    cartEmpty: 'Cart is empty',
    cartCount: (count) => `Cart: ${count} ${count === 1 ? 'item' : 'items'}`,
    currency: { IQD: 'IQD', USD: 'USD' },
  },
  ar: {
    searchLabel: 'ابحث عن منتج بالاسم',
    searchPlaceholder: 'ابحث باسم المنتج',
    categoriesLabel: 'الأقسام',
    allCategories: 'الكل',
    addToCart: 'أضف إلى السلة',
    chooseOptions: 'اختر الخيارات',
    from: 'من',
    loading: 'جارٍ تحميل المنتجات…',
    productImage: 'صورة المنتج',
    loadMore: 'عرض المزيد',
    tryAgain: 'حاول مرة أخرى',
    errorTitle: 'تعذّر تحميل المنتجات الآن',
    errorText: 'الكتالوج غير متاح مؤقتًا. حاول مرة أخرى بعد قليل.',
    emptyCategoryTitle: (category) => (category ? `لا توجد منتجات في قسم «${category}» حاليًا` : 'لا توجد منتجات في هذا القسم حاليًا'),
    emptyCategoryText: 'تصفّح الأقسام الأخرى، أو عد إلينا لاحقًا.',
    showAll: 'عرض كل المنتجات',
    noResultsTitle: (query) => `لا نتائج لـ «${query}»`,
    noResultsText: 'تأكّد من كتابة الاسم، أو جرّب كلمة أقصر.',
    clearSearch: 'مسح البحث',
    emptyStoreTitle: 'لا توجد منتجات بعد',
    emptyStoreText: 'عد إلينا لاحقًا.',
    cartLabel: 'السلة',
    cartEmpty: 'السلة فارغة',
    cartCount: (count) => `السلة: ${count} قطع`,
    currency: { IQD: 'د.ع', USD: '$' },
  },
};

/** The cart badge: hidden at 0 (null), the count up to 99, "99+" above. */
export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const whole = Math.floor(count);
  return whole > 99 ? '99+' : String(whole);
}

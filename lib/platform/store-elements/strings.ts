/**
 * The words of the store elements, in the two languages of a site (Arabic, the
 * store pages' default, and English), taken from handoff/store/{ar,en}. The
 * states the handoff does not draw (the catalogue cannot be read, "Load more",
 * an empty store) are worded here after its alert and empty patterns (notebook
 * decision 16g).
 *
 * Any locale that is not Arabic reads English. Numbers are Western digits in
 * both languages (DESIGN_SYSTEM.md); the Arabic count is the invariant
 * singular after the number ("4 قطعة"), as context/rules/rtl-and-i18n.md asks
 * and the owner decided (OPEN_QUESTIONS 51): the handoff draws the plural
 * "4 قطع", which reads right only for 3 to 10. The grid's count follows the
 * same rule ("8 منتج", OPEN_QUESTIONS 57).
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
  // The product page (session W5)
  sku: string;
  description: string;
  quantity: string;
  decreaseQuantity: string;
  increaseQuantity: string;
  /** The chip's note on an option that cannot be bought (the word follows a middle dot). */
  unavailableOption: string;
  /** The picker's legend: "Colour:" (the chosen option follows). */
  axisLabel: (axis: string) => string;
  showImage: (position: number) => string;
  /** The "added" notice: the product's name and the options picked. */
  addedToCart: (name: string, options: string[]) => string;
  viewCart: string;
  cartFull: string;
  /** The product is gone, or the link names none: the designed empty pattern. */
  notOnSaleTitle: string;
  notOnSaleText: string;
  browseProducts: string;
  /** What the buyer hears while the product page loads. */
  loadingProduct: string;

  // The cart, checkout and confirmation (session W6)
  loadingCart: string;
  loadingCheckout: string;
  loadingOrder: string;
  cartTitle: string;
  itemCount: (count: number) => string;
  /** A line's price for one: "25,000 IQD / Piece", or "25,000 IQD each" for an item with no unit. */
  pricePerUnit: (price: string, unit: string | null) => string;
  removeLine: (name: string) => string;
  remove: string;
  quantityOf: (name: string) => string;
  orderSummary: string;
  subtotal: string;
  deliveryFee: string;
  total: string;
  checkout: string;
  continueShopping: string;
  cartEmptyTitle: string;
  cartEmptyText: string;
  /** The tag on a line whose price changed since the buyer added it, and the price it was. */
  priceUpdated: string;
  priceWas: (price: string) => string;
  /** The tag on a line the catalogue no longer sells. */
  lineUnavailable: string;
  cartBlockedHint: (count: number) => string;
  /** The cart could not be shown: the store's settings (currency, delivery fee) were not read. */
  cartErrorTitle: string;
  cartErrorText: string;
  /** The prices could not be checked against the catalogue: the lines show what the buyer saw. */
  pricesNotCheckedTitle: string;
  pricesNotCheckedText: string;

  backToCart: string;
  /** The collapsed summary's bar on a phone: the label, and "· 4 items" after it. */
  summaryCount: (count: number) => string;
  deliveryDetails: string;
  fullName: string;
  fullNamePlaceholder: string;
  phone: string;
  phonePlaceholder: string;
  phoneHelp: string;
  city: string;
  chooseCity: string;
  address: string;
  addressPlaceholder: string;
  landmark: string;
  landmarkPlaceholder: string;
  optional: string;
  notes: string;
  notesPlaceholder: string;
  payment: string;
  cashOnDelivery: string;
  cashOnDeliveryText: string;
  placeOrder: (total: string) => string;
  /** Place order with no total beside it: the amounts are not known yet. */
  placeOrderShort: string;
  placing: string;
  /** The alert over the form after the route refused fields: how many, then the list of them. */
  fixFields: (count: number) => string;
  serviceTitle: string;
  serviceText: string;
  rateLimitedTitle: string;
  rateLimitedText: string;
  itemsUnavailableTitle: (count: number) => string;
  itemsUnavailableText: (names: string[]) => string;
  removeItems: (count: number) => string;
  /** Place order is off until the unavailable items are removed. */
  removeToPlace: (count: number) => string;

  thanksTitle: string;
  /** "We'll call you on {phone} to confirm the delivery time": the words before and after the number. */
  callYouBefore: string;
  callYouAfter: string;
  callYouNoPhone: string;
  orderCode: string;
  orderCodeHint: string;
  orderDetails: string;
  cashReady: (total: string) => string;
  backToShop: string;
  orderNotFoundTitle: string;
  orderNotFoundText: string;
  orderErrorTitle: string;
  orderErrorText: string;

  // The grid's count, the breadcrumb and the category cards (session 25, F2)
  /** The count of the products a grid lists, under the page's title: "8 products". */
  productCount: (count: number) => string;
  /** The breadcrumb's name for assistive technology, and its first step, the products page. */
  breadcrumb: string;
  products: string;
  /** The tile of a category none of whose products has a picture. */
  categoryImage: string;
  loadingCategories: string;
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
    sku: 'SKU',
    description: 'Description',
    quantity: 'Quantity',
    decreaseQuantity: 'Decrease quantity',
    increaseQuantity: 'Increase quantity',
    unavailableOption: 'unavailable',
    axisLabel: (axis) => `${axis}:`,
    showImage: (position) => `Show image ${position}`,
    addedToCart: (name, options) => `${name}${options.length ? ` (${options.join(', ')})` : ''} added to your cart.`,
    viewCart: 'View cart',
    cartFull: 'Your cart is full. It holds 50 different items at most; remove one or check out first.',
    notOnSaleTitle: 'This product is no longer available',
    notOnSaleText: 'It may have been removed from the shop, or the link is not right. Browse the other products.',
    browseProducts: 'Browse products',
    loadingProduct: 'Loading the product…',

    loadingCart: 'Loading your cart…',
    loadingCheckout: 'Loading the checkout…',
    loadingOrder: 'Loading your order…',
    cartTitle: 'Shopping cart',
    itemCount: (count) => `${count} ${count === 1 ? 'item' : 'items'}`,
    pricePerUnit: (price, unit) => (unit ? `${price} / ${unit}` : `${price} each`),
    removeLine: (name) => `Remove ${name} from cart`,
    remove: 'Remove',
    quantityOf: (name) => `Quantity — ${name}`,
    orderSummary: 'Order summary',
    subtotal: 'Subtotal',
    deliveryFee: 'Delivery fee',
    total: 'Total',
    checkout: 'Checkout',
    continueShopping: 'Continue shopping',
    cartEmptyTitle: 'Your cart is empty',
    cartEmptyText: 'You haven’t added anything yet. Browse the products and add what you like.',
    priceUpdated: 'Price updated',
    priceWas: (price) => `was ${price}`,
    lineUnavailable: 'Unavailable',
    cartBlockedHint: (count) => `Remove the unavailable ${count === 1 ? 'item' : 'items'} to check out.`,
    cartErrorTitle: 'We couldn’t load your cart',
    cartErrorText: 'The store is temporarily unavailable. Your cart is kept, so try again in a moment.',
    pricesNotCheckedTitle: 'We couldn’t check the prices',
    pricesNotCheckedText: 'The catalogue is temporarily unavailable, so the prices shown are the ones from when you added the items. You are charged the shop’s price when you order.',

    backToCart: 'Back to cart',
    summaryCount: (count) => `· ${count} ${count === 1 ? 'item' : 'items'}`,
    deliveryDetails: 'Delivery details',
    fullName: 'Full name',
    fullNamePlaceholder: 'First and last name',
    phone: 'Phone number',
    phonePlaceholder: '07XX XXX XXXX',
    phoneHelp: 'The courier will call you on this number.',
    city: 'City',
    chooseCity: 'Choose a city',
    address: 'Address',
    addressPlaceholder: 'Area, district, alley, house number',
    landmark: 'Nearest landmark',
    landmarkPlaceholder: 'e.g. opposite the pharmacy',
    optional: '(optional)',
    notes: 'Notes',
    notesPlaceholder: 'Anything that helps the courier or concerns your order',
    payment: 'Payment',
    cashOnDelivery: 'Cash on delivery',
    cashOnDeliveryText: 'You pay the courier in cash when your order arrives. This is the only payment method.',
    placeOrder: (total) => `Place order · ${total}`,
    placeOrderShort: 'Place order',
    placing: 'Placing your order…',
    fixFields: (count) => `Your order wasn’t sent. Fix ${count} ${count === 1 ? 'field' : 'fields'}:`,
    serviceTitle: 'We couldn’t send your order',
    serviceText: 'The service is temporarily unavailable. Your cart and details are kept, so try again in a moment.',
    rateLimitedTitle: 'Too many orders from this connection',
    rateLimitedText: 'Wait a few minutes, then try again. Your cart and details are kept.',
    itemsUnavailableTitle: (count) => (count === 1 ? 'An item is no longer available' : 'Some items are no longer available'),
    itemsUnavailableText: (names) =>
      names.length === 1
        ? `“${names[0]}” is no longer available. Remove it to place your order.`
        : `${names.map((name) => `“${name}”`).join(', ')} are no longer available. Remove them to place your order.`,
    removeItems: (count) => (count === 1 ? 'Remove item' : 'Remove items'),
    removeToPlace: (count) => `Remove the unavailable ${count === 1 ? 'item' : 'items'} to place your order.`,

    thanksTitle: 'Thank you, we’ve received your order',
    callYouBefore: 'We’ll call you on ',
    callYouAfter: ' to confirm the delivery time.',
    callYouNoPhone: 'We’ll call you to confirm the delivery time.',
    orderCode: 'Order code',
    orderCodeHint: 'Keep this code if you need to ask about your order.',
    orderDetails: 'Order details',
    cashReady: (total) => `Have ${total} in cash ready to pay the courier on delivery.`,
    backToShop: 'Back to shop',
    orderNotFoundTitle: 'We can’t find this order',
    orderNotFoundText: 'The link may be incomplete, or the order may belong to another shop. Check the order code you were given, or go back to the shop.',
    orderErrorTitle: 'We couldn’t load your order',
    orderErrorText: 'The order can’t be read right now. Try again in a moment.',

    productCount: (count) => `${count} ${count === 1 ? 'product' : 'products'}`,
    breadcrumb: 'Breadcrumb',
    products: 'Products',
    categoryImage: 'Category image',
    loadingCategories: 'Loading the categories…',
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
    cartCount: (count) => `السلة: ${count} قطعة`,
    currency: { IQD: 'د.ع', USD: '$' },
    sku: 'رمز المنتج',
    description: 'الوصف',
    quantity: 'الكمية',
    decreaseQuantity: 'إنقاص الكمية',
    increaseQuantity: 'زيادة الكمية',
    unavailableOption: 'غير متوفر',
    axisLabel: (axis) => `${axis}:`,
    showImage: (position) => `عرض الصورة ${position}`,
    addedToCart: (name, options) => `تمت إضافة ${name}${options.length ? ` (${options.join('، ')})` : ''} إلى السلة.`,
    viewCart: 'عرض السلة',
    cartFull: 'السلة ممتلئة. تتسع لـ 50 منتجًا مختلفًا كحد أقصى؛ احذف منتجًا أو أتمّ الطلب أولًا.',
    notOnSaleTitle: 'هذا المنتج لم يعد متاحًا',
    notOnSaleText: 'ربما أُزيل من المتجر، أو أن الرابط غير صحيح. تصفّح المنتجات الأخرى.',
    browseProducts: 'تصفّح المنتجات',
    loadingProduct: 'جارٍ تحميل المنتج…',

    loadingCart: 'جارٍ تحميل السلة…',
    loadingCheckout: 'جارٍ تحميل صفحة إتمام الطلب…',
    loadingOrder: 'جارٍ تحميل طلبك…',
    cartTitle: 'سلة التسوق',
    itemCount: (count) => `${count} قطعة`,
    pricePerUnit: (price, unit) => (unit ? `${price} / ${unit}` : `${price} / للقطعة`),
    removeLine: (name) => `إزالة ${name} من السلة`,
    remove: 'إزالة',
    quantityOf: (name) => `الكمية — ${name}`,
    orderSummary: 'ملخص الطلب',
    subtotal: 'المجموع الفرعي',
    deliveryFee: 'رسوم التوصيل',
    total: 'الإجمالي',
    checkout: 'إتمام الطلب',
    continueShopping: 'متابعة التسوق',
    cartEmptyTitle: 'سلتك فارغة',
    cartEmptyText: 'لم تضف أي منتج بعد. تصفّح المنتجات وأضف ما يعجبك.',
    priceUpdated: 'تم تحديث السعر',
    priceWas: (price) => `كان ${price}`,
    lineUnavailable: 'غير متاح',
    cartBlockedHint: (count) => (count === 1 ? 'أزل المنتج غير المتاح لإتمام الطلب.' : 'أزل المنتجات غير المتاحة لإتمام الطلب.'),
    cartErrorTitle: 'تعذّر تحميل السلة الآن',
    cartErrorText: 'المتجر غير متاح مؤقتًا. سلتك محفوظة، حاول مرة أخرى بعد قليل.',
    pricesNotCheckedTitle: 'تعذّر التحقق من الأسعار',
    pricesNotCheckedText: 'الكتالوج غير متاح مؤقتًا، لذلك الأسعار المعروضة هي أسعار وقت إضافة المنتجات. يُحتسب عليك سعر المتجر عند تأكيد الطلب.',

    backToCart: 'العودة إلى السلة',
    summaryCount: (count) => `· ${count} قطعة`,
    deliveryDetails: 'معلومات التوصيل',
    fullName: 'الاسم الكامل',
    fullNamePlaceholder: 'الاسم الثلاثي',
    phone: 'رقم الهاتف',
    phonePlaceholder: '07XX XXX XXXX',
    phoneHelp: 'سيتصل بك المندوب على هذا الرقم.',
    city: 'المدينة',
    chooseCity: 'اختر المدينة',
    address: 'العنوان',
    addressPlaceholder: 'المنطقة، المحلة، الزقاق، رقم الدار',
    landmark: 'أقرب نقطة دالة',
    landmarkPlaceholder: 'مثال: مقابل الصيدلية',
    optional: '(اختياري)',
    notes: 'ملاحظات',
    notesPlaceholder: 'أي تفاصيل تساعد المندوب أو تخص الطلب',
    payment: 'طريقة الدفع',
    cashOnDelivery: 'الدفع عند الاستلام',
    cashOnDeliveryText: 'تدفع المبلغ نقدًا للمندوب عند استلام طلبك. هذه طريقة الدفع الوحيدة المتاحة.',
    placeOrder: (total) => `تأكيد الطلب · ${total}`,
    placeOrderShort: 'تأكيد الطلب',
    placing: 'جارٍ إرسال الطلب…',
    fixFields: (count) => (count === 1 ? 'لم يُرسَل الطلب. صحّح الحقل التالي:' : count === 2 ? 'لم يُرسَل الطلب. صحّح الحقلين التاليين:' : `لم يُرسَل الطلب. صحّح ${count} حقول:`),
    serviceTitle: 'تعذّر إرسال الطلب الآن',
    serviceText: 'الخدمة غير متاحة مؤقتًا. سلتك ومعلوماتك محفوظة، حاول مرة أخرى بعد قليل.',
    rateLimitedTitle: 'عدد كبير من الطلبات من هذا الاتصال',
    rateLimitedText: 'انتظر بضع دقائق ثم حاول مرة أخرى. سلتك ومعلوماتك محفوظة.',
    itemsUnavailableTitle: (count) => (count === 1 ? 'منتج لم يعد متاحًا' : 'بعض المنتجات لم تعد متاحة'),
    itemsUnavailableText: (names) =>
      names.length === 1
        ? `«${names[0]}» لم يعد متاحًا. أزله لتتمكّن من تأكيد الطلب.`
        : `${names.map((name) => `«${name}»`).join('، ')} لم تعد متاحة. أزلها لتتمكّن من تأكيد الطلب.`,
    removeItems: (count) => (count === 1 ? 'إزالة المنتج' : 'إزالة المنتجات'),
    removeToPlace: (count) => (count === 1 ? 'أزل المنتج غير المتاح لتأكيد الطلب.' : 'أزل المنتجات غير المتاحة لتأكيد الطلب.'),

    thanksTitle: 'شكرًا لك، تم استلام طلبك',
    callYouBefore: 'سنتصل بك على ',
    callYouAfter: ' لتأكيد موعد التوصيل.',
    callYouNoPhone: 'سنتصل بك لتأكيد موعد التوصيل.',
    orderCode: 'رمز الطلب',
    orderCodeHint: 'احتفظ بهذا الرمز للاستفسار عن طلبك.',
    orderDetails: 'تفاصيل الطلب',
    cashReady: (total) => `جهّز مبلغ ${total} نقدًا لتدفعه للمندوب عند الاستلام.`,
    backToShop: 'العودة إلى المتجر',
    orderNotFoundTitle: 'لم نعثر على هذا الطلب',
    orderNotFoundText: 'ربما الرابط غير مكتمل، أو أن الطلب يخص متجرًا آخر. تأكد من رمز الطلب الذي وصلك، أو عد إلى المتجر.',
    orderErrorTitle: 'تعذّر تحميل طلبك الآن',
    orderErrorText: 'لا يمكن قراءة الطلب حاليًا. حاول مرة أخرى بعد قليل.',

    productCount: (count) => `${count} منتج`,
    breadcrumb: 'مسار التصفح',
    products: 'المنتجات',
    categoryImage: 'صورة القسم',
    loadingCategories: 'جارٍ تحميل الأقسام…',
  },
};

/** The cart badge: hidden at 0 (null), the count up to 99, "99+" above. */
export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const whole = Math.floor(count);
  return whole > 99 ? '99+' : String(whole);
}

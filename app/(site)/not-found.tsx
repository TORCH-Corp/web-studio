import Link from 'next/link';
import { getDocumentSlugPath } from '@/lib/document-path';
import { fetchCachedErrorPage, fetchCachedPageWithLayers, isStoreProductRequest } from '@/lib/published-page-cache';
import { fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { getTenantIdFromHeaders, runWithTenantId } from '@/lib/supabase-server';
import PageRenderer from '@/components/PageRenderer';
import YcodeBadge from '@/components/YcodeBadge';

/**
 * 404 boundary for public pages. Renders the user's custom 404 page when one
 * exists, otherwise a default fallback. Next.js serves this with a real HTTP
 * 404 status, which avoids soft-404 SEO penalties from search engines.
 */
export default async function NotFound() {
  // The site comes from the request host (the boundary has no AsyncLocalStorage
  // of its own). A host no site uses gets the platform's plain 404: no site's
  // error page, no ycode badge (part 1, session 5).
  const tenantId = (await getTenantIdFromHeaders()) ?? undefined;
  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md px-4">
          <h1 className="text-6xl font-bold text-gray-900 mb-4">404</h1>
          <h2 className="text-2xl font-semibold text-gray-800">Page Not Found</h2>
        </div>
      </div>
    );
  }

  // An item that is no longer available answers 404 with the product page itself, in its "no longer available" state
  // (part 2, W5): the same cached entry the page route read, so this costs nothing more.
  const slugPath = getDocumentSlugPath();
  if (slugPath && (await isStoreProductRequest(slugPath, tenantId))) {
    const productPage = await fetchCachedPageWithLayers(slugPath, tenantId, true).catch(() => null);
    if (productPage?.storeProduct?.kind === 'gone') {
      const globalSettings = await runWithTenantId(tenantId, () => fetchGlobalPageSettings()).catch(() => null);
      return (
        <PageRenderer
          page={productPage.page}
          layers={productPage.pageLayers.layers || []}
          components={productPage.components}
          generatedCss={productPage.generatedCss || globalSettings?.publishedCss || undefined}
          colorVariablesCss={globalSettings?.colorVariablesCss || undefined}
          storeProduct={productPage.storeProduct}
          locale={productPage.locale}
          availableLocales={productPage.availableLocales}
          translations={productPage.translations}
          gaMeasurementId={globalSettings?.gaMeasurementId}
          globalCustomCodeHead={globalSettings?.globalCustomCodeHead}
          globalCustomCodeBody={globalSettings?.globalCustomCodeBody}
          ycodeBadge={globalSettings?.ycodeBadge ?? true}
        />
      );
    }
  }

  const errorPageData = await fetchCachedErrorPage(404, tenantId).catch(() => null);

  if (errorPageData) {
    // The site's global settings (colour variables, custom code), read for this site like a published
    // page reads them; the 404 page's own CSS first, as a published page uses its own (OPEN_QUESTIONS 26).
    const globalSettings = await runWithTenantId(tenantId, () => fetchGlobalPageSettings()).catch(() => null);
    const { page, pageLayers, components, locale, availableLocales, translations, generatedCss } = errorPageData;

    return (
      <PageRenderer
        page={page}
        layers={pageLayers.layers || []}
        components={components}
        generatedCss={generatedCss || globalSettings?.publishedCss || undefined}
        colorVariablesCss={globalSettings?.colorVariablesCss || undefined}
        locale={locale}
        availableLocales={availableLocales}
        translations={translations}
        globalCustomCodeHead={globalSettings?.globalCustomCodeHead}
        globalCustomCodeBody={globalSettings?.globalCustomCodeBody}
        ycodeBadge={globalSettings?.ycodeBadge ?? true}
      />
    );
  }

  let showBadge = true;
  try {
    const setting = await getSettingByKey('ycode_badge');
    showBadge = setting ?? true;
  } catch {
    // Supabase not configured
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center max-w-md px-4">
        <h1 className="text-6xl font-bold text-gray-900 mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">Page Not Found</h2>
        <p className="text-gray-600 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Go Home
        </Link>
      </div>
      {showBadge && <YcodeBadge />}
    </div>
  );
}

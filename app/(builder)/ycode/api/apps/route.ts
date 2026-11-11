import { getAllApps } from '@/lib/apps/registry';
import { isHiddenApp } from '@/lib/platform/parts';
import { getConnectedAppIds } from '@/lib/repositories/appSettingsRepository';
import { noCache } from '@/lib/api-response';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/apps
 * List all available apps with their connection status
 */
export async function GET() {
  try {
    // The connector apps stay hidden (part 3, session W2): what the screen lists is static export and the maps.
    const registeredApps = getAllApps().filter((app) => !isHiddenApp(app.id));
    const connectedIds = await getConnectedAppIds();
    const connectedSet = new Set(connectedIds);

    const appsWithStatus = registeredApps.map((app) => ({
      ...app,
      connected: connectedSet.has(app.id),
    }));

    return noCache({ data: appsWithStatus });
  } catch (error) {
    console.error('Error fetching apps:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch apps' },
      500
    );
  }
}

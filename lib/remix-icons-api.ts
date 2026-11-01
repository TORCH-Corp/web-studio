/**
 * Remix Icons API Client
 *
 * Fetches icons from the builder's own icon route (the Remix set, served from the repository).
 */

const ICONS_API_URL = '/ycode/api/icons';

export interface RemixIcon {
  source: string;
  name: string;
  category: string;
  style: 'fill' | 'line';
  svg: string;
}

export interface RemixIconCategory {
  name: string;
  count: number;
}

export interface RemixIconsResponse {
  icons: RemixIcon[];
  total: number;
  categories: RemixIconCategory[];
  totalIcons: number;
  limit: number;
  offset: number;
}

export interface RemixIconsParams {
  search?: string;
  category?: string;
  style?: 'fill' | 'line';
  limit?: number;
  offset?: number;
}

/** Fetch icons from the builder's icon route */
export async function fetchRemixIcons(params: RemixIconsParams = {}): Promise<RemixIconsResponse> {
  const searchParams = new URLSearchParams();

  if (params.search) searchParams.set('search', params.search);
  if (params.category) searchParams.set('category', params.category);
  if (params.style) searchParams.set('style', params.style);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset !== undefined) searchParams.set('offset', String(params.offset));

  const queryString = searchParams.toString();
  const url = queryString ? `${ICONS_API_URL}?${queryString}` : ICONS_API_URL;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch icons: ${response.status}`);
  }

  return response.json();
}

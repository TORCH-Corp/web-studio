/**
 * What the store elements' settings panels ask of the builder's own API (part 2,
 * session W4): the categories a product grid can list and the products a product
 * card can pick, for the site that is open. Browser side; the routes are
 * app/(builder)/ycode/api/platform/store-elements.
 */

export interface PickerCategory {
  id: string;
  name: string;
  name_ar: string | null;
  item_count: number;
}

export interface PickerProduct {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
}

export class PickerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PickerError';
  }
}

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) {
    let message = `The catalogue answered ${response.status}`;
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      // Not JSON: the status in the message is what there is.
    }
    throw new PickerError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export async function fetchPickerCategories(signal?: AbortSignal): Promise<PickerCategory[]> {
  return (await read<{ data: PickerCategory[] }>('/ycode/api/platform/store-elements/categories', signal)).data;
}

export async function fetchPickerProducts(search: string, page: number, signal?: AbortSignal): Promise<{ products: PickerProduct[]; total: number }> {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set('q', search);
  const body = await read<{ data: PickerProduct[]; meta: { total: number } }>(`/ycode/api/platform/store-elements/products?${params}`, signal);
  return { products: body.data, total: body.meta.total };
}

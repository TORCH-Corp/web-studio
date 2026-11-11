/**
 * Runs `fn` on every value, at most `limit` at a time, and answers the results
 * in the values' order. `fn` is expected to deal with its own failures: one
 * that throws anyway rejects the whole call. Kept free of Next imports so it
 * runs under `node --test`.
 */
export async function mapLimit<T, R>(values: readonly T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await fn(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

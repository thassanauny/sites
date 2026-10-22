/** Bound large ledger downloads and independent uploads without serial round trips. */
export const SYNC_CONCURRENCY = 3

/** Preserve input order and drain started work before reporting the first failure. */
export async function mapConcurrent<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  let failed = false
  let failure: unknown
  const worker = async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++
      try {
        results[index] = await work(items[index]!)
      } catch (error) {
        if (!failed) failure = error
        failed = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SYNC_CONCURRENCY, items.length) }, worker))
  if (failed) throw failure
  return results
}

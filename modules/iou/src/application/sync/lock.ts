/** Another tab can sync the same durable outbox; do not compete for revisions. */
export async function withSyncLock<T>(work: () => Promise<T>): Promise<T | undefined> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return work()
  return locks.request('iou:sync', { ifAvailable: true }, lock => (lock ? work() : undefined))
}

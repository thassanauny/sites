/**
 * The time to record on an edit: the device's clock, but never earlier than the group's latest edit.
 * A device whose clock runs behind another's can then still edit the group, and an edit made after
 * seeing a change always counts as the later one.
 */
export function editStamp(latestUpdatedAt: string, now: Date = new Date()): string {
  return new Date(Math.max(now.getTime(), Date.parse(latestUpdatedAt) + 1)).toISOString()
}

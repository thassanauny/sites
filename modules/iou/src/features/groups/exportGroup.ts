import { exportGroupCsv } from '../../domain/groups/csv'
import type { Group } from '../../domain/groups/types'
import { downloadFile } from '../../ui/download'

/** A safe file name from the group's name: ASCII letters and digits only, without leading or trailing dashes. */
export function exportFileName(name: string): string {
  return `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'iou-group'
  }.csv`
}

export function downloadGroup(group: Group): void {
  downloadFile(exportFileName(group.name), exportGroupCsv(group), 'text/csv;charset=utf-8')
}

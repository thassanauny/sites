import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Group } from '../../domain/groups/types'
import { MAX_MEMBERS, MAX_TRANSACTIONS } from '../../domain/ledger/calculations'
import { downloadGroup, exportFileName } from './exportGroup'

const now = '2026-10-08T09:00:00.000Z'

function makeGroup(name: string): Group {
  return {
    id: 'trip',
    name,
    description: 'Shared meals',
    currency: 'THB',
    icon: 'trip',
    color: '#10b981',
    inviteCode: 'a'.repeat(32),
    createdAt: now,
    updatedAt: now,
    members: [
      { id: 'amy', name: 'Amy' },
      { id: 'ben', name: 'Ben' },
    ],
    transactions: [
      {
        id: 'dinner',
        type: 'expense',
        description: 'Dinner',
        amount: 1_001,
        paidBy: 'amy',
        shares: { amy: 501, ben: 500 },
        category: 'food',
        date: '2026-10-08',
        createdAt: now,
      },
    ],
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('export file names', () => {
  it('keeps the ASCII letters and digits of the group name, without leading or trailing dashes', () => {
    expect(exportFileName('Trip full-backup')).toBe('trip-full-backup.csv')
    expect(exportFileName('  Rent & Bills 2026!  ')).toBe('rent-bills-2026.csv')
    expect(exportFileName('Café Trip')).toBe('caf-trip.csv')
  })

  it('falls back to a generic name when nothing usable remains', () => {
    for (const name of ['日本旅行', '🍜🍜', '---', ' ']) expect(exportFileName(name)).toBe('iou-group.csv')
  })
})

describe('group CSV download', () => {
  it('downloads a complete CSV above 5 MB with the full supported member and transaction counts', async () => {
    vi.useFakeTimers()
    const members = Array.from({ length: MAX_MEMBERS }, (_, index) => ({ id: `member-${String(index).padStart(3, '0')}`, name: `Member ${index}` }))
    const shares = Object.fromEntries(members.map(({ id }) => [id, 10_000]))
    const original: Group = {
      ...makeGroup('Trip full-backup'),
      members,
      transactions: Array.from({ length: MAX_TRANSACTIONS }, (_, index) => ({
        id: `expense-${index}`,
        type: 'expense',
        description: '🍜'.repeat(80),
        amount: 1_000_000,
        paidBy: members[index % members.length]!.id,
        shares,
        category: 'food',
        date: '2026-10-08',
        createdAt: now,
      })),
    }
    let downloaded: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      downloaded = blob as Blob
      return 'blob:group-backup'
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = { href: '', download: '', click: vi.fn() }
    const createElement = vi.fn(() => anchor)
    vi.stubGlobal('document', { createElement })
    downloadGroup(original)
    expect(createElement).toHaveBeenCalledWith('a')
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.download).toBe('trip-full-backup.csv')
    expect(anchor.href).toBe('blob:group-backup')
    expect(downloaded!.type).toBe('text/csv;charset=utf-8')
    const file = new File([downloaded!], anchor.download, { type: 'text/csv' })
    expect(file.size).toBeGreaterThan(5_000_000)
    expect(await file.text()).toMatch(/^record,version,id,name,description,currency/)
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:group-backup')
  })
})

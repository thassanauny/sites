import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Group } from '../domain/groups/types'
import { readSavedStore, saveStore, STORE_KEY } from '../infrastructure/storage/store'
import { createDeviceSession } from './deviceSession'
import { emptyStore, type AppStore } from './deviceStore'

const stamp = '2026-10-08T00:00:00.000Z'
const makeGroup = (key: string): Group => ({
  id: key,
  name: `Group ${key}`,
  description: '',
  currency: 'THB',
  icon: 'plane',
  color: '#e1ebf3',
  inviteCode: key.repeat(32),
  createdAt: stamp,
  updatedAt: stamp,
  members: [
    { id: `${key}-amy`, name: 'Amy' },
    { id: `${key}-ben`, name: 'Ben' },
  ],
  transactions: [],
})
const holding = (...keys: string[]): AppStore => ({ ...emptyStore(), groups: keys.map(makeGroup), cloudRevisions: Object.fromEntries(keys.map(key => [key, 1])) })

let entries: Map<string, string>
let storage: Storage
beforeEach(() => {
  entries = new Map()
  storage = {
    get length() {
      return entries.size
    },
    clear: vi.fn(() => entries.clear()),
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    key: vi.fn((index: number) => [...entries.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      entries.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value)
    }),
  }
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** A browser tab: it reads the shared storage once when it opens. */
const openTab = (onShow?: (previous: AppStore, next: AppStore) => void) => createDeviceSession(readSavedStore(), onShow)

describe('saving from one tab', () => {
  it('saves the new store, shows it, and tells listeners once', () => {
    const tab = openTab()
    const listener = vi.fn()
    tab.subscribe(listener)
    const next = holding('a')
    tab.commit(next)
    expect(tab.view().store).toBe(next)
    expect(entries.get(STORE_KEY)).toBe(JSON.stringify(next))
    expect(listener).toHaveBeenCalledOnce()
  })

  it('does not write or notify when a change leaves the store as it was', () => {
    saveStore(holding('a'))
    const tab = openTab()
    const listener = vi.fn()
    tab.subscribe(listener)
    vi.mocked(storage.setItem).mockClear()
    tab.commit(tab.view().store)
    tab.update(store => store)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('reports the previous and the next store to whoever follows the shown group', () => {
    const shown = vi.fn()
    const tab = openTab(shown)
    const first = tab.view().store
    const next = holding('a')
    tab.commit(next)
    expect(shown).toHaveBeenCalledWith(first, next)
  })

  it('keeps the previous store when the browser refuses the write', () => {
    const tab = openTab()
    const before = tab.view().store
    vi.mocked(storage.setItem).mockImplementationOnce(() => {
      throw new DOMException('Full', 'QuotaExceededError')
    })
    expect(() => tab.commit(holding('a'))).toThrow(/Could not save on this device/)
    expect(tab.view().store).toBe(before)
    expect(entries.has(STORE_KEY)).toBe(false)
  })
})

describe('two tabs sharing the saved store', () => {
  it('applies a change from the other tab before building on it', () => {
    const first = openTab()
    const second = openTab()
    first.commit(holding('a'))
    second.update(store => ({ ...store, pinnedIds: ['a'] }))
    const saved = readSavedStore().store
    expect(saved.groups.map(group => group.id)).toEqual(['a'])
    expect(saved.pinnedIds).toEqual(['a'])
    expect(second.view().store.groups.map(group => group.id)).toEqual(['a'])
  })

  it('refuses to overwrite a save it has not seen', () => {
    const first = openTab()
    const second = openTab()
    first.commit(holding('a'))
    const before = entries.get(STORE_KEY)
    expect(() => second.commit(holding('b'))).toThrow('Your saved data changed in another tab. Try saving again.')
    expect(entries.get(STORE_KEY)).toBe(before)
  })

  it('shows what another tab saved when its storage event arrives', () => {
    const first = openTab()
    const second = openTab()
    first.commit(holding('a', 'b'))
    second.adoptExternal()
    expect(second.view().store.groups.map(group => group.id)).toEqual(['a', 'b'])
    expect(() => second.commit({ ...second.view().store, pinnedIds: ['a'] })).not.toThrow()
  })

  it('never pairs the store it shows with text from a different read when another tab saves in between', () => {
    const tab = openTab()
    const read = JSON.stringify(holding('a', 'b'))
    const savedMeanwhile = JSON.stringify(holding('a', 'c'))
    entries.set(STORE_KEY, read)
    // Another tab saves right after this tab reads the text that it parses.
    vi.mocked(storage.getItem).mockImplementationOnce(key => {
      const value = entries.get(key) ?? null
      entries.set(key, savedMeanwhile)
      return value
    })
    tab.adoptExternal()
    expect(tab.view().store.groups.map(group => group.id)).toEqual(['a', 'b'])
    // The saved text is already newer than what the tab shows, so a blind save must be refused, not overwrite it.
    expect(() => tab.commit({ ...tab.view().store, pinnedIds: ['a'] })).toThrow('changed in another tab')
    expect(entries.get(STORE_KEY)).toBe(savedMeanwhile)
    // Reading again picks up the newer data, and saving works from there.
    expect(tab.latest().groups.map(group => group.id)).toEqual(['a', 'c'])
    expect(() => tab.commit({ ...tab.view().store, pinnedIds: ['a'] })).not.toThrow()
  })

  it('keeps text and state together when the data changes between the check and the parse in latest()', () => {
    const tab = openTab()
    entries.set(STORE_KEY, JSON.stringify(holding('a')))
    const newer = JSON.stringify(holding('a', 'b'))
    let reads = 0
    vi.mocked(storage.getItem).mockImplementation(key => {
      const value = entries.get(key) ?? null
      if (reads++ === 0) entries.set(key, newer)
      return value
    })
    expect(tab.latest().groups.map(group => group.id)).toEqual(['a', 'b'])
    vi.mocked(storage.getItem).mockImplementation(key => entries.get(key) ?? null)
    expect(() => tab.commit({ ...tab.view().store, pinnedIds: ['a'] })).not.toThrow()
  })
})

describe('saved data that cannot be used', () => {
  it('blocks edits and keeps the original text when another tab leaves unreadable data', () => {
    const tab = openTab()
    tab.commit(holding('a'))
    entries.set(STORE_KEY, '{broken')
    tab.adoptExternal()
    expect(tab.view().recoveryRequired).toBe(true)
    expect(tab.view().notice).toMatch(/could not be opened/)
    expect(() => tab.commit(holding('b'))).toThrow(/Recover or reset your saved data/)
    expect(() => tab.latest()).toThrow(/could not be opened/)
    expect(tab.recoveryBackup()).toBe('{broken')
    expect(entries.get(STORE_KEY)).toBe('{broken')
  })

  it('recovers by itself when readable data comes back', () => {
    const tab = openTab()
    entries.set(STORE_KEY, '{broken')
    tab.adoptExternal()
    saveStore(holding('a', 'b'))
    tab.adoptExternal()
    expect(tab.view()).toMatchObject({ recoveryRequired: false, notice: '' })
    expect(tab.view().store.groups).toHaveLength(2)
  })

  it('explains data that a newer version of iou saved, and keeps it', () => {
    const newer = JSON.stringify({ ...emptyStore(), version: 3 })
    entries.set(STORE_KEY, newer)
    const tab = openTab()
    expect(tab.view().recoveryRequired).toBe(true)
    expect(tab.view().notice).toMatch(/newer version/)
    expect(entries.get(STORE_KEY)).toBe(newer)
  })

  it('replaces unreadable data with an empty store only on request', () => {
    entries.set(STORE_KEY, '{broken')
    const tab = openTab()
    expect(entries.get(STORE_KEY)).toBe('{broken')
    tab.reset()
    expect(entries.get(STORE_KEY)).toBe(JSON.stringify(emptyStore()))
    expect(tab.view()).toMatchObject({ recoveryRequired: false, notice: '' })
    expect(() => tab.commit(holding('a'))).not.toThrow()
  })

  it('has nothing to download when no data is saved', () => {
    expect(() => openTab().recoveryBackup()).toThrow('There is no saved browser data to download.')
  })

  it('keeps working in memory when storage is unavailable, and saves once it returns', () => {
    vi.mocked(storage.getItem).mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError')
    })
    const tab = openTab()
    expect(tab.view().recoveryRequired).toBe(false)
    expect(tab.view().notice).toMatch(/storage is unavailable/)
    vi.mocked(storage.getItem).mockImplementation(key => entries.get(key) ?? null)
    tab.retryCaching()
    expect(entries.get(STORE_KEY)).toBe(JSON.stringify(emptyStore()))
    expect(tab.view().notice).toBe('')
  })

  it('refuses to cache over data another tab saved in the meantime', () => {
    vi.mocked(storage.getItem).mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError')
    })
    const tab = openTab()
    vi.mocked(storage.getItem).mockImplementation(key => entries.get(key) ?? null)
    saveStore(holding('a'))
    expect(() => tab.retryCaching()).toThrow('Reload before retrying caching.')
  })
})

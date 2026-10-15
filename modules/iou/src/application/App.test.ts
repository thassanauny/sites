// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { queueGroup } from './sync/queue'
import { emptyStore } from './deviceStore'
import { loadStore, saveStore, STORE_KEY } from '../infrastructure/storage/store'
import type { Group } from '../domain/groups/types'

const cloud = vi.hoisted(() => ({ versions: vi.fn(), load: vi.fn(), create: vi.fn(), save: vi.fn(), join: vi.fn() }))
vi.mock('../infrastructure/cloud/groups', () => ({
  cloudConfigured: true,
  loadCloudVersions: cloud.versions,
  loadCloudGroups: cloud.load,
  createCloudGroup: cloud.create,
  saveCloudGroup: cloud.save,
  joinCloudGroup: cloud.join,
}))
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }) }))

const stamp = '2026-10-08T00:00:00.000Z'
const makeGroup = (key: string, extra: Partial<Group> = {}): Group => ({
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
    { id: 'amy', name: 'Amy' },
    { id: 'ben', name: 'Ben' },
  ],
  transactions: [],
  ...extra,
})
const cached = (...keys: string[]) => ({ ...emptyStore(), groups: keys.map(key => makeGroup(key)), cloudRevisions: Object.fromEntries(keys.map(key => [key, 1])) })
/** The server holds these groups, each at the given revision (1 unless said otherwise). */
const serverHolds = (...records: { group: Group; revision: number }[]) => {
  cloud.versions.mockResolvedValue(records.map(({ group, revision }) => ({ id: group.id, revision })))
  cloud.load.mockImplementation(async (ids: readonly string[]) => ({ records: records.filter(({ group }) => ids.includes(group.id)), unreadable: [] }))
}
const serverHas = (...groups: Group[]) => serverHolds(...groups.map(group => ({ group, revision: 1 })))

let root: Root, host: HTMLDivElement, visibility: DocumentVisibilityState
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  localStorage.clear()
  window.history.replaceState(null, '', '#/')
  for (const mock of Object.values(cloud)) mock.mockReset()
  serverHas()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (document as { visibilityState?: unknown }).visibilityState
})

const mount = () =>
  act(async () => {
    root.render(createElement(App))
  })

const storageEvent = () =>
  act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key: STORE_KEY }))
  })
const click = (element: Element | null | undefined) =>
  act(async () => {
    ;(element as HTMLElement).click()
  })
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll('button')].find(item => item.textContent?.trim() === text)
const clickButton = (text: string) => click(button(text) ?? null)
const typeInto = (input: Element | null, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
const submit = (form: Element | null) =>
  act(async () => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
const readText = (blob: Blob) =>
  new Promise<string>(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
const setVisibility = async (state: DocumentVisibilityState) => {
  visibility = state
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

describe('personal balance presentation', () => {
  it.each([
    ['amy', 500, 'YOU OWE', true, 'Paid 0.00 Your share 5.00'],
    ['ben', 500, 'YOU GET BACK', false, 'Paid 10.00 Your share 5.00'],
    ['amy', 0, 'YOUR BALANCE', false, 'Paid 0.00 Your share 0.00'],
    [undefined, 500, 'YOUR BALANCE', false, 'Choose your member name in group settings.'],
  ] as const)('shows the matching balance state for member %s and share %s', async (memberId, amyShare, label, owes, details) => {
    const group = makeGroup('a', {
      transactions: [
        { id: 'expense', type: 'expense', description: 'Dinner', amount: 1000, paidBy: 'ben', shares: { amy: amyShare, ben: 1000 - amyShare }, category: 'food', date: '2026-10-15', createdAt: stamp },
      ],
    })
    saveStore({ ...emptyStore(), groups: [group], cloudRevisions: { a: 1 }, memberByGroup: memberId ? { a: memberId } : {} })
    serverHas(group)
    window.history.replaceState(null, '', `#/group/${group.inviteCode}`)
    await mount()
    const summary = host.querySelector('.personal-balance')!
    expect(summary.querySelector('.eyebrow')?.textContent).toBe(label)
    expect(summary.classList.contains('owes')).toBe(owes)
    expect(summary.querySelector('strong')?.textContent).toContain(memberId ? (amyShare === 0 ? '0.00' : '5.00') : 'Who are you?')
    expect(summary.querySelector('.balance-currency')?.textContent).toBe(memberId ? 'THB' : undefined)
    expect(host.querySelector('.balance-details')?.textContent?.replace(/\s+/g, ' ')).toBe(details)
  })
})

describe('device storage shared with other tabs', () => {
  it('shows groups another tab saved after its storage event', async () => {
    saveStore(cached('a'))
    window.history.replaceState(null, '', '#/groups')
    await mount()
    expect(host.textContent).toContain('Group a')
    expect(host.textContent).not.toContain('Group b')
    saveStore(cached('a', 'b'))
    await storageEvent()
    expect(host.textContent).toContain('Group b')
  })

  it('applies a local edit on top of changes another tab saved without any event', async () => {
    saveStore(cached('a'))
    window.history.replaceState(null, '', '#/groups')
    await mount()
    saveStore(cached('a', 'b'))
    await click(host.querySelector('[aria-label="Pin Group a"]'))
    const saved = loadStore().store
    expect(saved.groups.map(group => group.id)).toEqual(['a', 'b'])
    expect(saved.pinnedIds).toEqual(['a'])
    expect(host.textContent).toContain('Group b')
  })

  it('asks for recovery when another tab leaves unreadable data, and recovers when readable data returns', async () => {
    saveStore(cached('a'))
    window.history.replaceState(null, '', '#/groups')
    await mount()
    localStorage.setItem(STORE_KEY, '{broken')
    await storageEvent()
    expect(host.querySelector('.notice.warning')?.textContent).toContain('could not be opened')
    expect(button('Recover data')).toBeDefined()
    saveStore(cached('a', 'b'))
    await storageEvent()
    expect(host.querySelector('.notice.warning')).toBeNull()
    expect(host.textContent).toContain('Group b')
  })
})

describe('recovering unreadable saved data', () => {
  const download = () => {
    const blobs: Blob[] = []
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:recovery'
    })
    URL.revokeObjectURL = vi.fn()
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    return { blobs, anchor }
  }

  it('downloads the original browser data before resetting, then saves an empty store and clears the notice', async () => {
    localStorage.setItem(STORE_KEY, '{broken')
    const { blobs, anchor } = download()
    await mount()
    expect(host.querySelector('.notice.warning')?.textContent).toContain('could not be opened')
    await clickButton('Recover data')
    expect(host.querySelector('dialog')?.textContent).toContain('Recover your saved data')
    expect(host.querySelector('dialog')?.textContent).toContain('including changes that have not synced yet')
    await clickButton('Download recovery backup')
    expect(anchor).toHaveBeenCalledOnce()
    expect(await readText(blobs[0]!)).toBe('{broken')
    expect(localStorage.getItem(STORE_KEY)).toBe('{broken')
    await clickButton('Reset local saved data')
    expect(localStorage.getItem(STORE_KEY)).toBe(JSON.stringify(emptyStore()))
    expect(host.querySelector('.notice.warning')).toBeNull()
    expect(host.querySelector('dialog')).toBeNull()
  })

  it('refuses to create a group before the data is recovered and leaves the original data untouched', async () => {
    localStorage.setItem(STORE_KEY, '{broken')
    await mount()
    await clickButton('Create a group')
    await typeInto(host.querySelector('input[placeholder="e.g. Bangkok weekend"]'), 'Trip')
    await typeInto(host.querySelector('input[aria-label="Your name"]'), 'Amy')
    await submit(host.querySelector('dialog form'))
    expect(host.querySelector('.form-error')?.textContent).toContain('Recover or reset your saved data before creating a group')
    expect(localStorage.getItem(STORE_KEY)).toBe('{broken')
  })
})

describe('automatic sync', () => {
  it('syncs on start, when the tab becomes visible, on reconnect and every 10 seconds, but not while hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    await mount()
    expect(cloud.versions).toHaveBeenCalledTimes(1)
    await setVisibility('visible')
    expect(cloud.versions).toHaveBeenCalledTimes(2)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(cloud.versions).toHaveBeenCalledTimes(3)
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(cloud.versions).toHaveBeenCalledTimes(4)
    visibility = 'hidden'
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(cloud.versions).toHaveBeenCalledTimes(4)
  })

  it('never runs two syncs at once and starts the next one after the first finishes', async () => {
    let finish!: (versions: never[]) => void
    cloud.versions.mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      }),
    )
    await mount()
    expect(cloud.versions).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.connection')?.textContent).toContain('Syncing')
    await setVisibility('visible')
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(cloud.versions).toHaveBeenCalledTimes(1)
    await act(async () => finish([]))
    expect(host.querySelector('.connection')?.textContent).toContain('Connected')
    await setVisibility('visible')
    expect(cloud.versions).toHaveBeenCalledTimes(2)
  })

  it('makes no network request while offline or while saved data needs recovery', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await mount()
    expect(cloud.versions).not.toHaveBeenCalled()
    expect(host.querySelector('.connection')?.textContent).toContain('Offline')
    await act(async () => root.unmount())
    online.mockReturnValue(true)
    localStorage.setItem(STORE_KEY, '{broken')
    root = createRoot(host)
    await mount()
    expect(cloud.versions).not.toHaveBeenCalled()
  })

  it('reports a failed sync, keeps working on this device and retries on demand', async () => {
    cloud.versions.mockRejectedValueOnce(new Error('Could not connect to shared groups. Check your connection and try again.'))
    await mount()
    expect(host.querySelector('.notice.warning')?.textContent).toContain('Could not sync: Could not connect to shared groups')
    expect(host.querySelector('.connection')?.textContent).toContain('Needs attention')
    await clickButton('Retry')
    expect(cloud.versions).toHaveBeenCalledTimes(2)
    expect(host.querySelector('.notice.warning')).toBeNull()
    expect(host.querySelector('.connection')?.textContent).toContain('Connected')
  })

  it('asks to rejoin a group the server no longer returns, and not when it is still returned', async () => {
    saveStore(cached('a'))
    window.history.replaceState(null, '', `#/group/${'a'.repeat(32)}`)
    await mount()
    expect(host.textContent).toContain('Rejoin this group to sync them')
    await act(async () => root.unmount())
    serverHas(makeGroup('a'))
    root = createRoot(host)
    await mount()
    expect(host.textContent).not.toContain('Rejoin this group to sync them')
  })

  it('uploads a group created offline and follows its new server invitation in the open route', async () => {
    saveStore(queueGroup(emptyStore(), makeGroup('c'), 'amy'))
    cloud.create.mockImplementation(async (group: Group) => ({ group: { ...group, inviteCode: 'd'.repeat(32) }, revision: 1 }))
    window.history.replaceState(null, '', `#/group/${'c'.repeat(32)}`)
    await mount()
    expect(cloud.create).toHaveBeenCalledOnce()
    expect(window.location.hash).toBe(`#/group/${'d'.repeat(32)}`)
    const saved = loadStore().store
    expect(saved.outbox).toEqual([])
    expect(saved.groups[0]!.inviteCode).toBe('d'.repeat(32))
    expect(saved.cloudRevisions.c).toBe(1)
    expect(host.querySelector('h1')?.textContent).toBe('Group c')
  })

  it('asks only for revisions on a quiet poll: nothing is downloaded and nothing is written', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    saveStore(cached('a', 'b'))
    serverHas(makeGroup('a'), makeGroup('b'))
    await mount()
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(cloud.versions).toHaveBeenCalledTimes(4)
    expect(cloud.load).not.toHaveBeenCalled()
    expect(writes).not.toHaveBeenCalled()
  })

  it('downloads only the group whose revision moved', async () => {
    saveStore(cached('a', 'b'))
    serverHolds({ group: makeGroup('a'), revision: 1 }, { group: makeGroup('b', { name: 'Renamed', updatedAt: '2026-10-09T00:00:00.000Z' }), revision: 2 })
    window.history.replaceState(null, '', '#/groups')
    await mount()
    expect(cloud.load).toHaveBeenCalledOnce()
    expect(cloud.load).toHaveBeenCalledWith(['b'])
    expect(host.textContent).toContain('Renamed')
    expect(loadStore().store.cloudRevisions).toEqual({ a: 1, b: 2 })
  })

  it('waits longer between automatic attempts while the server keeps failing, but never delays the user’s own actions', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    const tick = (ms: number) =>
      act(async () => {
        vi.advanceTimersByTime(ms)
      })
    cloud.versions.mockRejectedValue(new Error('Could not connect to shared groups. Check your connection and try again.'))
    await mount()
    expect(cloud.versions).toHaveBeenCalledTimes(1)
    await tick(10_000)
    expect(cloud.versions).toHaveBeenCalledTimes(1)
    await tick(10_000)
    expect(cloud.versions).toHaveBeenCalledTimes(2)
    await tick(30_000)
    expect(cloud.versions).toHaveBeenCalledTimes(2)
    await clickButton('Retry')
    expect(cloud.versions).toHaveBeenCalledTimes(3)
    cloud.versions.mockResolvedValue([])
    await tick(80_000)
    expect(cloud.versions).toHaveBeenCalledTimes(4)
    expect(host.querySelector('.connection')?.textContent).toContain('Connected')
    await tick(10_000)
    expect(cloud.versions).toHaveBeenCalledTimes(5)
  })
})

describe('shared groups this version cannot read', () => {
  const readable = (name: string) => makeGroup('b', { name, updatedAt: '2026-10-09T00:00:00.000Z' })
  const serverCannotReadA = () => {
    cloud.versions.mockResolvedValue([
      { id: 'a', revision: 2 },
      { id: 'b', revision: 2 },
    ])
    cloud.load.mockImplementation(async (ids: readonly string[]) => ({
      records: ids.includes('b') ? [{ group: readable('Newer b'), revision: 2 }] : [],
      unreadable: ids.includes('a') ? ['a'] : [],
    }))
  }

  it('says so on the group’s own page, keeps syncing the others and stops downloading it until it changes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    saveStore(cached('a', 'b'))
    serverCannotReadA()
    window.history.replaceState(null, '', `#/group/${'a'.repeat(32)}`)
    await mount()
    expect(host.querySelector('.notice.warning')?.textContent).toContain('This group’s shared copy could not be read by this version of iou')
    expect(host.querySelector('.connection')?.textContent).toContain('Connected')
    expect(loadStore().store.groups.find(item => item.id === 'b')!.name).toBe('Newer b')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(cloud.versions).toHaveBeenCalledTimes(4)
    expect(cloud.load).toHaveBeenCalledOnce()
    expect(host.querySelector('.notice.warning')?.textContent).toContain('could not be read by this version of iou')
    cloud.versions.mockResolvedValue([
      { id: 'a', revision: 3 },
      { id: 'b', revision: 2 },
    ])
    cloud.load.mockImplementation(async () => ({ records: [{ group: makeGroup('a', { name: 'Readable again', updatedAt: '2026-10-10T00:00:00.000Z' }), revision: 3 }], unreadable: [] }))
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(host.querySelector('.notice.warning')).toBeNull()
    expect(host.querySelector('h1')?.textContent).toBe('Readable again')
  })

  it('counts them on the other pages without blocking anything else', async () => {
    saveStore(cached('a', 'b'))
    serverCannotReadA()
    window.history.replaceState(null, '', '#/groups')
    await mount()
    expect(host.querySelector('.notice.warning')?.textContent).toBe('A shared group could not be read by this version of iou and is not updating. Your other groups keep syncing.')
    expect(host.textContent).toContain('Newer b')
  })
})

describe('routes and launch', () => {
  it('opens the Travel mode default group once at launch from Home', async () => {
    saveStore({ ...cached('a', 'b'), travelMode: { enabled: true, defaultGroupId: 'b' } })
    await mount()
    expect(window.location.hash).toBe(`#/group/${'b'.repeat(32)}`)
    expect(host.querySelector('h1')?.textContent).toBe('Group b')
    await act(async () => {
      window.location.hash = '/'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(host.querySelector('h1')?.textContent).toBe('Split it. Settle it.')
  })

  it('reloads a group page from the cached groups and says when a code is unknown', async () => {
    saveStore(cached('a'))
    window.history.replaceState(null, '', `#/group/${'a'.repeat(32)}`)
    await mount()
    expect(host.querySelector('h1')?.textContent).toBe('Group a')
    expect(document.title).toBe('Group a · iou')
    await act(async () => {
      window.location.hash = `/group/${'f'.repeat(32)}`
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(host.textContent).toContain('We couldn’t find that group.')
  })
})

describe('long transaction logs', () => {
  const expense = (index: number) => ({
    id: `e${index}`,
    type: 'expense' as const,
    description: `Item ${index}`,
    amount: 1000,
    paidBy: 'amy',
    shares: { amy: 500, ben: 500 },
    category: 'food',
    date: '2026-10-08',
    createdAt: stamp,
  })
  const payment = (index: number) => ({ id: `p${index}`, type: 'payment' as const, fromId: 'ben', toId: 'amy', amount: 100, note: `Payment ${index}`, date: '2026-10-08', createdAt: stamp })
  const rows = () => host.querySelectorAll('.transaction-list .transaction-row').length

  it('shows 50 rows at first, 50 more each time, and starts again from 50 when the filter changes', async () => {
    const transactions = [...Array.from({ length: 100 }, (_, index) => expense(index)), ...Array.from({ length: 20 }, (_, index) => payment(index))]
    saveStore({ ...cached('a'), groups: [makeGroup('a', { transactions })] })
    window.history.replaceState(null, '', `#/group/${'a'.repeat(32)}/log`)
    await mount()
    expect(rows()).toBe(50)
    expect(host.querySelector('.feed-pagination')?.textContent).toContain('Showing 50 of 120')
    await clickButton('Show more')
    expect(rows()).toBe(100)
    await clickButton('Show more')
    expect(rows()).toBe(120)
    expect(button('Show more')).toBeUndefined()
    await clickButton('Expenses')
    expect(rows()).toBe(50)
    expect(host.querySelector('.feed-pagination')?.textContent).toContain('Showing 50 of 100')
    await clickButton('Show more')
    await clickButton('Payments')
    expect(rows()).toBe(20)
    expect(host.querySelector('.feed-pagination')).toBeNull()
  })
})

describe('creating a shared group', () => {
  it.each([
    ['#/', true],
    ['#/groups', true],
    ['#/', false],
    ['#/groups', false],
  ] as const)('pins a new group created from %s with online=%s and preserves other tabs’ pin changes', async (hash, online) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
    saveStore({ ...cached('a', 'b'), pinnedIds: ['a'] })
    serverHas(makeGroup('a'), makeGroup('b'))
    cloud.create.mockImplementation(async (group: Group) => ({ group: { ...group, inviteCode: 'c'.repeat(32) }, revision: 1 }))
    window.history.replaceState(null, '', hash)
    await mount()
    await click(hash === '#/groups' ? host.querySelector('[aria-label="Create group"]') : button('Create a group'))
    await typeInto(host.querySelector('input[placeholder="e.g. Bangkok weekend"]'), 'Trip')
    await typeInto(host.querySelector('input[aria-label="Your name"]'), 'Amy')
    saveStore({ ...loadStore().store, pinnedIds: ['b'] })
    await submit(host.querySelector('dialog form'))
    const saved = loadStore().store
    const created = saved.groups.find(group => group.name === 'Trip')!
    expect(created).toBeDefined()
    expect(saved.pinnedIds).toEqual(['b', created.id])
    expect(saved.memberByGroup[created.id]).toBe(created.members[0]!.id)
    expect(saved.outbox).toHaveLength(online ? 0 : 1)
    expect(cloud.create).toHaveBeenCalledTimes(online ? 1 : 0)
    expect(host.querySelector('dialog')).toBeNull()
    await act(async () => {
      window.location.hash = '/'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(host.querySelector('[aria-label="Unpin Trip"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Open Group b"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Open Group a"]')).toBeNull()
  })
})

describe('editing a shared group', () => {
  it('adds an expense to the open group, queues it durably and uploads it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    saveStore(cached('a'))
    cloud.save.mockImplementation(async (group: Group, revision: number) => ({ group, revision: revision + 1 }))
    serverHas(makeGroup('a'))
    window.history.replaceState(null, '', `#/group/${'a'.repeat(32)}`)
    await mount()
    await click(host.querySelector('.desktop-actions .button.primary'))
    await typeInto(host.querySelector('input[placeholder="What was it for?"]'), 'Dinner')
    await typeInto(host.querySelector('input[aria-label="Amount in THB"]'), '10.01')
    await submit(host.querySelector('dialog form'))
    const saved = loadStore().store
    expect(saved.groups[0]!.transactions).toMatchObject([{ type: 'expense', description: 'Dinner', amount: 1001, paidBy: 'amy', shares: { amy: 501, ben: 500 } }])
    expect(cloud.save).toHaveBeenCalledOnce()
    expect(saved.outbox).toEqual([])
    expect(saved.cloudRevisions.a).toBe(2)
    expect(host.querySelector('.toast')?.textContent).toContain('Expense added')
    expect(host.querySelector('dialog')).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(1999)
    })
    expect(host.querySelector('.toast')?.textContent).toContain('Expense added')
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(host.querySelector('.toast')).toBeNull()
  })

  describe('when this device’s clock is behind the group’s latest edit', () => {
    const ahead = '2026-10-09T12:00:00.000Z'
    const behind = () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-08T09:00:00.000Z'))
    }

    it('still adds an expense, stamping it just after that edit', async () => {
      behind()
      const creator = makeGroup('a', { createdAt: ahead, updatedAt: ahead })
      saveStore({ ...emptyStore(), groups: [creator], cloudRevisions: { a: 1 } })
      serverHolds({ group: creator, revision: 1 })
      cloud.save.mockImplementation(async (group: Group, revision: number) => ({ group, revision: revision + 1 }))
      window.history.replaceState(null, '', `#/group/${'a'.repeat(32)}`)
      await mount()
      await click(host.querySelector('.desktop-actions .button.primary'))
      await typeInto(host.querySelector('input[placeholder="What was it for?"]'), 'Dinner')
      await typeInto(host.querySelector('input[aria-label="Amount in THB"]'), '10.01')
      await submit(host.querySelector('dialog form'))
      expect(host.querySelector('.form-error')).toBeNull()
      const saved = loadStore().store.groups[0]!
      expect(saved.transactions).toHaveLength(1)
      expect(saved.updatedAt).toBe('2026-10-09T12:00:00.001Z')
      expect(host.querySelector('.toast')?.textContent).toContain('Expense added')
    })

    it('lets a settings save win over a conflicting change that arrived while the dialog was open', async () => {
      behind()
      saveStore(cached('a'))
      serverHas(makeGroup('a'))
      cloud.save.mockImplementation(async (group: Group, revision: number) => ({ group, revision: revision + 1 }))
      window.history.replaceState(null, '', `#/group/${'a'.repeat(32)}`)
      await mount()
      await click(host.querySelector('[aria-label="Group settings"]'))
      saveStore({ ...cached('a'), groups: [makeGroup('a', { name: 'Theirs', updatedAt: ahead })] })
      await storageEvent()
      await typeInto(host.querySelector('dialog form input'), 'Mine')
      await submit(host.querySelector('dialog form'))
      const saved = loadStore().store.groups[0]!
      expect(saved.name).toBe('Mine')
      expect(saved.updatedAt).toBe('2026-10-09T12:00:00.001Z')
      expect(host.querySelector('.toast')?.textContent).toContain('Group settings saved')
    })
  })

  it('removes a group from this device, remembers the removal and returns to the Groups page', async () => {
    saveStore({ ...cached('a'), pinnedIds: ['a'] })
    serverHas(makeGroup('a'))
    window.history.replaceState(null, '', `#/group/${'a'.repeat(32)}`)
    await mount()
    await click(host.querySelector('[aria-label="Group settings"]'))
    await clickButton('Remove from this device')
    await click([...host.querySelectorAll('dialog form button[type="submit"]')].find(item => item.textContent === 'Remove from this device'))
    const saved = loadStore().store
    expect(saved.groups).toEqual([])
    expect(saved.pinnedIds).toEqual([])
    expect(saved.removedGroupIds).toEqual(['a'])
    expect(window.location.hash).toBe('#/groups')
    expect(host.querySelector('.toast')?.textContent).toContain('Group removed from this device')
  })
})

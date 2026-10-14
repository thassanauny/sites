// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './application/App'
import { emptyStore, removeGroupFromDevice } from './application/deviceStore'
import { loadStore, saveStore, STORE_KEY } from './infrastructure/storage/store'
import type { Group } from './domain/groups/types'

const mocks = vi.hoisted(() => ({ join: vi.fn(), versions: vi.fn(), load: vi.fn() }))
vi.mock('./infrastructure/cloud/groups', () => ({
  cloudConfigured: true,
  joinCloudGroup: mocks.join,
  loadCloudVersions: mocks.versions,
  loadCloudGroups: mocks.load,
  createCloudGroup: vi.fn(),
  saveCloudGroup: vi.fn(),
}))
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }) }))
const codeA = 'a'.repeat(32),
  codeB = 'b'.repeat(32)
const group = (code = codeA): Group => ({
  id: code[0]!,
  name: `Group ${code[0]}`,
  description: '',
  currency: 'THB',
  icon: 'trip',
  color: '#10b981',
  inviteCode: code,
  createdAt: '2026-10-08T00:00:00Z',
  updatedAt: '2026-10-08T00:00:00Z',
  members: [{ id: 'amy', name: 'Amy' }],
  transactions: [],
})
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  localStorage.clear()
  window.history.replaceState(null, '', `#/join/${codeA}`)
  mocks.versions.mockResolvedValue([])
  mocks.load.mockResolvedValue({ records: [], unreadable: [] })
  mocks.join.mockReset()
  mocks.join.mockImplementation(async (code: string) => ({ group: group(code), revision: 1 }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const mount = () =>
  act(async () => {
    root.render(createElement(App))
  })
const submit = () =>
  act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
const navigate = (code: string) =>
  act(async () => {
    window.history.replaceState(null, '', `#/join/${code}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
const typeName = (value: string) =>
  act(async () => {
    const input = host.querySelector('input[placeholder="Your name in this group"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

describe('invitation navigation and late results', () => {
  it('resets the input and loaded group when invitation A changes to B', async () => {
    await mount()
    expect(host.querySelector<HTMLInputElement>('form input')!.value).toBe(codeA)
    await submit()
    expect(host.querySelector('.joined-group-preview')?.textContent).toContain('Group a')
    await navigate(codeB)
    expect(host.querySelector('.joined-group-preview')).toBeNull()
    expect(host.querySelector<HTMLInputElement>('form input')!.value).toBe(codeB)
    await submit()
    expect(host.querySelector('.joined-group-preview')?.textContent).toContain('Group b')
  })
  it('keeps a device removal when an earlier invitation lookup completes', async () => {
    saveStore({ ...emptyStore(), groups: [group()], cloudRevisions: { a: 1 } })
    let finish!: (value: { group: Group; revision: number }) => void
    mocks.join.mockReturnValue(
      new Promise(resolve => {
        finish = resolve
      }),
    )
    await mount()
    await submit()
    await act(async () => {
      saveStore(removeGroupFromDevice(loadStore().store, 'a'))
      window.dispatchEvent(new StorageEvent('storage', { key: STORE_KEY }))
      finish({ group: group(), revision: 1 })
    })
    expect(loadStore().store.groups).toEqual([])
    expect(loadStore().store.removedGroupIds).toEqual(['a'])
    expect(host.textContent).toContain('removed while opening')
  })
  it('does not queue restoration or save membership after another tab removes a loaded preview', async () => {
    saveStore({ ...emptyStore(), groups: [group()], cloudRevisions: { a: 1 } })
    await mount()
    await submit()
    await act(async () => {
      const identity = host.querySelector<HTMLSelectElement>('form select')!
      identity.value = 'amy'
      identity.dispatchEvent(new Event('change', { bubbles: true }))
      saveStore(removeGroupFromDevice(loadStore().store, 'a'))
      window.dispatchEvent(new StorageEvent('storage', { key: STORE_KEY }))
    })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await submit()
    const saved = loadStore().store
    expect(saved.groups).toEqual([])
    expect(saved.memberByGroup.a).toBeUndefined()
    expect(saved.pendingJoins).toEqual([])
    expect(host.textContent).toContain('removed from this device')
  })
  describe('joining as a new member', () => {
    beforeEach(() => {
      saveStore({ ...emptyStore(), groups: [group()], cloudRevisions: { a: 1 } })
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    })

    it('saves the new member, who you are and the offline join request in a single write', async () => {
      await mount()
      await submit()
      await typeName('Cam')
      const writes = vi.spyOn(Storage.prototype, 'setItem')
      await submit()
      expect(writes.mock.calls.filter(([key]) => key === STORE_KEY)).toHaveLength(1)
      const saved = loadStore().store
      expect(saved.groups[0]!.members.map(member => member.name)).toEqual(['Amy', 'Cam'])
      expect(saved.memberByGroup.a).toBe(saved.groups[0]!.members[1]!.id)
      expect(saved.pendingJoins).toHaveLength(1)
      expect(host.querySelector('dialog')).toBeNull()
    })

    it('stores nothing when that write fails', async () => {
      await mount()
      await submit()
      await typeName('Cam')
      const before = localStorage.getItem(STORE_KEY)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded')
      })
      await submit()
      expect(host.querySelector('.form-error')?.textContent).toContain('Could not save on this device')
      expect(localStorage.getItem(STORE_KEY)).toBe(before)
    })

    it('cannot be left with a member but no identity by a failing second write, because there is only one write', async () => {
      await mount()
      await submit()
      await typeName('Cam')
      const original = Storage.prototype.setItem
      let writes = 0
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
        if (writes++ > 0) throw new Error('Quota exceeded')
        original.call(this, key, value)
      })
      await submit()
      expect(host.querySelector('.form-error')).toBeNull()
      const saved = loadStore().store
      expect(saved.groups[0]!.members.map(member => member.name)).toEqual(['Amy', 'Cam'])
      expect(saved.memberByGroup.a).toBe(saved.groups[0]!.members[1]!.id)
    })

    it('refuses a name another member took after the group was found', async () => {
      await mount()
      await submit()
      await typeName('cam')
      saveStore({ ...emptyStore(), groups: [{ ...group(), members: [...group().members, { id: 'cam', name: 'Cam' }] }], cloudRevisions: { a: 1 } })
      await act(async () => {
        window.dispatchEvent(new StorageEvent('storage', { key: STORE_KEY }))
      })
      const before = localStorage.getItem(STORE_KEY)
      await submit()
      expect(host.querySelector('.form-error')?.textContent).toBe('Use a different name for each member.')
      expect(localStorage.getItem(STORE_KEY)).toBe(before)
    })
  })

  it('ignores a lookup belonging to an abandoned invitation form', async () => {
    let finish!: (value: { group: Group; revision: number }) => void
    mocks.join.mockReturnValue(
      new Promise(resolve => {
        finish = resolve
      }),
    )
    await mount()
    await submit()
    expect(host.querySelector<HTMLInputElement>('form input')!.disabled).toBe(true)
    await navigate(codeB)
    expect(host.querySelector<HTMLInputElement>('form input')!.disabled).toBe(false)
    await act(async () => finish({ group: group(), revision: 1 }))
    expect(loadStore().store.groups).toEqual([])
    expect(host.querySelector<HTMLInputElement>('form input')!.value).toBe(codeB)
  })
})

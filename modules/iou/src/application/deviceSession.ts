import { readSavedRaw, readSavedStore, saveStore, type StoreRead } from '../infrastructure/storage/store'
import { emptyStore, type AppStore } from './deviceStore'

/** What a screen needs to know about this device's saved data. */
export interface DeviceView {
  store: AppStore
  /** A problem with the saved data, or with caching it, that the user should see. */
  notice: string
  /** The saved data cannot be read, so editing stays blocked until it is recovered or reset. */
  recoveryRequired: boolean
}

export interface DeviceSession {
  /** The latest view. It is a new object whenever anything in it changes, so it can feed useSyncExternalStore. */
  view: () => DeviceView
  subscribe: (listener: () => void) => () => void
  /** The store with any change another tab saved. Throws when the saved data cannot be used. */
  latest: () => AppStore
  /** Save a new store, unless another tab saved in the meantime. */
  commit: (next: AppStore) => void
  update: (change: (latest: AppStore) => AppStore) => void
  /** Another tab changed the saved data: read it again. */
  adoptExternal: () => void
  /** Replace unreadable saved data with an empty store. */
  reset: () => void
  /** Save the store this tab shows again after a failed write. */
  retryCaching: () => void
  /** The exact saved text, so unreadable data can be downloaded before it is reset. */
  recoveryBackup: () => string
}

/**
 * One tab's view of the single saved store. Saves are compare-and-set on the saved text, so a tab
 * never overwrites what another tab wrote after this tab last read it. The store and the text it was
 * parsed from always come from the same read.
 */
export function createDeviceSession(initial: StoreRead, onShow?: (previous: AppStore, next: AppStore) => void): DeviceSession {
  let fingerprint = initial.raw
  let state: DeviceView = { store: initial.store, notice: initial.error ?? '', recoveryRequired: Boolean(initial.error && !initial.unavailable) }
  const listeners = new Set<() => void>()

  const publish = (next: DeviceView) => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  const show = (next: AppStore, rest: Partial<DeviceView> = {}) => {
    onShow?.(state.store, next)
    publish({ ...state, ...rest, store: next })
  }

  const latest = () => {
    if (readSavedRaw() !== fingerprint) {
      const external = readSavedStore()
      if (external.error) throw new Error(external.error)
      fingerprint = external.raw
      show(external.store)
    }
    return state.store
  }
  const commit = (next: AppStore) => {
    if (state.recoveryRequired) throw new Error('Recover or reset your saved data before making changes. Open Help to download a recovery backup.')
    // A change that leaves the store as it was needs neither a write nor a new render.
    if (next === state.store) return
    if (readSavedRaw() !== fingerprint) throw new Error('Your saved data changed in another tab. Try saving again.')
    fingerprint = saveStore(next)
    show(next)
  }

  return {
    view: () => state,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    latest,
    commit,
    update: change => commit(change(latest())),
    adoptExternal: () => {
      const external = readSavedStore()
      if (external.error) {
        publish({ ...state, notice: external.error, recoveryRequired: !external.unavailable })
        return
      }
      fingerprint = external.raw
      show(external.store, { notice: '', recoveryRequired: false })
    },
    reset: () => {
      const next = emptyStore()
      fingerprint = saveStore(next)
      publish({ store: next, notice: '', recoveryRequired: false })
    },
    retryCaching: () => {
      if (readSavedRaw() !== fingerprint) throw new Error('Your saved data changed in another tab. Reload before retrying caching.')
      fingerprint = saveStore(state.store)
      publish({ ...state, notice: '' })
    },
    recoveryBackup: () => {
      const raw = readSavedRaw()
      if (raw === null) throw new Error('There is no saved browser data to download.')
      return raw
    },
  }
}

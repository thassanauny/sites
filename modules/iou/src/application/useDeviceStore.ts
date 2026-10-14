import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { readSavedStore, STORE_KEY } from '../infrastructure/storage/store'
import { createDeviceSession } from './deviceSession'
import type { AppStore } from './deviceStore'

/** This tab's view of the saved store, kept in step with other tabs through storage events. */
export function useDeviceStore(onShow: (previous: AppStore, next: AppStore) => void) {
  const showing = useRef(onShow)
  useEffect(() => {
    showing.current = onShow
  })
  const [session] = useState(() => createDeviceSession(readSavedStore(), (previous, next) => showing.current(previous, next)))
  const view = useSyncExternalStore(session.subscribe, session.view)
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === STORE_KEY || event.key === null) session.adoptExternal()
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [session])
  return { session, ...view }
}

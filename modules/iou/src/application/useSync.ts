import { useCallback, useEffect, useRef, useState } from 'react'
import { cloudConfigured, createCloudGroup, joinCloudGroup, loadCloudGroups, loadCloudVersions, saveCloudGroup, watchCloudGroups } from '../infrastructure/cloud/groups'
import { errorMessage } from '../ui/format'
import type { DeviceSession } from './deviceSession'
import { POLL_MS, pollDelay } from './sync/backoff'
import { syncOffline } from './sync/synchronize'
import { withSyncLock } from './sync/lock'

/** Synchronizes durable groups on startup, reconnect, live hints and periodic reconciliation. */
export function useSync(session: DeviceSession, recoveryRequired: boolean) {
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [lastSync, setLastSync] = useState('')
  const [liveHealthy, setLiveHealthy] = useState(false)
  const [unavailableSharedIds, setUnavailableSharedIds] = useState<string[]>([])
  const [unreadableSharedIds, setUnreadableSharedIds] = useState<string[]>([])
  const running = useRef(false)
  const requested = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requested.current = false
    }
  }, [])
  // Bumped when the user's own action changes which groups they can see, so an older sync result is ignored.
  const accessEpoch = useRef(0)
  // Automatic refreshes pause after failures; the user's own actions and reconnecting never wait.
  const failures = useRef(0)
  const pausedUntil = useRef(0)
  // The revision of each shared group that this version of iou could not read; it is not downloaded again until it changes.
  const unreadableAt = useRef(new Map<string, number>())

  const sync = useCallback(async (): Promise<void> => {
    if (!mounted.current || !cloudConfigured || !navigator.onLine || session.view().recoveryRequired) return
    if (running.current) {
      requested.current = true
      return
    }
    running.current = true
    setSyncing(true)
    let expectedIds: string[] = []
    const epoch = accessEpoch.current
    try {
      const result = await withSyncLock(() => {
        expectedIds = Object.entries(session.latest().cloudRevisions)
          .filter(([, revision]) => revision > 0)
          .map(([id]) => id)
        return syncOffline(
          { read: session.latest, update: session.update, online: () => navigator.onLine },
          { versions: loadCloudVersions, load: loadCloudGroups, create: createCloudGroup, save: saveCloudGroup, join: joinCloudGroup },
          unreadableAt.current,
        )
      })
      if (!result) return
      const { accessible, unreadable } = result
      if (accessEpoch.current === epoch) setUnavailableSharedIds(expectedIds.filter(id => !session.view().store.removedGroupIds.includes(id) && !accessible.includes(id)))
      setUnreadableSharedIds(unreadable)
      failures.current = 0
      pausedUntil.current = 0
      setSyncError('')
      setLastSync(new Date().toISOString())
    } catch (err) {
      failures.current++
      pausedUntil.current = Date.now() + pollDelay(failures.current)
      setSyncError(errorMessage(err))
    } finally {
      running.current = false
      setSyncing(false)
      if (requested.current) {
        requested.current = false
        if (Date.now() >= pausedUntil.current) void sync()
      }
    }
  }, [session])

  // Saved data that was unreadable can be used again once it is recovered.
  useEffect(() => {
    if (!recoveryRequired) void sync()
  }, [recoveryRequired, sync])
  useEffect(() => {
    const connection = () => {
      setOnline(navigator.onLine)
      if (navigator.onLine) void sync()
    }
    const visible = () => {
      if (document.visibilityState === 'visible') void sync()
    }
    const poll = () => {
      if (Date.now() >= pausedUntil.current) visible()
    }
    window.addEventListener('online', connection)
    window.addEventListener('offline', connection)
    document.addEventListener('visibilitychange', visible)
    const interval = cloudConfigured ? window.setInterval(poll, liveHealthy && !syncError ? 60_000 : POLL_MS) : undefined
    return () => {
      window.removeEventListener('online', connection)
      window.removeEventListener('offline', connection)
      document.removeEventListener('visibilitychange', visible)
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [sync, liveHealthy, syncError])

  useEffect(() => {
    if (!cloudConfigured || recoveryRequired) return
    let stop: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const listen = () => {
      stop?.()
      stop = undefined
      clearTimeout(timer)
      timer = undefined
      setLiveHealthy(false)
      if (!navigator.onLine || document.visibilityState !== 'visible') return
      stop = watchCloudGroups(version => {
        try {
          if (version && version.revision <= (session.latest().cloudRevisions[version.id] ?? 0)) return
        } catch {
          return
        }
        if (timer !== undefined) return
        timer = setTimeout(() => {
          timer = undefined
          if (Date.now() >= pausedUntil.current) void sync()
        }, 150)
      }, setLiveHealthy)
    }
    listen()
    window.addEventListener('online', listen)
    window.addEventListener('offline', listen)
    document.addEventListener('visibilitychange', listen)
    return () => {
      stop?.()
      clearTimeout(timer)
      window.removeEventListener('online', listen)
      window.removeEventListener('offline', listen)
      document.removeEventListener('visibilitychange', listen)
    }
  }, [recoveryRequired, session, sync])

  /** The group is visible to this device again (rejoined) or has been removed from it. */
  const accessChanged = useCallback((groupId: string) => {
    accessEpoch.current++
    unreadableAt.current.delete(groupId)
    setUnavailableSharedIds(ids => ids.filter(id => id !== groupId))
    setUnreadableSharedIds(ids => ids.filter(id => id !== groupId))
  }, [])
  const clearUnavailable = useCallback(() => {
    unreadableAt.current.clear()
    setUnavailableSharedIds([])
    setUnreadableSharedIds([])
  }, [])

  return { sync, online, syncing, syncError, lastSync, unavailableSharedIds, unreadableSharedIds, accessChanged, clearUnavailable }
}

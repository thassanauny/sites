import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { version as appVersion } from '../../package.json'
import { ArrowUpRight, Check, CircleHelp, History, Home, Link, Settings2, Plane, Plus, RefreshCw, Search, Users, WifiOff, X } from 'lucide-react'
import type { Group, Settlement, Transaction } from '../domain/groups/types'
import { getCurrencyBalances, validateGroup } from '../domain/ledger/calculations'
import { getTransactionFeed, type TransactionFilter } from '../domain/ledger/transactions'
import { travelLaunchHash, type TravelModeSettings } from '../domain/travel/preferences'
import { editStamp } from '../domain/groups/editStamp'
import { cloudConfigured, joinCloudGroup } from '../infrastructure/cloud/groups'
import { downloadGroup } from '../features/groups/exportGroup'
import { CreateGroupForm, ExpenseForm, PaymentForm, TravelModeForm, type NewGroupValues, type SettingsValues } from '../features/groups/Forms'
import { GroupPage } from '../features/groups/GroupPage'
import { GroupsSection, type GroupFilter } from '../features/groups/GroupsSection'
import { HomeIntro } from '../features/groups/HomeIntro'
import { InviteContent, JoinForm } from '../features/groups/Membership'
import { SettingsDialog } from '../features/groups/SettingsDialog'
import { DeleteForm } from '../features/transactions/DeleteForm'
import { TransactionRow } from '../features/transactions/TransactionRow'
import { TransactionsPage } from '../features/transactions/TransactionsPage'
import { downloadFile } from '../ui/download'
import { errorMessage } from '../ui/format'
import { HelpDialog } from '../ui/HelpDialog'
import { Modal } from '../ui/Modal'
import { PAGE_SIZE } from '../ui/Pagination'
import { PageFooter } from '../ui/PageFooter'
import { RecoveryDialog } from '../ui/RecoveryDialog'
import { balancesOf, newestFirst, settlementsOf } from './groupViews'
import { navigate, navigateGroups, navigateTransactions, route } from './navigation'
import { removeGroupFromDevice, restoreInvitation, updateTravelMode, type AppStore } from './deviceStore'
import { mergeLatestGroup } from './sync/merge'
import { queueGroup, queueJoin } from './sync/queue'
import { useDeviceStore } from './useDeviceStore'
import { useSync } from './useSync'

type ModalState =
  | { type: 'create' | 'expense' | 'invite' | 'help' | 'travel' | 'recovery' }
  | { type: 'settings'; group: Group; removing?: boolean }
  | { type: 'join'; code?: string }
  | { type: 'payment'; settlement?: Settlement }
  | { type: 'delete'; transaction: Transaction }

export default function App() {
  const { session, store, notice, recoveryRequired } = useDeviceStore((previous, next) => followRenamedGroup(previous, next))
  const [launchHash] = useState(() => travelLaunchHash(window.location.hash, store.travelMode, store.groups))
  const [page, setPage] = useState(() => route(launchHash))
  const currentRoute = useRef(page)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [toast, setToast] = useState<{ message: string; duration?: number } | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<GroupFilter>('all')
  const [logFilter, setLogFilter] = useState<TransactionFilter>('all')
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE)
  const { sync, online, syncing, syncError, lastSync, unavailableSharedIds, unreadableSharedIds, accessChanged, clearUnavailable } = useSync(session, recoveryRequired)
  const {
    needRefresh: [needsUpdate, setNeedsUpdate],
    updateServiceWorker,
  } = useRegisterSW()
  const group = store.groups.find(g => g.inviteCode === page.groupCode)
  const canEdit = !!group && cloudConfigured && !recoveryRequired
  const pendingCount = store.outbox.length + store.pendingJoins.length
  const footerMessage = pendingCount
    ? 'Saved on this device. Waiting to sync.'
    : !cloudConfigured
      ? 'Connect Supabase to create and join groups.'
      : lastSync
        ? `Synced ${new Date(lastSync).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`
        : 'Waiting for first sync.'
  const notify = (message: string, duration = 4500) => setToast({ message, duration })
  const unreadableNotice =
    group && unreadableSharedIds.includes(group.id)
      ? 'This group’s shared copy could not be read by this version of iou, so it is not updating. Your changes stay on this device. Update iou to try again.'
      : unreadableSharedIds.length
        ? `${unreadableSharedIds.length === 1 ? 'A shared group' : `${unreadableSharedIds.length} shared groups`} could not be read by this version of iou and ${unreadableSharedIds.length === 1 ? 'is' : 'are'} not updating. Your other groups keep syncing.`
        : ''

  /** A group's invitation code can change when it first syncs; keep the open page on it. */
  function followRenamedGroup(previous: AppStore, next: AppStore) {
    const viewed = previous.groups.find(g => g.inviteCode === currentRoute.current.groupCode)
    const updated = viewed && next.groups.find(g => g.id === viewed.id)
    if (updated && updated.inviteCode !== viewed.inviteCode) {
      const hash = `#/group/${updated.inviteCode}${currentRoute.current.log ? '/log' : ''}`
      window.history.replaceState(null, '', hash)
      currentRoute.current = route(hash)
      setPage(currentRoute.current)
    }
  }

  useEffect(() => {
    if (launchHash !== window.location.hash) window.history.replaceState(null, '', launchHash)
  }, [launchHash])
  useEffect(() => {
    const changed = () => {
      const next = route()
      const changedPage =
        next.groupCode !== currentRoute.current.groupCode ||
        next.groups !== currentRoute.current.groups ||
        next.transactions !== currentRoute.current.transactions ||
        next.joinCode !== currentRoute.current.joinCode
      if (changedPage) setModal(null)
      currentRoute.current = next
      setPage(next)
      setLogFilter('all')
      setPageLimit(PAGE_SIZE)
      if (next.joinCode) setModal({ type: 'join', code: next.joinCode })
    }
    window.addEventListener('hashchange', changed)
    if (currentRoute.current.joinCode) setModal({ type: 'join', code: currentRoute.current.joinCode })
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), toast.duration ?? 4500)
    return () => window.clearTimeout(timer)
  }, [toast])
  const documentTitle = group ? `${group.name} · iou` : page.groups ? 'Groups · iou' : page.transactions ? 'Transactions · iou' : 'iou · Split it. Settle it.'
  useEffect(() => {
    document.title = documentTitle
  }, [documentTitle])

  const closeModal = () => {
    setModal(null)
    if (page.joinCode) navigate()
  }
  const runAction = useCallback(async (action: () => Promise<void> | void) => {
    try {
      await action()
    } catch (err) {
      setToast({ message: errorMessage(err) })
    }
  }, [])
  const resetSavedData = () => {
    session.reset()
    clearUnavailable()
    closeModal()
  }
  const downloadRecovery = () => downloadFile('iou-recovery.json', session.recoveryBackup(), 'application/json')
  const openSettings = () => {
    if (group) setModal({ type: 'settings', group })
  }
  const saveTravelSettings = async (settings: TravelModeSettings) => {
    const next = updateTravelMode(session.latest(), settings)
    session.commit(next)
    closeModal()
    if (settings.enabled) navigate(next.groups.find(g => g.id === settings.defaultGroupId)!.inviteCode)
    notify(settings.enabled ? 'Travel mode is on. This group will open when you launch iou.' : 'Travel mode is off.')
  }
  const removeDeviceGroup = (groupId: string) => {
    session.commit(removeGroupFromDevice(session.latest(), groupId))
    accessChanged(groupId)
    setModal(null)
    navigateGroups()
    notify('Group removed from this device. Rejoin anytime with its invitation code.')
  }
  const updateGroup = async (groupId: string, change: (latest: Group) => Group, identity?: string) => {
    if (session.view().recoveryRequired) throw new Error('Recover or reset your saved data before making changes.')
    const base = session.latest()
    const latest = base.groups.find(g => g.id === groupId)
    if (!latest) throw new Error('This group could not be found.')
    const draft = validateGroup({ ...change(latest), updatedAt: editStamp(latest.updatedAt) })
    if (draft.currency !== latest.currency) throw new Error('The currency is fixed for this group.')
    session.commit(queueGroup(base, draft, identity))
    void sync()
  }
  const saveNewGroup = async (draft: Group) => {
    if (session.view().recoveryRequired) throw new Error('Recover or reset your saved data before creating a group.')
    if (!cloudConfigured) throw new Error('Connect Supabase before creating a shared group.')
    const next = queueGroup(session.latest(), draft, draft.members[0].id)
    session.commit({ ...next, pinnedIds: next.pinnedIds.includes(draft.id) ? next.pinnedIds : [...next.pinnedIds, draft.id] })
    closeModal()
    navigate(draft.inviteCode)
    notify('Group saved on this device. Its invitation will be ready after syncing.')
    void sync()
  }
  const createGroup = async (values: NewGroupValues) => {
    const now = new Date().toISOString()
    const newGroup = validateGroup({
      id: values.id,
      name: values.name,
      description: values.description,
      currency: values.currency,
      icon: values.icon,
      color: values.color,
      inviteCode: crypto.randomUUID().replaceAll('-', ''),
      createdAt: now,
      updatedAt: now,
      members: values.names.map(name => ({ id: crypto.randomUUID(), name })),
      transactions: [],
    })
    await saveNewGroup(newGroup)
  }
  const addTransaction = async (transaction: Transaction) => {
    if (!group) return
    if (
      session
        .view()
        .store.groups.find(g => g.id === group.id)
        ?.transactions.some(t => t.id === transaction.id)
    ) {
      closeModal()
      notify('This transaction was already saved. Your balances are up to date.')
      return
    }
    await updateGroup(group.id, latest => ({ ...latest, transactions: [...latest.transactions, transaction] }))
    closeModal()
    notify(transaction.type === 'expense' ? 'Expense added. The balances are up to date.' : 'Payment recorded. One less loose end.', transaction.type === 'expense' ? 2000 : 4500)
  }
  const saveSettings = async (values: SettingsValues) => {
    if (!group || modal?.type !== 'settings') return
    if (group.id !== modal.group.id) throw new Error('The open group changed. Close settings and open them again.')
    const { yourId: identity, ...settings } = values
    await updateGroup(group.id, latest => mergeLatestGroup(modal.group, { ...modal.group, ...settings, updatedAt: editStamp(latest.updatedAt) }, latest), identity)
    closeModal()
    notify('Group settings saved.')
  }
  const togglePin = useCallback(
    (id: string) =>
      runAction(() => {
        const base = session.latest()
        const pinned = base.pinnedIds.includes(id)
        session.commit({ ...base, pinnedIds: pinned ? base.pinnedIds.filter(p => p !== id) : [...base.pinnedIds, id] })
        setToast({ message: pinned ? 'Group unpinned.' : 'Pinned to your home screen.' })
      }),
    [session, runAction],
  )
  const saveJoinRequest = (code: string, name: string, memberId: string) => {
    session.update(latest => queueJoin(latest, { code, name, memberId, createdAt: new Date().toISOString() }))
    closeModal()
    notify('Join request saved. It will finish when connected.')
    void sync()
  }
  const fetchInvitation = async (code: string, isCurrent: () => boolean) => {
    const started = session.latest()
    const cached = started.groups.find(g => g.inviteCode === code)
    if (!navigator.onLine) return cached ?? null
    try {
      const result = await joinCloudGroup(code)
      if (!isCurrent()) throw new Error('This invitation is no longer open. Open it again to rejoin.')
      session.update(base => restoreInvitation(base, result, started))
      accessChanged(result.group.id)
      return session.view().store.groups.find(g => g.id === result.group.id)!
    } catch (error) {
      if (/connect|network|fetch/i.test(errorMessage(error))) return cached ?? null
      throw error
    }
  }
  const joinGroup = async (joined: Group, selectedId: string, name: string, newMemberId: string) => {
    const id = selectedId || newMemberId
    // One save: a new member and "this is me" are stored together, never one without the other.
    session.update(base => {
      const latest = base.groups.find(g => g.id === joined.id)
      if (!latest || base.removedGroupIds.includes(joined.id)) throw new Error('This group was removed from this device. Open its invitation again to rejoin.')
      if (selectedId && !latest.members.some(member => member.id === selectedId)) throw new Error('That member is no longer in this group. Open its invitation again.')
      const added =
        selectedId || latest.members.some(member => member.id === id)
          ? base
          : queueGroup(base, { ...latest, members: [...latest.members, { id, name: name.trim() }], updatedAt: editStamp(latest.updatedAt) })
      const next = { ...added, memberByGroup: { ...added.memberByGroup, [joined.id]: id } }
      return !navigator.onLine || syncError ? queueJoin(next, { code: joined.inviteCode, name, memberId: id, createdAt: new Date().toISOString() }) : next
    })
    void sync()
    closeModal()
    navigate(session.view().store.groups.find(g => g.id === joined.id)!.inviteCode)
    notify('You’re in! Welcome to the group.')
  }

  const openGroup = useCallback((g: Group) => navigate(g.inviteCode), [])
  const openLog = useCallback((g: Group) => navigate(g.inviteCode, true), [])
  const openDelete = useCallback((transaction: Transaction) => setModal({ type: 'delete', transaction }), [])
  const changeFilter = (type: TransactionFilter) => {
    setLogFilter(type)
    setPageLimit(PAGE_SIZE)
  }
  const showMore = () => setPageLimit(limit => limit + PAGE_SIZE)
  const yourId = group ? store.memberByGroup[group.id] : undefined
  const balanceOf = (g: Group) => balancesOf(g).find(b => b.member.id === store.memberByGroup[g.id])?.balance
  const transactions = useMemo(() => (group ? newestFirst(group) : []), [group])
  const visibleTransactions = useMemo(() => transactions.filter(t => logFilter === 'all' || t.type === logFilter), [transactions, logFilter])
  const transactionFeed = useMemo(() => (page.transactions ? getTransactionFeed(store.groups, logFilter) : []), [store.groups, page.transactions, logFilter])
  const currencyBalances = useMemo(
    () => getCurrencyBalances(store.groups.map(g => ({ currency: g.currency, balance: balancesOf(g).find(b => b.member.id === store.memberByGroup[g.id])?.balance || 0 }))),
    [store.groups, store.memberByGroup],
  )
  const openCurrencyBalances = currencyBalances.filter(c => c.owed || c.owes)

  return (
    <div className={`app-shell ${group ? 'in-group' : ''}`}>
      <button
        type="button"
        className="skip-link"
        onClick={event => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        Skip to content
      </button>
      <header className="site-header">
        <div className="header-inner">
          <button type="button" className="brand" onClick={() => navigate()} aria-label="iou home">
            <img className="brand-mark" src={`${import.meta.env.BASE_URL}logo.svg`} width="32" height="32" alt="" />
            iou<span className="brand-dot">.</span>
          </button>
          <nav className="desktop-nav" aria-label="Main navigation">
            <button
              type="button"
              className={!group && !page.groups && !page.transactions ? 'active' : ''}
              aria-current={!group && !page.groups && !page.transactions ? 'page' : undefined}
              onClick={() => navigate()}
            >
              Home
            </button>
            <button type="button" className={!group && page.groups ? 'active' : ''} aria-current={!group && page.groups ? 'page' : undefined} onClick={navigateGroups}>
              Groups
            </button>
            <button type="button" className={page.transactions ? 'active' : ''} aria-current={page.transactions ? 'page' : undefined} onClick={navigateTransactions}>
              Transactions
            </button>
            <button type="button" aria-haspopup="dialog" aria-expanded={modal?.type === 'travel'} onClick={() => setModal({ type: 'travel' })}>
              Travel mode
            </button>
          </nav>
          <div className="header-actions">
            {group && (
              <div className="group-top-actions workspace-actions">
                <button type="button" className="icon-button group-invite workspace-invite" onClick={() => setModal({ type: 'invite' })} aria-label="Invite">
                  <Link size={18} />
                  <span className="group-invite-label">Invite</span>
                </button>
                <button type="button" className="icon-button group-settings workspace-settings" onClick={openSettings} aria-label="Group settings">
                  <Settings2 size={20} />
                  <span className="group-settings-label">Settings</span>
                </button>
              </div>
            )}
            <span className={`connection ${!online ? 'offline' : ''}`}>
              {!online ? <WifiOff size={13} /> : <span className="tiny-dot" />}
              <span className="connection-label">
                {!online ? 'Offline' : !cloudConfigured ? 'Setup required' : syncing ? 'Syncing' : syncError ? 'Needs attention' : lastSync ? 'Connected' : 'Connecting'}
              </span>
            </span>
            <button type="button" className="icon-button help-button" aria-label="Help" onClick={() => setModal({ type: 'help' })}>
              <CircleHelp size={21} />
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className={`main-container${page.groups ? ' groups-page' : ''}`}>
        {notice && (
          <div className="notice warning" role="alert">
            <span>{notice}</span>
            <button type="button" className="text-button" onClick={() => (recoveryRequired ? setModal({ type: 'recovery' }) : void runAction(session.retryCaching))}>
              {recoveryRequired ? 'Recover data' : 'Retry caching'}
            </button>
          </div>
        )}
        {group && unavailableSharedIds.includes(group.id) && (
          <div className="notice warning" role="alert">
            <span>Your changes stay on this device. Rejoin this group to sync them.</span>
            <button type="button" className="text-button" onClick={() => setModal({ type: 'join', code: group.inviteCode })}>
              Rejoin group
            </button>
          </div>
        )}
        {unreadableNotice && (
          <div className="notice warning" role="alert">
            <span>{unreadableNotice}</span>
          </div>
        )}
        {!online && (
          <div className="notice">
            <WifiOff size={18} />
            <span>You’re offline. Changes save on this device and sync when connected.</span>
          </div>
        )}
        {cloudConfigured && syncError && online && (
          <div className="notice warning" role="alert">
            <span>Changes are saved on this device. Could not sync: {syncError}</span>
            <button type="button" className="text-button" onClick={() => void sync()}>
              <RefreshCw size={15} />
              Retry
            </button>
          </div>
        )}
        {pendingCount > 0 && online && !syncError && (
          <div className="notice" role="status">
            <RefreshCw size={16} />
            <span>{syncing ? 'Syncing saved changes…' : 'Saved on this device. Waiting to sync.'}</span>
          </div>
        )}
        {store.pendingJoins.map(request => (
          <div className="notice" key={request.code}>
            <span>
              Join request for {request.name} saved. Code: {request.code.slice(0, 8)}…
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void runAction(() => {
                  session.update(latest => ({ ...latest, pendingJoins: latest.pendingJoins.filter(item => item.code !== request.code) }))
                  notify('Join request cancelled.')
                })
              }
            >
              Cancel request
            </button>
          </div>
        ))}
        {page.groupCode && !group ? (
          <div className="empty-state">
            <Search size={36} />
            <h2>We couldn’t find that group.</h2>
            <p>Open your groups or use an invitation code to join.</p>
            <button type="button" className="button primary" onClick={navigateGroups}>
              Go to groups
            </button>
          </div>
        ) : page.transactions ? (
          <TransactionsPage entries={transactionFeed} filter={logFilter} limit={pageLimit} hasGroups={store.groups.length > 0} onFilter={changeFilter} onShowMore={showMore} onOpenLog={openLog} />
        ) : !group ? (
          <>
            {!page.groups && (
              <HomeIntro
                groupCount={store.groups.length}
                pinnedCount={store.pinnedIds.length}
                openBalances={openCurrencyBalances}
                onCreate={() => setModal({ type: 'create' })}
                onJoin={() => setModal({ type: 'join' })}
              />
            )}
            <GroupsSection
              all={page.groups}
              groups={store.groups}
              pinnedIds={store.pinnedIds}
              balanceOf={balanceOf}
              search={search}
              filter={filter}
              onSearch={setSearch}
              onFilter={setFilter}
              onCreate={() => setModal({ type: 'create' })}
              onJoin={() => setModal({ type: 'join' })}
              onBrowse={navigateGroups}
              onOpen={openGroup}
              onTogglePin={togglePin}
            />
          </>
        ) : (
          <GroupPage
            group={group}
            log={page.log}
            yourId={yourId}
            balances={balancesOf(group)}
            settlements={settlementsOf(group)}
            transactions={transactions}
            visibleTransactions={visibleTransactions}
            logFilter={logFilter}
            logLimit={pageLimit}
            canEdit={canEdit}
            onNavigate={target => (target === 'home' ? navigate() : navigate(group.inviteCode, target === 'log'))}
            onSettings={openSettings}
            onExpense={() => setModal({ type: 'expense' })}
            onPayment={settlement => setModal({ type: 'payment', settlement })}
            onFilter={changeFilter}
            onShowMore={showMore}
            onDelete={openDelete}
          />
        )}
        <PageFooter message={footerMessage} version={appVersion} />
      </main>
      {group ? (
        <div className="mobile-group-actions">
          <button type="button" className="button secondary" disabled={!canEdit} onClick={() => setModal({ type: 'payment' })}>
            <ArrowUpRight size={19} />
            Add payment
          </button>
          <button type="button" className="button primary" disabled={!canEdit} onClick={() => setModal({ type: 'expense' })}>
            <Plus size={20} />
            Add expense
          </button>
        </div>
      ) : (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          <button type="button" className={!page.groups && !page.transactions ? 'active' : ''} aria-current={!page.groups && !page.transactions ? 'page' : undefined} onClick={() => navigate()}>
            <Home size={22} />
            <span>Home</span>
          </button>
          <button type="button" className={page.groups ? 'active' : ''} aria-current={page.groups ? 'page' : undefined} onClick={navigateGroups}>
            <Users size={23} />
            <span>Groups</span>
          </button>
          <button type="button" className={page.transactions ? 'active' : ''} aria-current={page.transactions ? 'page' : undefined} onClick={navigateTransactions}>
            <History size={22} />
            <span>Transactions</span>
          </button>
          <button type="button" className={modal?.type === 'travel' ? 'active' : ''} aria-haspopup="dialog" aria-expanded={modal?.type === 'travel'} onClick={() => setModal({ type: 'travel' })}>
            <Plane size={22} />
            <span>Travel mode</span>
          </button>
        </nav>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast.message}</span>
          <button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {needsUpdate && (
        <div className="update-banner" role="status">
          <span>A fresh version of iou is ready.</span>
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            Update
          </button>
          <button type="button" aria-label="Dismiss update" onClick={() => setNeedsUpdate(false)}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal?.type === 'create' && (
        <Modal title="Make room for your people." subtitle="Create a group, start a shared tab." onClose={closeModal}>
          <CreateGroupForm onSubmit={createGroup} />
        </Modal>
      )}
      {modal?.type === 'expense' && group && (
        <Modal title="Add an expense" subtitle={`A little spent together. ${group.currency} only.`} onClose={closeModal} compact>
          <ExpenseForm group={group} yourId={yourId} onSubmit={addTransaction} />
        </Modal>
      )}
      {modal?.type === 'payment' && group && (
        <Modal title="Record a payment" subtitle="A step closer to all square." onClose={closeModal}>
          <PaymentForm group={group} initial={modal.settlement} onSubmit={addTransaction} />
        </Modal>
      )}
      {modal?.type === 'settings' && group && (
        <SettingsDialog
          group={modal.group}
          removing={!!modal.removing}
          yourId={yourId}
          pending={store.outbox.some(item => item.group.id === group.id)}
          published={store.cloudRevisions[group.id] > 0}
          travelDefault={store.travelMode.defaultGroupId === modal.group.id}
          onClose={closeModal}
          onSave={saveSettings}
          onExport={() =>
            void runAction(() => {
              downloadGroup(group)
              notify('Group CSV exported.')
            })
          }
          onRemoving={removing => setModal({ ...modal, removing })}
          onRemove={() => removeDeviceGroup(modal.group.id)}
        />
      )}
      {modal?.type === 'join' && (
        <Modal title="Good company awaits." subtitle="Enter your group’s unique invitation code." onClose={closeModal}>
          <JoinForm key={modal.code ?? 'manual'} code={modal.code} configured={cloudConfigured} onQueue={saveJoinRequest} onFetch={fetchInvitation} onJoin={joinGroup} />
        </Modal>
      )}
      {modal?.type === 'invite' && group && (
        <Modal title="Bring your people along." subtitle={`Invite someone to ${group.name}.`} onClose={closeModal}>
          <InviteContent group={group} published={store.cloudRevisions[group.id] > 0} onCopy={notify} />
        </Modal>
      )}
      {modal?.type === 'delete' && group && (
        <Modal title="Delete this transaction?" subtitle="The group’s balances will be recalculated." onClose={closeModal}>
          <div className="delete-preview">
            <TransactionRow transaction={modal.transaction} group={group} onDelete={openDelete} canDelete={canEdit} />
          </div>
          <p className="help-paragraph">This removes the entry for everyone in the shared group. This action cannot be undone.</p>
          <DeleteForm
            onSubmit={async () => {
              await updateGroup(group.id, latest => ({ ...latest, transactions: latest.transactions.filter(t => t.id !== modal.transaction.id) }))
              closeModal()
              notify('Transaction deleted. Balances updated.')
            }}
            onCancel={closeModal}
          />
        </Modal>
      )}
      {modal?.type === 'travel' && (
        <Modal title="Travel mode" onClose={closeModal}>
          <TravelModeForm groups={store.groups} settings={store.travelMode} onSubmit={saveTravelSettings} />
        </Modal>
      )}
      {modal?.type === 'help' && <HelpDialog cloudConfigured={cloudConfigured} recoveryRequired={recoveryRequired} onClose={closeModal} onRecover={() => setModal({ type: 'recovery' })} />}
      {modal?.type === 'recovery' && <RecoveryDialog onClose={closeModal} onDownload={() => void runAction(downloadRecovery)} onReset={() => void runAction(resetSavedData)} />}
    </div>
  )
}

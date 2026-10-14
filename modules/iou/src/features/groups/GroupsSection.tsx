import { ArrowRight, Link, Pin, Plus, Search, Users } from 'lucide-react'
import type { Group } from '../../domain/groups/types'
import { GroupCard } from './GroupCard'

export type GroupFilter = 'all' | 'pinned'

interface GroupsSectionProps {
  /** The Groups page, with search and filters, instead of the pinned groups shown on Home. */
  all: boolean
  groups: readonly Group[]
  pinnedIds: readonly string[]
  balanceOf: (group: Group) => number | undefined
  search: string
  filter: GroupFilter
  onSearch: (value: string) => void
  onFilter: (filter: GroupFilter) => void
  onCreate: () => void
  onJoin: () => void
  onBrowse: () => void
  onOpen: (group: Group) => void
  onTogglePin: (groupId: string) => void
}

export function GroupsSection({ all, groups, pinnedIds, balanceOf, search, filter, onSearch, onFilter, onCreate, onJoin, onBrowse, onOpen, onTogglePin }: GroupsSectionProps) {
  const visible = groups.filter(g => (all ? (filter === 'all' || pinnedIds.includes(g.id)) && `${g.name} ${g.description}`.toLowerCase().includes(search.toLowerCase()) : pinnedIds.includes(g.id)))
  const pinnedGroups = visible.filter(g => pinnedIds.includes(g.id))
  const otherGroups = visible.filter(g => !pinnedIds.includes(g.id))
  const renderCard = (g: Group) => <GroupCard key={g.id} group={g} balance={balanceOf(g)} pinned={pinnedIds.includes(g.id)} onOpen={onOpen} onTogglePin={onTogglePin} />
  return (
    <section className="groups-section">
      <div className="section-heading">
        <div>
          <h2>
            {all ? 'Groups' : 'Pinned groups'}
            <span className="count-pill">{all ? groups.length : pinnedIds.length}</span>
          </h2>
          <p>{all ? 'The people you split life with.' : 'Your favourites, close at hand.'}</p>
        </div>
      </div>
      {all && (
        <div className="group-controls">
          <div className="group-controls-toolbar">
            {groups.length > 0 && (
              <div className="segmented">
                <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => onFilter('all')}>
                  All groups
                </button>
                <button type="button" className={filter === 'pinned' ? 'active' : ''} aria-pressed={filter === 'pinned'} onClick={() => onFilter('pinned')}>
                  <Pin size={14} />
                  Pinned
                </button>
              </div>
            )}
            <div className="groups-page-actions">
              <button type="button" className="button primary" aria-label="Create group" onClick={onCreate}>
                <Plus size={14} />
                Create
              </button>
              <button type="button" className="button secondary" aria-label="Join group" onClick={onJoin}>
                <Link size={14} />
                Join
              </button>
            </div>
          </div>
          {groups.length > 0 && (
            <label className="search-field">
              <Search size={17} />
              <input type="search" aria-label="Search groups" placeholder="Find a group…" value={search} onChange={e => onSearch(e.target.value)} />
            </label>
          )}
        </div>
      )}
      {groups.length === 0 ? (
        <div className="home-empty">
          <div className="empty-illustration">
            <Users size={33} strokeWidth={1.5} />
            <span>
              <Plus size={14} />
            </span>
          </div>
          <h3>Every good story starts with a group.</h3>
          <p>
            Create one for your next trip, your roommates,
            <br />
            or tonight’s dinner. We’ll handle the maths.
          </p>
          <button type="button" className="button primary" onClick={onCreate}>
            Create your first group
            <ArrowRight size={17} />
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-search">
          <Search size={28} />
          <h3>{!all || (filter === 'pinned' && !search) ? 'Keep your favourites close.' : 'No groups found.'}</h3>
          <p>{!all || (filter === 'pinned' && !search) ? 'Open Groups and tap the pin on any group to add it here.' : 'Try a different group name.'}</p>
          {!all && (
            <button type="button" className="button secondary" onClick={onBrowse}>
              Browse groups
              <ArrowRight size={17} />
            </button>
          )}
        </div>
      ) : (
        <>
          {pinnedGroups.length > 0 && (
            <>
              {all && (
                <div className="group-list-label">
                  <Pin size={14} />
                  PINNED GROUPS
                </div>
              )}
              <div className="group-grid">{pinnedGroups.map(renderCard)}</div>
            </>
          )}
          {otherGroups.length > 0 && (
            <>
              {pinnedGroups.length > 0 && <div className="group-list-label">ALL OTHER GROUPS</div>}
              <div className="group-grid">{otherGroups.map(renderCard)}</div>
            </>
          )}
        </>
      )}
    </section>
  )
}

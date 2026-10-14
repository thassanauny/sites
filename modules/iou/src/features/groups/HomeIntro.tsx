import { Check, Link, Pin, Plus, Sparkles, Users } from 'lucide-react'
import { formatMoney, type getCurrencyBalances } from '../../domain/ledger/calculations'
import { ReceiptArt } from '../../ui/components'

type CurrencyBalance = ReturnType<typeof getCurrencyBalances>[number]

interface HomeIntroProps {
  groupCount: number
  pinnedCount: number
  /** Currencies in which you owe or are owed something. */
  openBalances: readonly CurrencyBalance[]
  onCreate: () => void
  onJoin: () => void
}

/** The welcome banner and summary at the top of Home. */
export function HomeIntro({ groupCount, pinnedCount, openBalances, onCreate, onJoin }: HomeIntroProps) {
  return (
    <>
      <section className="home-hero">
        <div className="hero-copy">
          <h1>
            <span>Split it.</span> <em>Settle it.</em>
          </h1>
          <p>Trips, dinners, everyday things. Split them fairly.</p>
          <div className="hero-buttons">
            <button type="button" className="button primary" onClick={onCreate}>
              <Plus size={19} />
              Create a group
            </button>
            <button type="button" className="button secondary" onClick={onJoin}>
              <Link size={18} />
              Join a group
            </button>
          </div>
        </div>
        <div className="hero-visual">
          <ReceiptArt />
          <div className="hero-caption">
            <span className="caption-avatar">
              <Check size={14} />
            </span>
            <span>More memories. Fewer IOUs.</span>
            <Sparkles size={15} />
          </div>
        </div>
      </section>
      <section className="home-stats" aria-label="Your summary">
        <div>
          <span className="stat-icon">
            <Users size={20} />
          </span>
          <span>
            <strong>{groupCount}</strong>
            <span>{groupCount === 1 ? 'group together' : 'groups together'}</span>
          </span>
        </div>
        <div>
          <span className="stat-icon lavender">
            <Pin size={19} />
          </span>
          <span>
            <strong>{pinnedCount}</strong>
            <span>pinned for easy access</span>
          </span>
        </div>
        <div className="balance-stat">
          <div className="balance-stat-content">
            <strong>{openBalances.length ? 'Your open balances' : 'No loose ends'}</strong>
            {openBalances.length ? (
              <table className="currency-balances" aria-label="Open balances by currency">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Currency</span>
                    </th>
                    <th scope="col">You owe</th>
                    <th scope="col">You get back</th>
                  </tr>
                </thead>
                <tbody>
                  {openBalances.map(c => (
                    <tr key={c.code}>
                      <th scope="row">{c.code}</th>
                      <td className="amount-owes">
                        {c.owes ? (
                          formatMoney(c.owes, c.code, { includeCurrency: false })
                        ) : (
                          <span className="balance-zero" role="img" aria-label="0.00">
                            —
                          </span>
                        )}
                      </td>
                      <td className="amount-owed">
                        {c.owed ? (
                          formatMoney(c.owed, c.code, { includeCurrency: false })
                        ) : (
                          <span className="balance-zero" role="img" aria-label="0.00">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>A good place to start.</p>
            )}
          </div>
        </div>
      </section>
    </>
  )
}

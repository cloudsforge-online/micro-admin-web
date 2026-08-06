/**
 * Every market, by lifecycle state.
 *
 * The default filter is `closed`, not "everything". A closed market is one whose stakes are shut
 * and whose outcome has not been posted — it is the only state in the lifecycle that is WAITING
 * ON A PERSON with money already in it, and a console whose front page is an undifferentiated
 * list makes the operator find their own work.
 *
 * The table shows the close time and the contract address because those are the two facts that
 * decide what can be done to a row: nothing can be resolved before it closes, and nothing can be
 * opened or voided-on-chain without a contract.
 */
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, Failed, Forbidden, Loading } from '../../components/states.tsx'
import { StatusPill, statusMeaning } from '../../components/status.tsx'
import { loadMarkets, type MarketStatus } from '../../lib/foresight.ts'
import { shortId, utcStamp } from '../../lib/format.ts'
import { useResource } from '../../lib/resource.ts'
import { foresightPath } from '../../lib/routes.ts'

/** The seven states `parseStatus` accepts (foresight/src/server.ts), plus "any". */
const FILTERS: ReadonlyArray<{ value: MarketStatus | 'all'; label: string }> = [
  { value: 'closed', label: 'Needs an outcome' },
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'settled', label: 'Settled' },
  { value: 'void', label: 'Void' },
  { value: 'all', label: 'Every market' },
]

export function MarketsPage() {
  const [filter, setFilter] = useState<MarketStatus | 'all'>('closed')

  const markets = useResource(
    useCallback(
      (signal) => loadMarkets(filter === 'all' ? null : filter, undefined, { signal }),
      [filter],
    ),
    (data) => data.markets.length,
    'The market list could not be loaded.',
  )

  return (
    <>
      <div className="wt-page__head">
        <h1 className="wt-page__title">Markets</h1>
        <p className="wt-page__meta">
          A market closes by itself when its close time passes — the contract stops taking stakes
          and a job writes the registry to match. There is no close button, and there should not
          be one.
        </p>
      </div>

      <div className="aw-filters" role="group" aria-label="Lifecycle state">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`aw-filter${filter === option.value ? ' is-active' : ''}`}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {markets.state === 'loading' && <Loading label="Loading markets" />}
      {markets.state === 'forbidden' && <Forbidden notice={markets.error ?? undefined} />}
      {markets.state === 'failed' && markets.error && (
        <Failed notice={markets.error} onRetry={markets.reload} title="The list did not load" />
      )}
      {markets.state === 'empty' && (
        <Empty
          title={
            filter === 'all'
              ? 'There are no markets yet'
              : `No market is ${filter === 'closed' ? 'closed and waiting for an outcome' : filter}`
          }
          hint={
            filter === 'closed'
              ? 'Nothing is waiting on you. A market appears here when its close time passes.'
              : undefined
          }
        />
      )}
      {markets.state === 'ok' && (
        <div className="wt-panel">
          <div className="wt-tablewrap">
            <table className="wt-table">
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">Question</th>
                  <th scope="col">Category</th>
                  <th scope="col">Closes</th>
                  <th scope="col">Contract</th>
                </tr>
              </thead>
              <tbody>
                {markets.data?.markets.map((market) => (
                  <tr key={market.id}>
                    <td>
                      <StatusPill status={market.status} />
                      <span className="aw-sr-only"> — {statusMeaning(market.status)}</span>
                    </td>
                    <th scope="row" className="aw-cell--question">
                      <Link className="wt-link" to={foresightPath.market(market.id)}>
                        {market.question}
                      </Link>
                      <span className="aw-mono aw-cell__id">{shortId(market.id)}</span>
                    </th>
                    <td>{market.category}</td>
                    <td className="cf-num">{utcStamp(market.closeTime) ?? 'not recorded'}</td>
                    <td>
                      {market.contractAddress ? (
                        <span className="aw-mono">{market.contractAddress}</span>
                      ) : (
                        // Not "—": a market with no contract is a market on which nobody can have
                        // staked, and that is a fact worth reading rather than a blank cell.
                        <span className="aw-missing">not deployed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="aw-note">
            <span className="aw-note__icon" aria-hidden="true">
              ◇
            </span>
            The 50 most recent, newest first. The service pages at 50 by default and caps at 200.
          </p>
        </div>
      )}
    </>
  )
}

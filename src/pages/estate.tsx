/**
 * The estate view: six tiles, one call, and never a blank page.
 *
 * `GET /v1/estate` — **admin-api/src/server.ts:879**. It answers 200 with a dead upstream
 * (server.ts:895-897), so this screen has no failure mode in which an incident hides the console
 * that exists to be read during one. A tile that could not be composed says which upstream and
 * why, in the service's own words; every other tile still says what it knows.
 *
 * The only way this page shows a failure state is when the CALL ITSELF failed — the network, the
 * gateway, or an unauthenticated session. Those are different from a degraded tile and are
 * rendered differently.
 *
 * ── The figures, and the ones that are absent ─────────────────────────────────────────────────
 *
 * Two of the six carry a number that can be null: the trial balance when the ledger did not
 * answer, and the open moderation count when market did not. Neither renders as zero. See the
 * header of lib/estate.ts.
 */
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadEstate, type EstateView } from '../lib/admin.ts'
import { summarise, tileViews, trialBalanceIsP0, unreadyServices } from '../lib/estate.ts'
import { asOfLabel, tileTone } from '../lib/format.ts'
import { useResource } from '../lib/resource.ts'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { AsOf, Figure, StatusWord } from '../components/tone.tsx'

export function EstatePage() {
  // Stamped when the answer ARRIVES, not when the request left: the figure's observation time is
  // the moment this browser learned it. `admin-api` stamps nothing, deliberately — it composes
  // every tile live with no cache, because a stale "ledger: ok" during an incident is worse than
  // a slow one.
  const [readAt, setReadAt] = useState<Date | null>(null)
  const load = useCallback(async (signal: AbortSignal) => {
    const view = await loadEstate({ signal })
    setReadAt(new Date())
    return view
  }, [])

  // `count` is 1 for any answer at all: the estate view is never empty — six tiles always come
  // back — so an "empty" state here would be unreachable and is not offered.
  const estate = useResource<EstateView>(load, () => 1, 'The estate view could not be loaded.')

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Estate</h1>
        <p className="aw-page-lede">
          Six things an operator checks first, composed live in one call. A dead upstream marks one
          tile; it never blanks this page.
        </p>
      </header>

      {estate.state === 'loading' && <Loading label="Composing the estate view" />}
      {estate.state === 'forbidden' && (
        <Forbidden
          notice={estate.error ?? undefined}
          title="This console needs the operator role"
        />
      )}
      {estate.state === 'failed' && estate.error !== null && (
        <Failed
          notice={estate.error}
          onRetry={estate.reload}
          title="admin-api did not answer"
        />
      )}

      {estate.data !== null && <EstateTiles view={estate.data} readAt={readAt} onReload={estate.reload} />}
    </>
  )
}

function EstateTiles({
  view,
  readAt,
  onReload,
}: {
  view: EstateView
  readAt: Date | null
  onReload: () => void
}) {
  const summary = summarise(view)
  const tiles = tileViews(view)
  const now = new Date()
  const unready = unreadyServices(view)

  return (
    <>
      <div className="aw-toolbar">
        {/* Every figure on this page carries this one stamp, because they all came from one call
            at one instant. Six separate stamps would imply six separate observations. */}
        {readAt !== null && <AsOf label={asOfLabel(readAt, now)} />}
        <button type="button" className="cf-btn cf-btn--quiet" onClick={onReload}>
          Read again
        </button>
      </div>

      {/*
        17 §8: a trial balance that is not zero is a P0, and everything downstream of the ledger is
        untrustworthy until it is. It gets its own banner rather than a tile the reader has to
        find, because it is the one fact on this page that invalidates the others.
      */}
      {trialBalanceIsP0(view) && (
        <p className="aw-note aw-note--crit" role="alert">
          <span className="aw-note__icon" aria-hidden="true">
            ■
          </span>
          The trial balance is not zero. Everything downstream of the ledger is untrustworthy until
          it is — treat balances, payouts and reconciliations on every other surface as unproven
          while this stands.
        </p>
      )}

      {summary.headline !== null && (
        <p className="aw-note aw-note--warn" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          {summary.headline}
        </p>
      )}

      <ul className="aw-tiles">
        {tiles.map((tile) => {
          const tone = tileTone(tile.status)
          return (
            <li className={`aw-tile aw-tile--${tone.tone}`} key={tile.key}>
              <div className="aw-tile__head">
                <h2 className="aw-tile__title">{tile.title}</h2>
                <StatusWord tone={tone} />
              </div>
              <p className="aw-tile__value">
                <Figure value={tile.value} because={tile.reason} />
              </p>
              {tile.detail !== null && <p className="aw-tile__detail">{tile.detail}</p>}
              {tile.reason !== null && (
                <p className="aw-tile__reason">
                  <span className="aw-tile__upstream cf-num">{tile.upstream}</span> {tile.reason}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {/*
        The services tile carries a LIST, and a count of down services is not a substitute for
        their names during an incident. It is rendered underneath rather than inside the tile
        because it is the only tile whose data does not fit on a card.
      */}
      {unready.length > 0 && (
        <section className="aw-panel" aria-label="Services that are not ready">
          <h2 className="aw-panel__title">Not ready</h2>
          <table className="aw-table">
            <caption className="aw-table__caption">
              Every service `admin-api` is configured to probe, that answered anything other than
              ready.
            </caption>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">State</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {unready.map((service) => (
                <tr key={service.name}>
                  <th scope="row" className="cf-num">
                    {service.name}
                  </th>
                  <td className="cf-num">{service.state}</td>
                  <td>{service.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <nav className="aw-next" aria-label="Where to go next">
        <Link className="cf-btn cf-btn--quiet" to="/approvals">
          {view.approvals.data.pending > 0
            ? `${view.approvals.data.pending} waiting for a second operator`
            : 'Approval queue'}
        </Link>
        <Link className="cf-btn cf-btn--quiet" to="/audit">
          Audit and chain verification
        </Link>
      </nav>
    </>
  )
}

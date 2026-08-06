/**
 * The pool: what is staked on each side, and — always — when that was last true.
 *
 * ── The chart is drawn from basis points, never from a ratio computed here ────────────────────
 *
 * `yesBps` and `noBps` are exact integers the service derived in bigint before narrowing
 * (foresight/src/mirror.ts: "the division happens before the conversion and the result is
 * under 10,000"). Dividing `yes` by `total` in this bundle would put an 18-decimal number through
 * a double to draw a bar, and would then disagree with the figure printed beside it.
 *
 * ── An unsynced mirror is not an empty pool ──────────────────────────────────────────────────
 *
 * `asOf: null` means the mirror has never run for this market. The numbers it produces are
 * identical to a market nobody has staked on, and the two mean opposite things to an operator
 * about to decide who gets paid. So a never-synced pool renders the chart's FAILED state with an
 * explicit sentence, not its empty state and certainly not a zero.
 *
 * ── Colour is not the channel ─────────────────────────────────────────────────────────────────
 *
 * The two sides are the estate's categorical slots 1 and 2 (ember and teal, adjacent-validated in
 * tokens.css) rather than anything derived from Foresight's accent — and each side is direct
 * labelled with the words YES and NO and its own figure, so the chart carries no information that
 * is only in the colour.
 */
import { Meter } from '@cloudsforge/ui/charts'
import type { Pool } from '../lib/foresight.ts'
import { mirrorAsOf, behindLabel, formatBps, formatWei } from '../lib/format.ts'

export function PoolPanel({ pool, title = 'The pool' }: { pool: Pool; title?: string }) {
  const neverSynced = pool.asOf === null
  const yes = formatWei(pool.yes)
  const no = formatWei(pool.no)
  const total = formatWei(pool.total)

  return (
    <section className="wt-panel" aria-label={title}>
      <div className="wt-panel__head">
        <h2 className="wt-panel__title">{title}</h2>
        <span className="aw-stamp cf-num">{mirrorAsOf(pool.asOf)}</span>
      </div>

      <Meter
        label="Staked by side"
        data={[
          { label: 'YES', value: pool.yesBps ?? 0 },
          { label: 'NO', value: pool.noBps ?? 0 },
        ]}
        formatValue={(bps) => formatBps(bps) ?? '—'}
        // A pool nobody has synced is not a pool of nothing. `error` is what renders the failed
        // state; passing `null` data would render "nothing staked", which would be a lie.
        error={neverSynced ? new Error('mirror has never synced this market') : null}
        emptyLabel="Nothing staked yet"
        errorLabel="This market has never been synced from the chain — this is not a zero pool"
      />

      {/* The exact figures, as the accessible and copyable form of the chart above. Wei is shown
          as well as EMBER because a settlement argument is settled in wei, not in four decimal
          places. */}
      <dl className="wt-facts wt-facts--mono aw-pool__facts">
        <dt>YES</dt>
        <dd>
          {yes === null ? <Missing /> : <>{yes} EMBER</>}{' '}
          <span className="aw-unit">{formatBps(pool.yesBps) ?? 'share unknown'}</span>
        </dd>
        <dt>NO</dt>
        <dd>
          {no === null ? <Missing /> : <>{no} EMBER</>}{' '}
          <span className="aw-unit">{formatBps(pool.noBps) ?? 'share unknown'}</span>
        </dd>
        <dt>Total</dt>
        <dd>{total === null ? <Missing /> : <>{total} EMBER</>}</dd>
        <dt>Stakers</dt>
        <dd>{pool.stakerCount}</dd>
      </dl>

      <PoolFreshness pool={pool} />
    </section>
  )
}

/**
 * What the operator needs to know about how much to trust the figures above.
 *
 * Three sentences, and which one appears is decided by the service's own `stale` flag rather than
 * by a threshold reinvented here — the service knows the chain's confirmation depth and this
 * bundle does not (mirror.ts).
 */
export function PoolFreshness({ pool }: { pool: Pool }) {
  const behind = behindLabel(pool.behindBlocks)

  if (pool.asOf === null) {
    return (
      <p className="aw-note aw-note--crit" role="status">
        <span className="aw-note__icon" aria-hidden="true">
          ■
        </span>
        The mirror has never synced this market. Every figure above is absent, not zero. Do not
        resolve from this screen until it has synced.
      </p>
    )
  }
  if (pool.stale) {
    return (
      <p className="aw-note aw-note--warn" role="status">
        <span className="aw-note__icon" aria-hidden="true">
          ▲
        </span>
        The mirror is behind the chain{behind === null ? '' : ` — ${behind}`}. The pool may have
        moved since {mirrorAsOf(pool.asOf)}. The contract is what pays; this is a copy of it.
      </p>
    )
  }
  return (
    <p className="aw-note" role="status">
      <span className="aw-note__icon" aria-hidden="true">
        ◇
      </span>
      Mirrored from the chain {mirrorAsOf(pool.asOf)}
      {behind === null ? '' : `, ${behind}`}. The contract is what pays; this is a copy of it.
    </p>
  )
}

/** Absent, said out loud. Never a dash that could be read as a zero. */
function Missing() {
  return <span className="aw-missing">not recorded</span>
}

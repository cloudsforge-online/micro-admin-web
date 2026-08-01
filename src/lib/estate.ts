/**
 * The estate view, read the way `admin-api` composes it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **A DEGRADED UPSTREAM MARKS ONE TILE. IT DOES NOT BLANK THE CONSOLE.**
 *
 * `GET /v1/estate` always answers 200, even with an upstream dead (admin-api/src/server.ts:895-897,
 * with the reasoning in the header of `estate.ts`): the operator console is read DURING an
 * incident, which is precisely when something is down, and a console that 500s when one service
 * is unwell is unavailable exactly when it exists to be used. `hub-api` proves the same rule with
 * seven degradation tests.
 *
 * The half of the rule that catches regressions is the other half: **every unaffected tile is
 * still OK**. A composition that degrades everything when anything fails has the same defect as
 * one that fails outright; it is just quieter about it. So this file never derives a page-level
 * verdict that can suppress a tile's own — `summarise()` reports what is wrong and what is still
 * answering, and both halves are asserted in `test/estate.test.ts`.
 *
 * **What is missing is NAMED.** `hub-api`'s degradation suite is the precedent: a hole is a hole
 * with a label on it. Each tile carries its own `upstream` and `reason` from the service, and
 * this console renders those verbatim rather than "unavailable" — "ledger could not be reached"
 * and "ledger answered 503" are different problems with different next moves, and `estate.ts`
 * distinguishes them (`reasonFor`, estate.ts:87-94).
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── Where a NUMBER is absent ─────────────────────────────────────────────────────────────────
 *
 * `trialBalance.data.balanced` and `openModerationCases.data.count` are `null` when their
 * upstream failed. There is no branch in this file that turns either into `0` or `true`. A
 * console that reported a balanced ledger during a ledger outage would be reporting the most
 * reassuring possible reading of the least reliable possible moment.
 */
import type { EstateView, ServiceHealth, TileStatus } from './admin.ts'

/** One tile, flattened into the six things a card renders. */
export interface TileView {
  /** The key in the response. Stable, and the metric label `admin-api` uses. */
  readonly key: keyof EstateView
  readonly title: string
  readonly status: TileStatus
  /** Which upstream feeds this tile, from the service. `self` means admin-api's own database. */
  readonly upstream: string
  /** The service's own words for what is wrong. Null when the tile is OK. */
  readonly reason: string | null
  /** The headline, or the honest absence of one. Never a zero standing in for a null. */
  readonly value: string | null
  /** A second line of detail, when there is one worth reading. */
  readonly detail: string | null
}

/**
 * The titles, in the order an operator reads them.
 *
 * Services first because a service being down explains most of what follows it; the trial balance
 * second because 17 §8 makes a non-zero one a P0 and "everything downstream of the ledger is
 * untrustworthy until it is zero"; the approval queue third because it is the only tile with work
 * waiting in it.
 */
export const TILE_ORDER: readonly (keyof EstateView)[] = [
  'services',
  'trialBalance',
  'approvals',
  'audit',
  'openModerationCases',
  'broadcasts',
]

const TITLES: Readonly<Record<keyof EstateView, string>> = {
  services: 'Services',
  trialBalance: 'Trial balance',
  approvals: 'Approval queue',
  audit: 'Audit chain',
  openModerationCases: 'Open moderation cases',
  broadcasts: 'Live broadcasts',
}

export function tileViews(view: EstateView): readonly TileView[] {
  return TILE_ORDER.map((key) => tileView(view, key))
}

function tileView(view: EstateView, key: keyof EstateView): TileView {
  const base = view[key]
  const common = {
    key,
    title: TITLES[key],
    status: base.status,
    upstream: base.upstream,
    reason: base.reason,
  }

  switch (key) {
    case 'services': {
      const health = view.services.data
      const down = health.filter((s) => !s.ready)
      return {
        ...common,
        // A count of what is ready out of what is configured. Both halves, because "5 ready" is
        // meaningless without the denominator and "2 down" is meaningless without it too.
        value: health.length === 0 ? null : `${health.length - down.length} of ${health.length} ready`,
        detail: down.length === 0 ? null : `not ready: ${down.map((s) => s.name).join(', ')}`,
      }
    }
    case 'trialBalance': {
      const data = view.trialBalance.data
      // `balanced === null` means the ledger did not answer. It is NOT `false` — "we do not know"
      // and "the books do not balance" would send an operator to two different places.
      if (data.balanced === null) {
        return { ...common, value: null, detail: 'the ledger did not answer, so the books are unknown' }
      }
      return {
        ...common,
        value: data.balanced ? 'balanced' : 'NOT ZERO',
        detail:
          data.totalAbsoluteDelta === null
            ? null
            : `total absolute delta ${data.totalAbsoluteDelta}`,
      }
    }
    case 'approvals': {
      const data = view.approvals.data
      return {
        ...common,
        value: `${data.pending} pending`,
        detail:
          data.expiringWithinHour === 0
            ? null
            : `${data.expiringWithinHour} expiring within the hour — an unanswered request is refused, not held`,
      }
    }
    case 'audit': {
      const data = view.audit.data
      return {
        ...common,
        value: `${data.headSeq} rows`,
        detail:
          data.lastVerifiedSeq === null
            ? 'never verified — SD-16 verifies continuity nightly, so this is a control that is not running'
            : `verified to seq ${data.lastVerifiedSeq}`,
      }
    }
    case 'openModerationCases': {
      const data = view.openModerationCases.data
      // Null, not zero. An empty moderation queue and an unreachable marketplace look identical
      // if this coalesces, and one of them is fine while the other is an outage.
      return {
        ...common,
        value: data.count === null ? null : `${data.count} open`,
        detail: data.count === null ? 'market did not answer, so the queue depth is unknown' : null,
      }
    }
    case 'broadcasts': {
      return { ...common, value: `${view.broadcasts.data.live} live`, detail: null }
    }
  }
}

/* ══════════════════════════════ the page-level reading ══════════════════════════════ */

export interface EstateSummary {
  /** Tiles that are not OK, in reading order. */
  readonly troubled: readonly TileView[]
  /** Tiles that ARE OK. Named, because "everything else is answering" is the other half. */
  readonly healthy: readonly TileView[]
  /** The worst status present. Never used to suppress a tile's own verdict. */
  readonly worst: TileStatus
  /** One sentence, for the banner. Null when everything is OK. */
  readonly headline: string | null
}

export function summarise(view: EstateView): EstateSummary {
  const tiles = tileViews(view)
  const troubled = tiles.filter((t) => t.status !== 'ok')
  const healthy = tiles.filter((t) => t.status === 'ok')
  const worst: TileStatus = troubled.some((t) => t.status === 'unavailable')
    ? 'unavailable'
    : troubled.length > 0
      ? 'degraded'
      : 'ok'

  return {
    troubled,
    healthy,
    worst,
    headline:
      troubled.length === 0
        ? null
        : `${troubled.length} of ${tiles.length} tiles are not OK: ${troubled.map((t) => t.title).join(', ')}. The rest are answering.`,
  }
}

/** Services that are not ready, worst-known-first. Rendered as a list, never as a count alone. */
export function unreadyServices(view: EstateView): readonly ServiceHealth[] {
  return view.services.data.filter((s) => !s.ready)
}

/**
 * Is the trial balance a P0?
 *
 * 17 §8: a non-zero trial balance is a P0 and everything downstream of the ledger is
 * untrustworthy until it is zero. `admin-api` marks the tile DEGRADED rather than `ok` for it,
 * because the ledger answered correctly and what it said is that something is wrong
 * (estate.ts:159-168). An unknown balance is not a P0 — it is an unknown, and this returns false
 * for it rather than raising an alarm the data does not support.
 */
export function trialBalanceIsP0(view: EstateView): boolean {
  return view.trialBalance.data.balanced === false
}

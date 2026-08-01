/**
 * Degradation, in both directions.
 *
 * `hub-api` proves this rule with seven tests and `admin-api` repeats it, and the half that
 * catches regressions is the SECOND half: a dead upstream marks one tile, AND every unaffected
 * tile is still OK. A composition that degrades everything when anything fails has the same
 * defect as one that fails outright; it is just quieter about it.
 *
 * So every test below that puts a tile into trouble also asserts that the others are untouched.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { EstateView, Tile } from '../src/lib/admin.ts'
import { TILE_ORDER, summarise, tileViews, trialBalanceIsP0, unreadyServices } from '../src/lib/estate.ts'

function ok<T>(upstream: string, data: T): Tile<T> {
  return { status: 'ok', upstream, reason: null, data }
}

/** A wholly healthy estate, matching what `composeEstate` returns when nothing is wrong. */
function healthy(): EstateView {
  return {
    services: ok('readiness', [
      { name: 'ledger', ready: true, state: 'ready', detail: null },
      { name: 'market', ready: true, state: 'ready', detail: null },
    ]),
    trialBalance: ok('ledger', { balanced: true, totalAbsoluteDelta: '0' }),
    openModerationCases: ok('market', { count: 4 }),
    approvals: ok('self', { pending: 2, expiringWithinHour: 1 }),
    audit: ok('self', { headSeq: '1200', headHash: 'abc', lastVerifiedSeq: '1100' }),
    broadcasts: ok('self', { live: 0 }),
  }
}

const byKey = (view: EstateView) => new Map(tileViews(view).map((t) => [t.key, t]))

/* ══════════════════════════════ the healthy baseline ══════════════════════════════ */

describe('a healthy estate', () => {
  it('produces six tiles', () => {
    assert.equal(tileViews(healthy()).length, 6)
  })

  it('produces one tile per key admin-api returns', () => {
    assert.deepEqual([...byKey(healthy()).keys()].sort(), [...TILE_ORDER].sort())
  })

  it('reads services first, because a service being down explains most of what follows', () => {
    assert.equal(TILE_ORDER[0], 'services')
  })

  it('reads the trial balance second: 17 §8 makes a non-zero one a P0', () => {
    assert.equal(TILE_ORDER[1], 'trialBalance')
  })

  it('reports every tile as ok', () => {
    for (const tile of tileViews(healthy())) assert.equal(tile.status, 'ok', tile.key)
  })

  it('has no headline, because there is nothing to say', () => {
    assert.equal(summarise(healthy()).headline, null)
  })

  it('reports the worst status as ok', () => {
    assert.equal(summarise(healthy()).worst, 'ok')
  })

  it('carries a value on every tile', () => {
    for (const tile of tileViews(healthy())) assert.notEqual(tile.value, null, tile.key)
  })

  it('carries no reason on any tile', () => {
    for (const tile of tileViews(healthy())) assert.equal(tile.reason, null, tile.key)
  })
})

/* ══════════════════════════════ one upstream down ══════════════════════════════ */

describe('the ledger is unreachable', () => {
  const view: EstateView = {
    ...healthy(),
    trialBalance: {
      status: 'unavailable',
      upstream: 'ledger',
      reason: 'ledger could not be reached',
      data: { balanced: null, totalAbsoluteDelta: null },
    },
  }

  it('marks the trial-balance tile unavailable', () => {
    assert.equal(byKey(view).get('trialBalance')?.status, 'unavailable')
  })

  it('reports the balance as ABSENT, never as balanced', () => {
    // The single most dangerous coalescing in this console: a null `balanced` rendered as `true`
    // would report healthy books during a ledger outage.
    assert.equal(byKey(view).get('trialBalance')?.value, null)
  })

  it('names what is missing, in the service’s own words', () => {
    assert.equal(byKey(view).get('trialBalance')?.reason, 'ledger could not be reached')
  })

  it('names the upstream, so the reason has an address', () => {
    assert.equal(byKey(view).get('trialBalance')?.upstream, 'ledger')
  })

  it('says the books are unknown rather than leaving a dash', () => {
    assert.match(byKey(view).get('trialBalance')?.detail ?? '', /unknown/)
  })

  it('does NOT report a P0: an unknown balance is not a broken one', () => {
    assert.equal(trialBalanceIsP0(view), false)
  })

  it('LEAVES EVERY OTHER TILE OK', () => {
    for (const tile of tileViews(view)) {
      if (tile.key === 'trialBalance') continue
      assert.equal(tile.status, 'ok', `${tile.key} was degraded by the ledger being down`)
    }
  })

  it('names the troubled tile in the headline and says the rest are answering', () => {
    const summary = summarise(view)
    assert.match(summary.headline ?? '', /Trial balance/)
    assert.match(summary.headline ?? '', /The rest are answering/)
  })

  it('lists the five healthy tiles as healthy', () => {
    assert.equal(summarise(view).healthy.length, 5)
  })
})

describe('market is unreachable', () => {
  const view: EstateView = {
    ...healthy(),
    openModerationCases: {
      status: 'unavailable',
      upstream: 'market',
      reason: 'market answered 503',
      data: { count: null },
    },
  }

  it('reports the case count as ABSENT, never as zero', () => {
    // An empty moderation queue and an unreachable marketplace look identical if this coalesces,
    // and one of them is fine while the other is an outage.
    assert.equal(byKey(view).get('openModerationCases')?.value, null)
  })

  it('says the queue depth is unknown', () => {
    assert.match(byKey(view).get('openModerationCases')?.detail ?? '', /unknown/)
  })

  it('distinguishes "answered 503" from "could not be reached"', () => {
    // estate.ts:87-94 makes them different strings on purpose: the operator's next move differs.
    assert.match(byKey(view).get('openModerationCases')?.reason ?? '', /answered 503/)
  })

  it('LEAVES EVERY OTHER TILE OK', () => {
    for (const tile of tileViews(view)) {
      if (tile.key === 'openModerationCases') continue
      assert.equal(tile.status, 'ok', tile.key)
    }
  })
})

describe('two upstreams down at once', () => {
  const view: EstateView = {
    ...healthy(),
    trialBalance: {
      status: 'unavailable',
      upstream: 'ledger',
      reason: 'ledger could not be reached',
      data: { balanced: null, totalAbsoluteDelta: null },
    },
    openModerationCases: {
      status: 'unavailable',
      upstream: 'market',
      reason: 'market could not be reached',
      data: { count: null },
    },
  }

  it('marks both, and only both', () => {
    assert.equal(summarise(view).troubled.length, 2)
  })

  it('leaves the four tiles admin-api serves from its own database ok', () => {
    for (const key of ['services', 'approvals', 'audit', 'broadcasts'] as const) {
      assert.equal(byKey(view).get(key)?.status, 'ok', key)
    }
  })

  it('reports the worst status as unavailable', () => {
    assert.equal(summarise(view).worst, 'unavailable')
  })
})

/* ══════════════════════════════ degraded, which is an ANSWER ══════════════════════════════ */

describe('services are down — the tile is DEGRADED, not unavailable', () => {
  const view: EstateView = {
    ...healthy(),
    services: {
      status: 'degraded',
      upstream: 'readiness',
      reason: 'not ready: market, notify',
      data: [
        { name: 'ledger', ready: true, state: 'ready', detail: null },
        { name: 'market', ready: false, state: 'unreachable', detail: 'connection refused' },
        { name: 'notify', ready: false, state: 'degraded', detail: 'queue backed up' },
      ],
    },
  }

  it('is degraded rather than unavailable: the tile HAS its data', () => {
    // Marking it unavailable would hide the outage behind the outage.
    assert.equal(byKey(view).get('services')?.status, 'degraded')
  })

  it('still reports a value — the number ready out of the number configured', () => {
    assert.equal(byKey(view).get('services')?.value, '1 of 3 ready')
  })

  it('names the services that are not ready, rather than counting them', () => {
    assert.match(byKey(view).get('services')?.detail ?? '', /market, notify/)
  })

  it('returns the unready services as rows, with their own detail', () => {
    const unready = unreadyServices(view)
    assert.deepEqual(unready.map((s) => s.name), ['market', 'notify'])
    assert.equal(unready[0]?.detail, 'connection refused')
  })

  it('returns nothing unready on a healthy estate', () => {
    assert.deepEqual(unreadyServices(healthy()), [])
  })

  it('LEAVES EVERY OTHER TILE OK', () => {
    for (const tile of tileViews(view)) {
      if (tile.key === 'services') continue
      assert.equal(tile.status, 'ok', tile.key)
    }
  })

  it('reports the worst status as degraded, not unavailable', () => {
    assert.equal(summarise(view).worst, 'degraded')
  })
})

describe('the trial balance is not zero — a P0', () => {
  const view: EstateView = {
    ...healthy(),
    trialBalance: {
      status: 'degraded',
      upstream: 'ledger',
      reason: 'TRIAL BALANCE IS NOT ZERO — delta 1200',
      data: { balanced: false, totalAbsoluteDelta: '1200' },
    },
  }

  it('is degraded rather than ok: the ledger answered, and what it said is that something is wrong', () => {
    assert.equal(byKey(view).get('trialBalance')?.status, 'degraded')
  })

  it('renders the value as NOT ZERO, in words', () => {
    assert.equal(byKey(view).get('trialBalance')?.value, 'NOT ZERO')
  })

  it('renders the delta, which is the number an operator acts on', () => {
    assert.match(byKey(view).get('trialBalance')?.detail ?? '', /1200/)
  })

  it('IS a P0', () => {
    assert.equal(trialBalanceIsP0(view), true)
  })

  it('is not a P0 when the books balance', () => {
    assert.equal(trialBalanceIsP0(healthy()), false)
  })

  it('LEAVES EVERY OTHER TILE OK', () => {
    for (const tile of tileViews(view)) {
      if (tile.key === 'trialBalance') continue
      assert.equal(tile.status, 'ok', tile.key)
    }
  })
})

describe('the audit chain has never been verified', () => {
  const view: EstateView = {
    ...healthy(),
    audit: {
      status: 'degraded',
      upstream: 'self',
      reason: 'the audit chain has never been verified',
      data: { headSeq: '1200', headHash: 'abc', lastVerifiedSeq: null },
    },
  }

  it('is degraded: a control that is not running is not a green tile', () => {
    assert.equal(byKey(view).get('audit')?.status, 'degraded')
  })

  it('still reports the chain length', () => {
    assert.equal(byKey(view).get('audit')?.value, '1200 rows')
  })

  it('says the verification has never run, and why that matters', () => {
    assert.match(byKey(view).get('audit')?.detail ?? '', /never verified/)
    assert.match(byKey(view).get('audit')?.detail ?? '', /SD-16/)
  })

  it('reports the verified sequence when there is one', () => {
    assert.match(byKey(healthy()).get('audit')?.detail ?? '', /verified to seq 1100/)
  })

  it('LEAVES EVERY OTHER TILE OK', () => {
    for (const tile of tileViews(view)) {
      if (tile.key === 'audit') continue
      assert.equal(tile.status, 'ok', tile.key)
    }
  })
})

/* ══════════════════════════════ counts that are genuinely zero ══════════════════════════════ */

describe('a real zero is rendered as a zero', () => {
  it('an empty approval queue reads 0 pending', () => {
    const view = { ...healthy(), approvals: ok('self', { pending: 0, expiringWithinHour: 0 }) }
    assert.equal(byKey(view).get('approvals')?.value, '0 pending')
  })

  it('an empty moderation queue that market ANSWERED reads 0 open', () => {
    const view = { ...healthy(), openModerationCases: ok('market', { count: 0 }) }
    assert.equal(byKey(view).get('openModerationCases')?.value, '0 open')
  })

  it('no live broadcasts reads 0 live', () => {
    assert.equal(byKey(healthy()).get('broadcasts')?.value, '0 live')
  })

  it('says nothing extra about expiry when nothing is expiring', () => {
    const view = { ...healthy(), approvals: ok('self', { pending: 3, expiringWithinHour: 0 }) }
    assert.equal(byKey(view).get('approvals')?.detail, null)
  })

  it('warns when requests are expiring within the hour', () => {
    assert.match(byKey(healthy()).get('approvals')?.detail ?? '', /expiring within the hour/)
  })

  it('says an unanswered request is refused rather than held', () => {
    assert.match(byKey(healthy()).get('approvals')?.detail ?? '', /refused, not held/)
  })
})

describe('the services tile with no probes configured', () => {
  const view = { ...healthy(), services: ok('readiness', []) }

  it('reports absent rather than "0 of 0 ready", which would read as healthy', () => {
    assert.equal(byKey(view).get('services')?.value, null)
  })
})

/**
 * The state machine, and the gate in front of the two actions that cannot be undone.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR.
 *
 *   1. **The mirrored table is really foresight's table.** `src/lib/lifecycle.ts` restates
 *      `foresight/src/markets.ts`. A mirror that drifts is worse than no mirror: it
 *      produces a console offering a button the service will refuse, which teaches the operator
 *      that the console lies. Every row is pinned below.
 *   2. **An unapproved proposal can never reach `open`, and resolve is impossible before close.**
 *      Both are asserted through `actionsFor`, which is what the page actually reads.
 *   3. **The confirmation gate refuses in every direction.** A gate is only worth having if it
 *      has been proven to say no — and to say no for the RIGHT reason, since the reason is what
 *      is rendered beside the disabled button.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Market, MarketStatus } from '../src/lib/foresight.ts'
import {
  ACTION_RESOLVE_NO,
  ACTION_RESOLVE_YES,
  ACTION_VOID,
  LIFECYCLE_ORDER,
  OUTCOME_NO,
  OUTCOME_YES,
  TRANSITIONS,
  actionById,
  actionLabel,
  actionsFor,
  canTransition,
  disputeWindow,
  marketConfirmationPhrase,
  outcomeLabel,
  planWasOverruled,
} from '../src/lib/lifecycle.ts'
// The gate is this console's ONE confirmation gate, not a second copy. `micro-foresight-admin-web`
// carried its own `confirmationGate` with a byte-identical algorithm; the fold kept lib/gate.ts's
// and deleted the duplicate, so this suite now proves the gate the market screens actually call.
import { confirmationGate } from '../src/lib/gate.ts'

const MARKET_ID = '3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'

function market(over: Partial<Market> = {}): Market {
  return {
    id: MARKET_ID,
    status: 'draft',
    question: 'Will block 9,000,000 be mined by 2027-01-01?',
    resolutionCriteria: 'YES if the explorer shows height >= 9000000 at the close time.',
    category: 'protocol_network',
    categoryVersion: 1,
    resolutionSourceKind: 'block_explorer',
    resolutionSourceRef: 'https://explorer.example/height',
    questionHash: '0x' + 'ab'.repeat(32),
    closeTime: '2027-01-01T00:00:00.000Z',
    disputeWindowSeconds: 172_800,
    feeBps: 250,
    chain: 'ember',
    network: 'hearth-testnet',
    contractAddress: null,
    outcome: null,
    voidReason: null,
    openedAt: null,
    closedAt: null,
    resolvedAt: null,
    settledAt: null,
    voidedAt: null,
    ...over,
  }
}

/* ══════════════════════════════ the mirrored table ══════════════════════════════ */

describe('the transition table mirrors foresight', () => {
  it('is the table at foresight/src/markets.ts, row for row', () => {
    assert.deepEqual(TRANSITIONS, {
      draft: ['approved', 'void'],
      approved: ['open', 'void'],
      open: ['closed', 'void'],
      closed: ['resolved', 'void'],
      // Not an oddity: the dispute window doing its job. The outcome is posted, somebody shows it
      // is wrong, and the money has not moved yet (markets.ts).
      resolved: ['settled', 'void'],
      settled: [],
      void: [],
    })
  })

  it('makes settled and void terminal', () => {
    assert.deepEqual(TRANSITIONS.settled, [])
    assert.deepEqual(TRANSITIONS.void, [])
    for (const to of LIFECYCLE_ORDER) {
      assert.equal(canTransition('settled', to), false, `settled → ${to}`)
      assert.equal(canTransition('void', to), false, `void → ${to}`)
    }
  })

  it('lets every non-terminal state reach void, which is what makes void reachable at all', () => {
    for (const from of ['draft', 'approved', 'open', 'closed', 'resolved'] as MarketStatus[]) {
      assert.equal(canTransition(from, 'void'), true, from)
    }
  })

  it('keeps void OFF the lifecycle rail, because a market does not pass through it', () => {
    assert.equal(LIFECYCLE_ORDER.includes('void'), false)
    assert.deepEqual(LIFECYCLE_ORDER, ['draft', 'approved', 'open', 'closed', 'resolved', 'settled'])
  })

  it('refuses the transitions foresight refuses', () => {
    // The four that matter, each of which somebody would reach for.
    assert.equal(canTransition('draft', 'open'), false)
    assert.equal(canTransition('open', 'resolved'), false)
    assert.equal(canTransition('approved', 'closed'), false)
    assert.equal(canTransition('closed', 'settled'), false)
  })
})

/* ══════════════════════════════ what can be done, and when ══════════════════════════════ */

describe('an unapproved market can never be opened', () => {
  it('blocks open from draft even with a contract address', () => {
    // Belt and braces against the two ways this could be got wrong at once: the status check and
    // the contract check are separate, and only the pair is correct.
    const action = actionById(market({ status: 'draft', contractAddress: '0x' + '11'.repeat(20) }), 'open')
    assert.notEqual(action.blocked, null)
    assert.match(action.blocked ?? '', /opened from approved/)
  })

  it('blocks open from approved while there is no contract', () => {
    const action = actionById(market({ status: 'approved' }), 'open')
    assert.equal(action.blocked, 'the market contract is not deployed yet')
  })

  it('allows open only once approved AND deployed', () => {
    const action = actionById(
      market({ status: 'approved', contractAddress: '0x' + '11'.repeat(20) }),
      'open',
    )
    assert.equal(action.blocked, null)
  })
})

describe('resolve is impossible before close', () => {
  for (const status of ['draft', 'approved', 'open', 'resolved', 'settled', 'void'] as MarketStatus[]) {
    it(`is blocked while the market is ${status}`, () => {
      const action = actionById(market({ status }), 'resolve')
      assert.notEqual(action.blocked, null, `resolve was offered on a ${status} market`)
      assert.match(action.blocked ?? '', /resolved after it closes/)
    })
  }

  it('is available once the market is closed', () => {
    assert.equal(actionById(market({ status: 'closed' }), 'resolve').blocked, null)
  })
})

describe('void is reachable, and distinct from resolve', () => {
  it('is offered on a market with no contract', () => {
    assert.equal(actionById(market({ status: 'draft' }), 'void').blocked, null)
    assert.equal(actionById(market({ status: 'closed' }), 'void').blocked, null)
  })

  it('is refused on a DEPLOYED market, and says the oracle is the way', () => {
    // `POST /markets/:id/void` answers 409 `on_chain` for a market with a contract
    // (server.ts). A console that offered the button anyway would produce a 409 the
    // operator has to interpret; this says the actual answer instead.
    const action = actionById(
      market({ status: 'closed', contractAddress: '0x' + '11'.repeat(20) }),
      'void',
    )
    assert.notEqual(action.blocked, null)
    assert.match(action.blocked ?? '', /through the oracle/)
  })

  it('says "refund" and "no fee", because that is what makes it different from resolving', () => {
    const action = actionById(market({ status: 'closed' }), 'void')
    const text = action.consequences.join(' ')
    assert.match(text, /refunded in full/)
    assert.match(text, /No settlement fee/)
  })

  it('is marked irreversible, along with resolve, and nothing else is', () => {
    const irreversible = actionsFor(market({ status: 'closed' }))
      .filter((a) => a.irreversible)
      .map((a) => a.id)
    assert.deepEqual(irreversible.sort(), ['resolve', 'void'])
  })

  it('every action states what it will do BEFORE it is run', () => {
    // The rule from the brief, checked as a property rather than trusted per action: an empty
    // consequence list would render a control with nothing above it.
    for (const action of actionsFor(market({ status: 'closed' }))) {
      assert.ok(action.consequences.length >= 2, `${action.id} explains too little`)
      assert.ok(action.summary.length > 0, `${action.id} has no summary`)
    }
  })

  it('offers no close action, because foresight serves no close route', () => {
    const ids = actionsFor(market({ status: 'open' })).map((a) => a.id)
    assert.equal(ids.includes('close' as never), false)
    assert.deepEqual(ids, ['approve', 'deploy', 'open', 'resolve', 'void'])
  })
})

/* ══════════════════════════════ outcomes ══════════════════════════════ */

describe('outcome encoding', () => {
  it('0 is YES and 1 is NO — the one thing that pays the wrong half if it is inverted', () => {
    // resolve.ts maps outcome 0 to ACTION_RESOLVE_YES; mirror.ts sums `outcome = 0`
    // into the `yes` pool. It reads backwards to anybody expecting 0 to be false.
    assert.equal(OUTCOME_YES, 0)
    assert.equal(OUTCOME_NO, 1)
    assert.equal(outcomeLabel(0), 'YES')
    assert.equal(outcomeLabel(1), 'NO')
  })

  it('has no label for an outcome nobody posted', () => {
    // Null, never "NO". An unresolved market showing "NO" would be a claim about a decision that
    // has not been taken.
    assert.equal(outcomeLabel(null), null)
    assert.equal(outcomeLabel(7), null)
  })

  it('names the three resolution actions as resolve.ts numbers them', () => {
    assert.equal(ACTION_RESOLVE_YES, 0)
    assert.equal(ACTION_RESOLVE_NO, 1)
    assert.equal(ACTION_VOID, 2)
    assert.match(actionLabel(ACTION_RESOLVE_YES), /YES/)
    assert.match(actionLabel(ACTION_RESOLVE_NO), /NO/)
    assert.match(actionLabel(ACTION_VOID), /VOID/)
    assert.match(actionLabel(ACTION_VOID), /refund/)
  })

  it('detects the overrule: a requested outcome that came back as a void', () => {
    // `planResolution` turns a resolve into a void when the named source is unreachable
    // (resolve.ts). The operator must be told, not left assuming their choice stood.
    assert.equal(planWasOverruled(0, ACTION_VOID), true)
    assert.equal(planWasOverruled(1, ACTION_VOID), true)
    assert.equal(planWasOverruled(0, ACTION_RESOLVE_YES), false)
    assert.equal(planWasOverruled(1, ACTION_RESOLVE_NO), false)
  })
})

/* ══════════════════════════════ the confirmation gate ══════════════════════════════ */

describe('the phrase names the market and the outcome', () => {
  it('spells out resolve with the side being paid', () => {
    assert.equal(marketConfirmationPhrase('resolve', MARKET_ID, OUTCOME_YES), 'resolve 3f2a1b9c YES')
    assert.equal(marketConfirmationPhrase('resolve', MARKET_ID, OUTCOME_NO), 'resolve 3f2a1b9c NO')
  })

  it('spells out void without an outcome, because a void has none', () => {
    assert.equal(marketConfirmationPhrase('void', MARKET_ID), 'void 3f2a1b9c')
  })

  it('gives two different markets two different phrases', () => {
    // The entire mechanism. If the phrase did not carry the market, typing it would confirm only
    // that a hand moved — which is what a checkbox already does.
    assert.notEqual(
      marketConfirmationPhrase('resolve', MARKET_ID, OUTCOME_YES),
      marketConfirmationPhrase('resolve', '99999999-4d5e-4f60-8a1b-2c3d4e5f6071', OUTCOME_YES),
    )
  })
})

describe('confirmationGate', () => {
  const required = marketConfirmationPhrase('resolve', MARKET_ID, OUTCOME_YES)
  const rationale = 'the explorer showed height 9,000,013 at the close time'

  it('lets the action run when the phrase and the rationale are both right', () => {
    const gate = confirmationGate({ typed: required, required, rationale })
    assert.equal(gate.ready, true)
    assert.equal(gate.reason, null)
  })

  it('refuses an empty rationale, and says why', () => {
    const gate = confirmationGate({ typed: required, required, rationale: '   ' })
    assert.equal(gate.ready, false)
    assert.match(gate.reason ?? '', /what this decision is based on/)
  })

  it('refuses nothing typed at all', () => {
    const gate = confirmationGate({ typed: '', required, rationale })
    assert.equal(gate.ready, false)
    assert.match(gate.reason ?? '', /to confirm/)
  })

  it('refuses the WRONG OUTCOME in an otherwise perfect phrase', () => {
    // The specific misclick this exists to catch. Everything matches except the word that decides
    // who is paid.
    const gate = confirmationGate({ typed: 'resolve 3f2a1b9c NO', required, rationale })
    assert.equal(gate.ready, false)
  })

  it('refuses the WRONG MARKET in an otherwise perfect phrase', () => {
    const gate = confirmationGate({ typed: 'resolve 99999999 YES', required, rationale })
    assert.equal(gate.ready, false)
  })

  it('refuses a phrase that merely CONTAINS the right one', () => {
    // A substring match would let "do not resolve 3f2a1b9c YES" through, which is the opposite of
    // what the operator wrote.
    const gate = confirmationGate({ typed: `do not ${required}`, required, rationale })
    assert.equal(gate.ready, false)
  })

  it('accepts a different case and extra whitespace, because a caps-lock key proves nothing', () => {
    // The guard is that the operator wrote the right market and the right side. Failing on case
    // teaches people to copy and paste the phrase, which defeats the whole mechanism.
    assert.equal(
      confirmationGate({ typed: '  RESOLVE   3F2A1B9C   yes ', required, rationale }).ready,
      true,
    )
  })

  it('refuses while a request for the same action is already in flight', () => {
    const gate = confirmationGate({ typed: required, required, rationale, busy: true })
    assert.equal(gate.ready, false)
    // lib/gate.ts's wording, not the deleted copy's "already running". Asserted against the
    // implementation this console actually uses rather than the one these tests arrived with.
    assert.match(gate.reason ?? '', /already being sent/)
  })

  it('reports the busy reason ahead of the phrase reason', () => {
    // Order matters for what is rendered: "already running" is actionable and "type the phrase"
    // is confusing when the phrase is already correct.
    const gate = confirmationGate({ typed: '', required, rationale, busy: true })
    assert.match(gate.reason ?? '', /already being sent/)
  })
})

/* ══════════════════════════════ the dispute window ══════════════════════════════ */

describe('the dispute window', () => {
  const resolvedAt = '2026-08-01T12:00:00.000Z'

  it('computes claimableFrom as resolvedAt + disputeWindowSeconds', () => {
    // The contract's own `claimableFrom`, recomputed from the two fields foresight sends rather
    // than read from a field that is not on the wire.
    const w = disputeWindow(
      market({ status: 'resolved', resolvedAt, disputeWindowSeconds: 172_800 }),
      new Date('2026-08-01T13:00:00.000Z'),
    )
    assert.equal(w.claimableFrom, '2026-08-03T12:00:00.000Z')
    assert.equal(w.open, true)
  })

  it('is closed once the window has elapsed', () => {
    const w = disputeWindow(
      market({ status: 'resolved', resolvedAt, disputeWindowSeconds: 3600 }),
      new Date('2026-08-01T14:00:00.000Z'),
    )
    assert.equal(w.open, false)
  })

  it('has no clock at all before the outcome is posted', () => {
    // Null rather than "now" or zero: an unposted outcome has no window, and rendering one would
    // be a claim about when strangers may claim their money.
    const w = disputeWindow(market({ status: 'closed' }), new Date())
    assert.equal(w.resolvedAt, null)
    assert.equal(w.claimableFrom, null)
    assert.equal(w.open, false)
  })

  it('is not open on a settled or voided market, whatever the arithmetic says', () => {
    for (const status of ['settled', 'void'] as MarketStatus[]) {
      const w = disputeWindow(
        market({ status, resolvedAt, disputeWindowSeconds: 172_800 }),
        new Date('2026-08-01T13:00:00.000Z'),
      )
      assert.equal(w.open, false, status)
    }
  })

  it('survives an unparseable timestamp without inventing one', () => {
    const w = disputeWindow(market({ status: 'resolved', resolvedAt: 'not a date' }), new Date())
    assert.equal(w.claimableFrom, null)
    assert.equal(w.open, false)
  })
})

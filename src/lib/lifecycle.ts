/**
 * The lifecycle, the actions it permits, and the gate in front of the two that cannot be undone.
 *
 * ── Why the state table is restated here ──────────────────────────────────────────────────────
 *
 * `foresight/src/markets.ts` is the authority and this is a MIRROR of it, character for
 * character, with the citation above each row. A mirror rather than an import because foresight
 * publishes no package, and a mirror rather than nothing because an operator console that offers
 * a button the service will refuse has told the operator something false about what is possible.
 * `test/lifecycle.test.ts` pins every row; if foresight's table changes, that test is what makes
 * this one change with it.
 *
 * ── Where a button does NOT exist ─────────────────────────────────────────────────────────────
 *
 * There is no close action, because there is no close route. A market closes when its close time
 * passes: the contract stops taking stakes on its own and the `market.close` leased job writes
 * the registry to match (`marketCloseHandler`, foresight/src/jobs.ts). Offering an
 * operator a "Close" button here would be inventing a route — the exact defect class this estate
 * has already paid for twice — and it would also be a lie about who closes a market.
 *
 * ── The two that move money ───────────────────────────────────────────────────────────────────
 *
 * `resolve` and `void` are the only actions in this file that reach the chain, and neither can be
 * taken back. Everything about how they are presented follows from that: the consequence is
 * spelled out in sentences before the control appears, the control is not a bare button, and the
 * operator has to write the market and the outcome out for themselves.
 */
import type { Market, MarketStatus } from './foresight.ts'

/* ══════════════════════════════ the state table ══════════════════════════════ */

/**
 * The permitted transitions. Mirrors `TRANSITIONS`, foresight/src/markets.ts.
 *
 * `resolved → void` is not an oddity: it is the dispute window doing its job. The outcome is
 * posted, somebody shows it is wrong, and the money has not moved yet (markets.ts).
 */
export const TRANSITIONS: Readonly<Record<MarketStatus, readonly MarketStatus[]>> = Object.freeze({
  draft: Object.freeze<MarketStatus[]>(['approved', 'void']),
  // `open` needs a DEPLOYED contract as well as an approval — `markets_open_has_contract`.
  approved: Object.freeze<MarketStatus[]>(['open', 'void']),
  open: Object.freeze<MarketStatus[]>(['closed', 'void']),
  closed: Object.freeze<MarketStatus[]>(['resolved', 'void']),
  resolved: Object.freeze<MarketStatus[]>(['settled', 'void']),
  // Terminal. The fee has been paid and winners are claiming; there is nothing left to change.
  settled: Object.freeze<MarketStatus[]>([]),
  void: Object.freeze<MarketStatus[]>([]),
})

export function canTransition(from: MarketStatus, to: MarketStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

/** The lifecycle in reading order, for the progress rail. `void` is off this line on purpose. */
export const LIFECYCLE_ORDER: readonly MarketStatus[] = [
  'draft',
  'approved',
  'open',
  'closed',
  'resolved',
  'settled',
]

/* ══════════════════════════════ outcomes ══════════════════════════════ */

/**
 * **0 is YES. 1 is NO.**
 *
 * `planResolution` maps outcome 0 to `ACTION_RESOLVE_YES` (foresight/src/resolve.ts, with the
 * constants at resolve.ts), and the mirror sums `outcome = 0` into the `yes` pool
 * (mirror.ts). It reads backwards to anyone who expects 0 to be false, which is exactly
 * why it is a named constant here and never a literal at a call site.
 */
export const OUTCOME_YES = 0
export const OUTCOME_NO = 1

export function outcomeLabel(outcome: number | null): string | null {
  if (outcome === OUTCOME_YES) return 'YES'
  if (outcome === OUTCOME_NO) return 'NO'
  return null
}

/** The resolution `action` the service planned. resolve.ts. */
export const ACTION_RESOLVE_YES = 0
export const ACTION_RESOLVE_NO = 1
export const ACTION_VOID = 2

/**
 * What the service actually decided to do, which may not be what was asked.
 *
 * `planResolution` turns a resolve into a void when the market's named source is unreachable
 * (resolve.ts). Reading this back from the response — rather than assuming the requested
 * outcome — is the whole reason the acceptance is rendered instead of dismissed.
 */
export function actionLabel(action: number): string {
  if (action === ACTION_RESOLVE_YES) return 'resolve YES'
  if (action === ACTION_RESOLVE_NO) return 'resolve NO'
  if (action === ACTION_VOID) return 'VOID — refund the pool whole'
  return `unknown action ${action}`
}

/** True when the plan is a void, whatever was requested. Drives the "you were overruled" notice. */
export function planWasOverruled(requested: 0 | 1, action: number): boolean {
  return action === ACTION_VOID && (requested === OUTCOME_YES || requested === OUTCOME_NO)
}

/* ══════════════════════════════ the actions ══════════════════════════════ */

export type ActionId = 'approve' | 'deploy' | 'open' | 'resolve' | 'void'

export interface LifecycleAction {
  readonly id: ActionId
  readonly label: string
  /** One line: what this is, before the consequences. */
  readonly summary: string
  /** What it will do, in sentences, shown BEFORE the control. Never "Are you sure?". */
  readonly consequences: readonly string[]
  /** Reaches the chain and cannot be undone by this panel. */
  readonly irreversible: boolean
  /** Set when the action is not available from this state: the reason, in the operator's words. */
  readonly blocked: string | null
  /**
   * What FORESIGHT records when this runs — not what `admin-api` records, because it records
   * nothing.
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * THE ONE THING THE FOLD MUST NOT BLUR.
   *
   * Every other write in this console goes through `admin-api` and appends a hash-chained
   * `audit_events` row in the same transaction as the change (SD-15), which is what
   * `AuditRecordPreview` shows above the confirmation control. **None of the five actions below
   * does that.** They go to `micro-foresight`, which keeps its own record and is not part of that
   * chain:
   *
   *   * `market_transitions` — one row per state change, with the from-status, the to-status, the
   *     `operator:<userId>` actor, a reason and the correlation id (`recordTransition`,
   *     foresight/src/markets.ts).
   *   * an outbox event — `foresight.market.opened` / `.closed` / `.resolved` / `.voided` /
   *     `.settled` (foresight/src/outbox.ts), emitted in the same transaction.
   *
   * Showing the admin audit block over these would tell an operator they were signing for a row in
   * a chain that will not contain it — and a console that is wrong about where the record lives is
   * worse than one that is silent about it, because the record is what a dispute is settled
   * against six months later. So these sentences take its place and name the real tables.
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly records: readonly string[]
}

/**
 * Every action this panel knows about, in the order a market moves through them, with the reason
 * each one is or is not available right now.
 *
 * Blocked actions are RETURNED rather than filtered out. An operator looking for "why can I not
 * resolve this" is better served by a disabled control that says "a market is resolved after it
 * closes; this one is open" than by an absence they have to interpret.
 */
export function actionsFor(market: Market): readonly LifecycleAction[] {
  return [
    {
      id: 'approve',
      label: 'Approve',
      summary: 'A person takes responsibility for these resolution criteria.',
      consequences: [
        'The market moves from draft to approved and records you as the approver.',
        'Nothing is deployed and no money moves.',
        'It is refused if the proposal this market was built from has not itself been approved.',
      ],
      irreversible: false,
      blocked: canTransition(market.status, 'approved')
        ? null
        : `a market is approved from draft; this one is ${market.status}`,
      records: [
        'A `market_transitions` row: draft → approved, with you as `operator:<your uuid>` (markets.ts).',
        '`approved_by` and `approved_at` on the market itself. The `operator:` prefix is checked here and again by `markets_unapproved_never_opens`, which is why an approval cannot be forged by a service token (markets.ts, and `approved_by` is written at markets.ts).',
        'No outbox event and no admin-api audit row. Approving is a decision, not yet a change anyone outside can see.',
      ],
    },
    {
      id: 'deploy',
      label: 'Deploy the contract',
      summary: 'Build and broadcast the market contract on to the chain.',
      consequences: [
        'A leased job signs with a custody-held key and broadcasts; the reply is an acceptance, not a confirmation.',
        'The idempotency key is what stops a retry producing a second pool for one question.',
        'No stake is possible until the market is opened afterwards.',
      ],
      irreversible: false,
      blocked:
        market.status !== 'approved'
          ? `a market is deployed once approved; this one is ${market.status}`
          : market.contractAddress
            ? 'this market already has a contract'
            : null,
      records: [
        'An idempotency row keyed on `POST /markets/:id/deploy` plus your key, so a retry with the same key replays the acceptance instead of building a second contract (`withIdempotency`, server.ts).',
        'A queued `market.deploy` job. The contract address, when it lands, is written by that job and not by this request.',
      ],
    },
    {
      id: 'open',
      label: 'Open for stakes',
      summary: 'Let the public stake on this market.',
      consequences: [
        'The market becomes visible as open and the contract begins accepting stakes.',
        'It is refused unless the contract is deployed — an open market with no contract address invites money to an address that does not exist.',
        'Stakes go wallet to contract. They never touch the service.',
      ],
      irreversible: false,
      blocked: !canTransition(market.status, 'open')
        ? `a market is opened from approved; this one is ${market.status}`
        : !market.contractAddress
          ? 'the market contract is not deployed yet'
          : null,
      records: [
        'A `market_transitions` row: approved → open, with you as the actor (markets.ts).',
        'A `foresight.market.opened` outbox event carrying the market’s public view, emitted in the same transaction as the status change (markets.ts, outbox.ts).',
      ],
    },
    {
      id: 'resolve',
      label: 'Resolve',
      summary: 'Post the outcome on chain. This decides who is paid.',
      consequences: [
        'The outcome is signed by the oracle key and broadcast. It cannot be taken back from this panel.',
        'After the dispute window the contract pays the winning side from the pool, pro rata, and takes the settlement fee.',
        'The service checks the source this market NAMED AT OPEN first. If that source is gone, this becomes a void — a whole refund — whatever outcome you chose.',
      ],
      irreversible: true,
      blocked: canTransition(market.status, 'resolved')
        ? null
        : `a market is resolved after it closes; this one is ${market.status}`,
      records: [
        'A `resolutions` row holding the action the service PLANNED — which is not always the one you asked for — its rationale and its state (resolve.ts).',
        'Later, when the chain accepts it: a `market_transitions` row closed → resolved carrying `outcome=<0|1>`, and a `foresight.market.resolved` event (markets.ts, outbox.ts).',
        'Your rationale is stored verbatim and is what anyone disputing this outcome will read.',
      ],
    },
    {
      id: 'void',
      label: 'Void',
      summary: 'Cancel the market and refund every stake whole.',
      consequences: [
        'Every stake is refunded in full. No settlement fee is taken on a void.',
        'The market is finished: void is terminal and nothing follows it.',
        'This route is only for a market with NO contract. A deployed market is voided through the oracle, on the resolve path, so that the chain and the registry cannot disagree.',
      ],
      irreversible: true,
      blocked: !canTransition(market.status, 'void')
        ? `nothing follows ${market.status}`
        : market.contractAddress
          ? 'this market has a contract — void it through the oracle on the resolve path, so the chain and the registry agree'
          : null,
      records: [
        'A `market_transitions` row: <current> → void, with you as the actor and the reason you write (markets.ts).',
        'A `foresight.market.voided` outbox event (markets.ts, outbox.ts).',
        'The reason is stored on the market and shown publicly. It is not an internal note.',
      ],
    },
  ]
}

export function actionById(market: Market, id: ActionId): LifecycleAction {
  const found = actionsFor(market).find((a) => a.id === id)
  // Unreachable: `actionsFor` returns all five, always. Thrown rather than defaulted because a
  // silent fallback here would render one action's consequences under another's name.
  if (!found) throw new Error(`no lifecycle action ${id}`)
  return found
}

/* ══════════════════════════════ the confirmation phrase ══════════════════════════════ */

/**
 * The phrase an operator must write out before an irreversible MARKET action will run.
 *
 * It names the MARKET and the OUTCOME, because those are the two facts a misclick gets wrong. A
 * checkbox or a second button confirms that a hand moved; writing "resolve 3f2a1b9c YES" confirms
 * that a person read which market and which side they are about to pay.
 *
 * The market is identified by the first eight characters of its uuid — long enough that two
 * markets in one queue will not collide, short enough to be typed without a mistake that reads as
 * a refusal to confirm.
 *
 * ── Named for its subject, because this console now has two of these ──────────────────────────
 *
 * `confirmationPhrase` in lib/gate.ts is the APPROVAL one — "approve 3f2a1b9c
 * ledger.entry.reverse". Both produce a phrase for `confirmationGate`, and before the fold each
 * lived alone in its own bundle under the same bare name. Merged into one bundle they would have
 * been two same-named exports with different signatures, which typechecks fine at every call site
 * that happens to import the right one and is a coin toss at the one that does not. The subject is
 * in the name for that reason.
 *
 * ── And the GATE is not duplicated at all ─────────────────────────────────────────────────────
 *
 * The version of this file inherited from `micro-foresight-admin-web` carried its own
 * `confirmationGate`, byte-for-byte the same algorithm as lib/gate.ts's: busy first, then a
 * non-empty rationale, then a trimmed / whitespace-collapsed / case-insensitive comparison. Two
 * copies of a security control is how the two drift, and the one that drifts is the one nobody is
 * reading. There is one, in lib/gate.ts, and this file exports only the phrase it is given.
 */
export function marketConfirmationPhrase(
  action: 'resolve' | 'void',
  marketId: string,
  outcome?: 0 | 1,
): string {
  const short = marketId.slice(0, 8)
  if (action === 'void') return `void ${short}`
  return `resolve ${short} ${outcome === OUTCOME_NO ? 'NO' : 'YES'}`
}

/* ══════════════════════════════ the dispute window ══════════════════════════════ */

export interface DisputeWindow {
  /** When the outcome was posted. Null until it is. */
  readonly resolvedAt: string | null
  /** When the contract will let winners claim: resolvedAt + disputeWindowSeconds. */
  readonly claimableFrom: string | null
  readonly seconds: number
  /** True while the window is still open at `now` — the period in which a void is still possible. */
  readonly open: boolean
}

/**
 * When the contested period ends.
 *
 * The contract computes `claimableFrom` as `resolvedAt + disputeWindowSeconds`
 * (`ForesightMarket.claimableFrom`, and `DisputeWindowOpen` is the error it reverts a `claim`
 * with). This recomputes it from the two fields foresight returns rather than reading a field
 * that does not exist on the wire.
 *
 * A market with no `resolvedAt` has no window yet, and that is reported as null rather than as
 * "now" or "0" — an unposted outcome has no clock.
 */
export function disputeWindow(market: Market, now: Date): DisputeWindow {
  const seconds = market.disputeWindowSeconds
  if (!market.resolvedAt) {
    return { resolvedAt: null, claimableFrom: null, seconds, open: false }
  }
  const resolvedAt = new Date(market.resolvedAt)
  if (Number.isNaN(resolvedAt.getTime())) {
    return { resolvedAt: market.resolvedAt, claimableFrom: null, seconds, open: false }
  }
  const claimable = new Date(resolvedAt.getTime() + seconds * 1000)
  return {
    resolvedAt: market.resolvedAt,
    claimableFrom: claimable.toISOString(),
    seconds,
    // `settled` and `void` are past the point where the window means anything.
    open: market.status === 'resolved' && claimable.getTime() > now.getTime(),
  }
}

/**
 * The support console's slice of `docs/ecosystem/22-browser-journeys.md`, as data.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE CATALOGUE IS DATA AND NOT JUST A LIST OF `it(...)` TITLES
 *
 * Doc 22 §3.2 makes the layer boundary mechanical rather than advisory: any scenario whose outcome
 * depends on a SERVER-SIDE rule must carry `ownedBy` — "a path, resolvable by grep, in the service
 * that enforces the rule". A meta-test reads these and fails the suite when one is missing.
 * Advice does not survive a deadline; a meta-test does.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS CATALOGUE IS SCOPED TO
 *
 * `admin-web` carries 23 `BJ-ADM` scenarios in doc 22 and had none implemented. This file does not
 * claim all 23: claiming an id is claiming it is covered, and a catalogue listing every id in the
 * group while testing two of them would be a coverage number that is a lie.
 *
 * The scope is **`src/pages/support.tsx`** — the screen doc 22 recorded as absent, and the reason
 * BJ-ADM-23 and BJ-XS-09 were ⛔. Doc 22 §8.4, verbatim:
 *
 *   "`admin-web` has eight routes: overview, approvals, actions, audit, engagement, flags,
 *    broadcasts. It has no withdrawals screen, no reconciliation screen, no …"
 *
 * and §8.4's list of what that blocks names "05 journey 16 (a support request about a balance) —
 * BJ-ADM-23, BJ-XS-09". There are nine routes now, and the ninth is this screen.
 *
 * `DOC22_UNCLAIMED` names the other 22 rows so the gap stays countable rather than disappearing.
 *
 * ── Locally-minted ids ────────────────────────────────────────────────────────────────────────
 *
 * The console's most important property has no doc 22 row, because doc 22 was written when the
 * screen did not exist: **it tells the truth about its own blindness.** Nothing in the estate
 * published `*.audit.recorded` when this screen was built, so an empty timeline meant "the mirror
 * is missing" far more often than "the user did nothing", and the screen says so on every result
 * including the empty one.
 *
 * Those scenarios carry the `BJ-SUP-` prefix rather than `BJ-ADM-` numbers, deliberately: doc 22
 * owns the `BJ-ADM` sequence and will extend it, and minting into somebody else's sequence is how
 * two scenarios end up sharing an id. `market-web/test/journeys.ts` sets the precedent for a
 * repo-scoped id with `BJ-MARKET-404`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Doc 22 §3.1. Nothing else is assertable from a browser. `absence` is deliberately not a kind. */
export type Asserts = 'presentation' | 'client-request' | 'navigation'

/** Doc 22 §4. T3 is not implemented here — it lives in `micro-beacon`. */
export type Tier = 'T1' | 'T2' | 'T3'

export interface Scenario {
  readonly id: string
  readonly what: string
  readonly asserts: Asserts
  readonly tier: Tier
  /** Release-gate (★ in doc 22). */
  readonly gate?: boolean
  /** `<repo>/src/<file>.ts` plus the string to grep for, in the service that enforces the rule. */
  readonly ownedBy?: { readonly path: string; readonly grep: string }
  /** Why this cannot be implemented here, when it cannot. Absent means it is implemented. */
  readonly blocked?: string
  /** Implemented, but not the whole of doc 22's row — and here is the half that is missing. */
  readonly caveat?: string
  /** The doc 22 §8 blocker this was recorded under, and what removed it. */
  readonly unblocks?: { readonly was: string; readonly by: string }
}

export const SCENARIOS: readonly Scenario[] = [
  /* ── 6.16 Group P — the operator console ──────────────────────────────────────────────────── */
  {
    id: 'BJ-ADM-23',
    what: '05 journey 16: a support agent starts from a user and gets the correlation ids their history hangs off',
    asserts: 'client-request',
    tier: 'T1',
    unblocks: {
      was: '§8.4 — "no support-lookup screen (§8.4)". admin-web had eight routes and none was this.',
      // The line was 89 and is 95: the P13 Foresight fold and the routes added after this citation
      // was written moved it down. Re-read from source rather than dropped — a citation that has
      // gone stale is still the only pointer anybody has, and deleting it costs more than fixing it.
      by: 'src/pages/support.tsx, routed at src/app.tsx:95.',
    },
    caveat:
      'Doc 22’s row ends "every read carries an audit record and a reason code". That is a property ' +
      'of admin-api, not of a browser: whether a read is itself audited is decided in ' +
      '`admin-api/src/server.ts` and a client-side test of it would pass against a service that ' +
      'had stopped writing the record — 14 §11 exactly. What is asserted here is the half doc 22 ' +
      'says no screen could do at all: turning a USER into the threads, which is the question that ' +
      'comes before the five 05:455-461 lists.',
  },
  {
    id: 'BJ-XS-09',
    what: 'one operator view (17 §7 claim 9): answer a balance question from admin-web alone',
    asserts: 'presentation',
    tier: 'T3',
    gate: true,
    blocked:
      'Claim 9’s evidence is an operator answering "where did this user’s money go" — and the ' +
      'answer requires rows from ledger, wallet and settlement, none of which reach this database. ' +
      '`admin-api`’s intake is built and properly guarded, but the topic it consumes, ' +
      '`*.audit.recorded` (`admin-api/src/server.ts:132`), has no producer anywhere in the estate; ' +
      '`admin-api/README.md:367-368` records the same finding as gap 2. So the cross-service ' +
      'journey cannot be run at any tier until a producer exists, and asserting it here would be ' +
      'this console certifying itself. BJ-SUP-01..04 assert the thing that IS in this repository’s ' +
      'gift: that the screen says so rather than looking complete.',
  },

  /* ── The console’s own properties, which doc 22 has no row for ────────────────────────────── */
  {
    id: 'BJ-SUP-01',
    what: 'the console asks BOTH questions — what the user did, and what was done to them — because there is no OR between the filters',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-SUP-02',
    what: 'an empty result is never an answer: the coverage panel renders on it and says the mirror is missing',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-SUP-03',
    what: 'the coverage caveat NARROWS the moment any service mirrors, because it is derived from the rows and not from a constant',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-SUP-04',
    what: 'the five questions of 05 journey 16 are on screen with the route each needs, and none is claimed as answered when it is not',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-SUP-05',
    what: 'a missing amount renders as an absence, never as a zero — because BigInt("") is 0n',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-SUP-06',
    what: 'the timeline is oldest-first and ordered by seq as a number, so seq 9 does not follow seq 10',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-SUP-07',
    what: 'a row arriving from both queries is reported once, as both, rather than counted twice',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-SUP-08',
    what: 'rows carrying no correlation id are counted rather than dropped, because a tidy list of threads would read as complete coverage',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-SUP-09',
    what: 'a truncated page says the timeline does not reach the beginning of the account',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-SUP-10',
    what: 'a malformed id is refused out loud, because a search box that goes quiet teaches the operator the user has no history',
    asserts: 'presentation',
    tier: 'T1',
    ownedBy: { path: 'admin-api/src/server.ts', grep: 'subjectId' },
  },
  {
    id: 'BJ-SUP-11',
    what: 'the address is the state: a lookup is shareable, and a second lookup never renders the first user’s history under the second user’s id',
    asserts: 'navigation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-SUP-12',
    what: 'nothing on this screen acts: no control changes anything, and J13’s remedy is absent rather than present and refusing',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
    // The absence is only meaningful because a rule makes the shortcut wrong, and the rule is
    // admin-api's: a decision by the operator who raised the request is refused, with its own
    // exception class so the route can answer 403 with a specific sentence. This screen not
    // offering the shortcut is a client-side courtesy; the refusal is what actually holds.
    ownedBy: { path: 'admin-api/src/approvals.ts', grep: 'The four-eyes refusal' },
  },
  {
    id: 'BJ-SUP-13',
    what: 'a forbidden lookup is its own screen, with no retry button, and is not rendered as an empty history',
    asserts: 'presentation',
    tier: 'T1',
    // NOT `admin-api/src/server.ts` for `admin:audit:read`, which was the first citation written
    // here and which the meta-test rejected on both counts: that scope does not exist — scopes.ts
    // records that `admin:audit:write` "IS GONE, AND ITS ABSENCE IS THE POINT" — and the one this
    // route actually demands is declared in scopes.ts rather than in server.ts.
    ownedBy: { path: 'admin-api/src/scopes.ts', grep: "READ_SCOPE = 'admin:read'" },
  },
  {
    id: 'BJ-SUP-14',
    what: 'a failed lookup is not an empty one: failure outranks emptiness, and the request id is offered',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-SUP-15',
    what: 'the user box declines a correlation id rather than guessing which column to search, because every uuid is also a valid correlation id',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-SUP-16',
    what: 'each thread links into the audit screen carrying its correlation id, so the two halves of the workflow join up',
    asserts: 'navigation',
    tier: 'T1',
  },
  {
    id: 'BJ-SUP-17',
    what: 'J13’s remedy — releasing a stuck withdrawal from this console — is deliberately not proxied',
    asserts: 'presentation',
    tier: 'T3',
    blocked:
      'Doc 22 §8.4 records that admin-web has no withdrawals screen, and that is still true; but ' +
      'the reason it is not proxied through THIS screen is stronger than a missing route. Every ' +
      'remedy 05’s operator journeys reach for is a two-operator action in this estate, and a ' +
      'support screen that grew a shortcut around the approval queue would be one admin doing what ' +
      'the journey requires two admins to do. The approval queue is where an operator acts. That ' +
      'the shortcut is ABSENT rather than present-and-refusing is asserted at T1 by BJ-SUP-12.',
  },
]

/**
 * The `BJ-ADM` ids doc 22 assigns to this surface that this catalogue does NOT claim.
 *
 * Every one is a real gap. They are listed rather than omitted for the reason doc 22 §8 gives
 * about its own blocked set: "a scenario that exists and cannot run is a gap somebody can close,
 * and an absent scenario is a gap nobody can see". None concerns `src/pages/support.tsx`, which is
 * this change's scope; all were coverable before it and are still uncovered.
 */
export const DOC22_UNCLAIMED: readonly string[] = [
  'BJ-ADM-01',
  'BJ-ADM-02',
  'BJ-ADM-03',
  'BJ-ADM-04',
  'BJ-ADM-05',
  'BJ-ADM-06',
  'BJ-ADM-07',
  'BJ-ADM-08',
  'BJ-ADM-09',
  'BJ-ADM-10',
  'BJ-ADM-11',
  'BJ-ADM-12',
  'BJ-ADM-13',
  'BJ-ADM-14',
  'BJ-ADM-15',
  'BJ-ADM-16',
  'BJ-ADM-17',
  'BJ-ADM-18',
  'BJ-ADM-19',
  'BJ-ADM-20',
  'BJ-ADM-21',
  'BJ-ADM-22',
  // §6.19 and §6.20 rows that name this repository but not this screen.
  'BJ-ADV-12-H1',
  'BJ-ADV-12-H2',
  'BJ-ADV-12-H3',
  'BJ-ADV-12-H4',
  'BJ-ADV-12-H5',
  'BJ-ADV-15-H1',
  'BJ-ADV-15-H2',
  'BJ-ADV-15-H4',
  'BJ-A11Y-05',
]

export const byId = (id: string): Scenario => {
  const found = SCENARIOS.find((s) => s.id === id)
  if (!found) throw new Error(`no scenario ${id} in test/journeys.ts`)
  return found
}

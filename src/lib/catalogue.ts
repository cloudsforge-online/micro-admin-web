/**
 * The action catalogue, and the difference between an action that CAN run and one that CANNOT.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **§3.3g: AN ACTION WITH NO EXECUTOR MUST NOT LOOK LIKE ONE THAT CAN BE EXECUTED.**
 *
 * `identity.role.grant` is a first-class entry in `admin-api`'s catalogue and has no executor,
 * because there is nothing to call: identity has no route that assigns `users.roles`. All 36 of
 * its route definitions were enumerated — `POST /auth/register` hard-codes `['player']`
 * (identity/src/users.ts) and `POST /organisations/:id/memberships` grants an
 * ORGANISATION role, which SD-03 is explicit is not a platform role. `admin-api` will not write
 * to identity's database to work around it: rule 1 is one database per service, and it is a CI
 * grep for any connection string that is not the service's own, so a version of `admin-api` that
 * did would fail its own build.
 *
 * So `POST /v1/approvals` with that action answers **501 `action_has_no_upstream`**
 * (admin-api/src/server.ts, mapped at server.ts), naming the route identity would
 * need. The reason a queue must refuse it rather than accept it is written at server.ts:
 * a queue that accepts work it cannot do lies to the operator waiting on it, and leaves a row at
 * `approved` for ever — which reads in the audit as two operators having authorised something
 * that never happened.
 *
 * **This console's job is to make that legible, not merely to obey it.** Three rules, each of
 * which is a test in `test/catalogue.test.ts`:
 *
 *   1. A blocked action is **listed**, never hidden. Hiding it would leave an operator hunting for
 *      a capability the estate has decided it does not have, and would erase the record of WHY.
 *   2. It carries **no control that would send the request** — not a disabled button, which reads
 *      as "not yet" and gets clicked at, but no button at all, with the reason in its place.
 *   3. The reason shown is **the service's own `blockedReason` string, verbatim**, plus the route
 *      that would unblock it. The same string the 501 carries, so the console and the service
 *      cannot drift into telling an operator two different stories.
 *
 * And the fourth, which is about the day it is fixed: when identity grows
 * `PUT /internal/users/:id/roles`, `admin-api` sets `route` to a citation and the action becomes
 * requestable HERE with no change to this file. The gate is the data, not a name in a list.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import type { ActionSpec } from './admin.ts'

/** How this console treats a catalogue entry. */
export type Availability = 'executable' | 'unavailable'

export interface CatalogueEntry {
  readonly spec: ActionSpec
  readonly availability: Availability
  /** Present exactly when `availability` is 'unavailable'. The service's own words. */
  readonly blockedReason: string | null
  /**
   * The upstream route this would call, cited by path and line — or, when blocked, absent.
   * `admin-api/src/routeidempotency.test.ts` asserts every executable action cites one.
   */
  readonly route: string | null
}

/**
 * Is this action executable?
 *
 * **`route === null` is the whole test**, and it is the same predicate the service uses
 * (`spec.route === null` at admin-api/src/server.ts, and `EXECUTABLE_ACTIONS` at
 * actions.ts). Not a name, not an allowlist in this repository: a second list would be a
 * copy of the catalogue, and the copy is the one that goes stale on the day the gap is closed.
 */
export function availabilityOf(spec: ActionSpec): Availability {
  return spec.route === null ? 'unavailable' : 'executable'
}

export function entryFor(spec: ActionSpec): CatalogueEntry {
  const availability = availabilityOf(spec)
  return {
    spec,
    availability,
    blockedReason:
      availability === 'unavailable'
        ? // The service always sets one — `routeidempotency.test.ts` requires it to be
          // longer than 80 characters, so whoever unblocks it has something to act on. The
          // fallback exists only so a null cannot render as the word "null" on an operator's
          // screen during an incident.
          (spec.blockedReason ?? 'this action has no upstream route, and admin-api recorded no reason')
        : null,
    route: spec.route,
  }
}

/** The catalogue, executable entries first, each side in the order the service listed them. */
export function readCatalogue(actions: readonly ActionSpec[]): readonly CatalogueEntry[] {
  const entries = actions.map(entryFor)
  return [
    ...entries.filter((e) => e.availability === 'executable'),
    ...entries.filter((e) => e.availability === 'unavailable'),
  ]
}

/** Only the actions an operator may raise a request for. */
export function executableActions(actions: readonly ActionSpec[]): readonly ActionSpec[] {
  return actions.filter((a) => availabilityOf(a) === 'executable')
}

/** Only the gap list. One entry long today; the console does not assume it stays that way. */
export function blockedActions(actions: readonly ActionSpec[]): readonly ActionSpec[] {
  return actions.filter((a) => availabilityOf(a) === 'unavailable')
}

/**
 * May this console send `POST /v1/approvals` for this action?
 *
 * A pure function rather than a check inside a click handler, so the refusal can be proven
 * without rendering anything — and so the request form and the submit button read the SAME
 * answer. A form that renders as available and a button that refuses is how a console comes to
 * disagree with itself.
 */
export function mayRequest(spec: ActionSpec | undefined): boolean {
  return spec !== undefined && availabilityOf(spec) === 'executable'
}

/* ══════════════════════════════ the 501, when it arrives anyway ══════════════════════════════ */

/**
 * The service's code for an action with no upstream. `admin-api/src/server.ts`.
 *
 * A catalogue fetched thirty seconds ago is a claim about the past: an action can be blocked
 * between the read and the write — the estate's whole point is that `actions.ts` changes when the
 * gap closes, and it can change in the other direction too. So the 501 is handled as well as
 * pre-empted, and it renders as the SAME sentence the catalogue would have shown, rather than as
 * a server error the operator is invited to retry.
 */
export const NO_UPSTREAM_CODE = 'action_has_no_upstream'

export function isNoUpstream(err: { status?: number; code?: string | undefined }): boolean {
  return err.status === 501 || err.code === NO_UPSTREAM_CODE
}

/* ══════════════════════════════ required parameters ══════════════════════════════ */

/**
 * Which required parameters are still missing.
 *
 * The service checks `typeof params[name] !== 'string' && typeof params[name] !== 'boolean'`
 * (admin-api/src/server.ts) — so `false` is a legal value and an empty string is NOT rejected
 * by that check. This console is stricter on the string case only: a blank `description` on a
 * ledger reversal would be accepted by the route and would be useless to the person reading the
 * journal in six months. Being stricter than the service is safe; being looser is how a client
 * offers a request the service will refuse.
 */
export function missingParams(
  spec: ActionSpec,
  params: Readonly<Record<string, string | boolean | undefined>>,
): readonly string[] {
  return spec.requiredParams.filter((name) => {
    const value = params[name]
    if (typeof value === 'boolean') return false
    return typeof value !== 'string' || value.trim().length === 0
  })
}

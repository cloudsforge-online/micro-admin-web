/**
 * §3.3g: an action with no executor must not look like one that can be executed.
 *
 * The rule these tests exist to hold, from `admin-api/src/server.ts:657-659`: a queue that accepts
 * work it cannot do lies to the operator waiting on it, and leaves a row at `approved` for ever —
 * which reads in the audit as two operators having authorised something that never happened.
 *
 * Every assertion here is about the CONSOLE'S half of that: the catalogue is rendered from data
 * rather than from a name in a list, so the day identity grows `PUT /internal/users/:id/roles` and
 * `admin-api` fills in `route`, the action becomes requestable with no change to this repository.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ActionSpec } from '../src/lib/admin.ts'
import {
  NO_UPSTREAM_CODE,
  availabilityOf,
  blockedActions,
  entryFor,
  executableActions,
  isNoUpstream,
  mayRequest,
  missingParams,
  readCatalogue,
} from '../src/lib/catalogue.ts'

/** The executable entry, as `GET /v1/actions` serves it (admin-api/src/actions.ts:102-109). */
const REVERSE: ActionSpec = {
  name: 'ledger.entry.reverse',
  subjectKind: 'ledger_entry',
  upstream: 'ledger',
  summary: 'Reverse a ledger entry with a new balanced journal entry. Never an UPDATE (AD-06).',
  route: 'POST /entries/:id/reverse — ledger/src/server.ts:394, scope ledger:post',
  blockedReason: null,
  requiredParams: ['description'],
}

const RESOLVE: ActionSpec = {
  name: 'market.moderation.case.resolve',
  subjectKind: 'moderation_case',
  upstream: 'market',
  summary: 'Uphold or dismiss a marketplace moderation case.',
  route: 'POST /v1/moderation/cases/:id/resolve — market/src/server.ts:1086, market:admin or role:admin',
  blockedReason: null,
  requiredParams: ['state'],
}

/** The §3.3g entry (admin-api/src/actions.ts:126-139), reproduced field for field. */
const ROLE_GRANT: ActionSpec = {
  name: 'identity.role.grant',
  subjectKind: 'user',
  upstream: null,
  summary: 'Grant a platform role. THE MOST AUDIT-WORTHY ACTION IN THE ESTATE — see the header.',
  route: null,
  blockedReason:
    'identity has no route that assigns users.roles. All 36 of its route definitions were ' +
    'enumerated: POST /auth/register hard-codes [\'player\'] (identity/src/users.ts:104-106) and ' +
    'POST /organisations/:id/memberships grants an organisation role, which SD-03 states is not ' +
    'a platform role. This service will not write to identity\'s database to work around it — ' +
    'rule 1, one database per service, checked in CI. It needs ' +
    'PUT /internal/users/:id/roles behind a service token holding identity:admin.',
  requiredParams: ['role'],
}

const CATALOGUE = [REVERSE, RESOLVE, ROLE_GRANT]

describe('availability turns on the route, and only on the route', () => {
  it('an action with a cited route is executable', () => {
    assert.equal(availabilityOf(REVERSE), 'executable')
  })

  it('an action with route null is unavailable', () => {
    assert.equal(availabilityOf(ROLE_GRANT), 'unavailable')
  })

  it('a null upstream does not by itself block: the ROUTE is the predicate', () => {
    // Same predicate the service uses at server.ts:660. A console that keyed off `upstream` would
    // disagree with `admin-api` the moment a catalogue entry named a route on a fourth upstream.
    assert.equal(availabilityOf({ ...REVERSE, upstream: null }), 'executable')
  })

  it('does not key off the action NAME', () => {
    // The day identity grows the route, `identity.role.grant` becomes requestable with no change
    // here. An allowlist in this repository would be a copy of the catalogue that goes stale.
    assert.equal(
      availabilityOf({ ...ROLE_GRANT, route: 'PUT /internal/users/:id/roles — identity/src/server.ts:1300' }),
      'executable',
    )
  })
})

describe('the blocked entry keeps admin-api’s own reason', () => {
  it('carries the blockedReason verbatim', () => {
    assert.equal(entryFor(ROLE_GRANT).blockedReason, ROLE_GRANT.blockedReason)
  })

  it('the reason names the route identity would need', () => {
    assert.match(entryFor(ROLE_GRANT).blockedReason ?? '', /PUT \/internal\/users\/:id\/roles/)
  })

  it('the reason names the scope that route would need', () => {
    assert.match(entryFor(ROLE_GRANT).blockedReason ?? '', /identity:admin/)
  })

  it('the reason says why admin-api will not write to identity’s database', () => {
    assert.match(entryFor(ROLE_GRANT).blockedReason ?? '', /one database per service/)
  })

  it('an executable entry carries no blocked reason at all', () => {
    assert.equal(entryFor(REVERSE).blockedReason, null)
  })

  it('falls back to a sentence rather than rendering the word null, if the service ever sends none', () => {
    const entry = entryFor({ ...ROLE_GRANT, blockedReason: null })
    assert.ok(entry.blockedReason)
    assert.doesNotMatch(entry.blockedReason, /^null$/)
    assert.match(entry.blockedReason, /no upstream route/)
  })
})

describe('the catalogue is listed, never filtered', () => {
  it('keeps the blocked entry in the list', () => {
    // Hiding it would leave an operator hunting for a capability the estate has decided it does
    // not have, and would erase the record of why.
    assert.equal(readCatalogue(CATALOGUE).length, 3)
    assert.ok(readCatalogue(CATALOGUE).some((e) => e.spec.name === 'identity.role.grant'))
  })

  it('puts the executable entries first', () => {
    const order = readCatalogue(CATALOGUE).map((e) => e.availability)
    assert.deepEqual(order, ['executable', 'executable', 'unavailable'])
  })

  it('preserves the service’s order within each side', () => {
    const names = readCatalogue(CATALOGUE)
      .filter((e) => e.availability === 'executable')
      .map((e) => e.spec.name)
    assert.deepEqual(names, ['ledger.entry.reverse', 'market.moderation.case.resolve'])
  })

  it('splits into exactly two lists that partition the catalogue', () => {
    const a = executableActions(CATALOGUE)
    const b = blockedActions(CATALOGUE)
    assert.equal(a.length + b.length, CATALOGUE.length)
    assert.equal(new Set([...a, ...b]).size, CATALOGUE.length)
  })

  it('reports the gap list as one entry long today', () => {
    assert.deepEqual(blockedActions(CATALOGUE).map((a) => a.name), ['identity.role.grant'])
  })

  it('does not assume the gap list stays one entry long', () => {
    const two = [...CATALOGUE, { ...ROLE_GRANT, name: 'something.else', route: null }]
    assert.equal(blockedActions(two).length, 2)
  })
})

describe('no control may send the request for a blocked action', () => {
  it('refuses to offer a request for the blocked entry', () => {
    assert.equal(mayRequest(ROLE_GRANT), false)
  })

  it('offers a request for an executable entry', () => {
    assert.equal(mayRequest(REVERSE), true)
  })

  it('refuses for an action that is not in the catalogue at all', () => {
    // A form rendered for an unknown action would send a request the service answers 400 for,
    // naming the legal set (server.ts:651-655).
    assert.equal(mayRequest(undefined), false)
  })
})

describe('the 501, when a catalogue read is out of date', () => {
  it('recognises the status', () => {
    assert.equal(isNoUpstream({ status: 501 }), true)
  })

  it('recognises the code, whatever the status', () => {
    assert.equal(isNoUpstream({ code: NO_UPSTREAM_CODE }), true)
  })

  it('uses the code admin-api actually sends', () => {
    assert.equal(NO_UPSTREAM_CODE, 'action_has_no_upstream')
  })

  it('does not mistake a 500 for it — a 501 says the operator did nothing wrong', () => {
    assert.equal(isNoUpstream({ status: 500 }), false)
  })

  it('does not mistake a 400 for it', () => {
    // server.ts:326-329 distinguishes them on purpose: a 400 means fix the request, a 501 means
    // the estate is missing a route and the response names it.
    assert.equal(isNoUpstream({ status: 400, code: 'bad_request' }), false)
  })

  it('does not mistake a 403 self-approval refusal for it', () => {
    assert.equal(isNoUpstream({ status: 403, code: 'self_approval_refused' }), false)
  })
})

describe('required parameters, checked before the request is sent', () => {
  it('reports a missing one by name', () => {
    assert.deepEqual(missingParams(REVERSE, {}), ['description'])
  })

  it('accepts a present string', () => {
    assert.deepEqual(missingParams(REVERSE, { description: 'reverses entry-1' }), [])
  })

  it('rejects a whitespace-only string, which the service would accept', () => {
    // Stricter than server.ts:670 on purpose: a blank description on a ledger reversal would be
    // accepted by the route and useless to whoever reads the journal in six months. Being
    // stricter than the service is safe; being looser offers a request the service refuses.
    assert.deepEqual(missingParams(REVERSE, { description: '   ' }), ['description'])
  })

  it('accepts `false` as a value, because server.ts:670 accepts a boolean', () => {
    const spec = { ...REVERSE, requiredParams: ['refund'] }
    assert.deepEqual(missingParams(spec, { refund: false }), [])
  })

  it('accepts `true` as a value', () => {
    const spec = { ...REVERSE, requiredParams: ['refund'] }
    assert.deepEqual(missingParams(spec, { refund: true }), [])
  })

  it('reports every missing name, not the first', () => {
    const spec = { ...REVERSE, requiredParams: ['a', 'b', 'c'] }
    assert.deepEqual(missingParams(spec, { b: 'set' }), ['a', 'c'])
  })

  it('reports nothing for an action that requires nothing', () => {
    assert.deepEqual(missingParams({ ...REVERSE, requiredParams: [] }, {}), [])
  })
})

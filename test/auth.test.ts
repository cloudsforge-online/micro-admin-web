/**
 * Reading the operator out of `/auth/me`, in the shape identity actually answers.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE EXISTS TO STOP BEING INHERITED.
 *
 * Identity answers `{ user: {...}, session: {...}, organisations: [...] }` — the profile is NESTED
 * under `user` (`identity/src/server.ts:891-903`, body built by `toPublicUser` at
 * `identity/src/users.ts:52-63`). `micro-web-template` and the four frontends cut from it declare
 * `interface Me { handle?, roles? }` and read those fields off the TOP level, where they are not.
 *
 * The consequence is not cosmetic. `roles` is then always null, so `isAdmin` in the company bar is
 * always false, and the switcher hides the three `adminOnly` entries — including this console —
 * from every operator who is signed in. Reported to `micro-web-template`; read correctly here.
 *
 * It matters more in this repository than in the others, because the principal is what the
 * four-eyes control turns on: an operator whose id could not be read is one the console cannot
 * tell apart from the person who raised the request in front of them.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OPERATOR_ROLE, readOperator } from '../src/lib/auth.tsx'

/** What identity actually puts on the wire. */
const NESTED = {
  user: {
    id: '11111111-2222-3333-4444-555555555555',
    email: 'op@example.test',
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    handle: 'jo',
    status: 'active',
    roles: ['admin', 'player'],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: null,
  },
  session: { id: 'sess-1', amr: ['pwd', 'otp'] },
  organisations: [],
}

describe('the nested shape identity answers', () => {
  it('reads the id out of `user`, not off the top level', () => {
    assert.equal(readOperator(NESTED).principal, 'user:11111111-2222-3333-4444-555555555555')
  })

  it('reads the handle out of `user`', () => {
    assert.equal(readOperator(NESTED).handle, 'jo')
  })

  it('reads the roles out of `user`', () => {
    assert.deepEqual(readOperator(NESTED).roles, ['admin', 'player'])
  })

  it('recognises the operator role, which is what the bar needs to show this console', () => {
    assert.equal(readOperator(NESTED).isOperator, true)
  })

  it('prefixes the principal with `user:`, matching approvals.requested_by', () => {
    assert.match(readOperator(NESTED).principal ?? '', /^user:/)
  })
})

describe('the flat shape, accepted as a fallback', () => {
  // A proxy or an older build on the rollback path may still answer flat. Understanding only the
  // current estate is how a client breaks during the migration it was written for.
  const FLAT = { id: 'abc', handle: 'jo', roles: ['admin'] }

  it('reads a flat id', () => {
    assert.equal(readOperator(FLAT).principal, 'user:abc')
  })

  it('reads a flat handle and roles', () => {
    assert.equal(readOperator(FLAT).handle, 'jo')
    assert.deepEqual(readOperator(FLAT).roles, ['admin'])
  })

  it('prefers the nested value when BOTH are present', () => {
    const both = { ...NESTED, handle: 'wrong', roles: ['player'] }
    assert.equal(readOperator(both).handle, 'jo')
    assert.deepEqual(readOperator(both).roles, ['admin', 'player'])
  })
})

describe('what it does when it cannot tell', () => {
  it('returns a null principal rather than a guess when there is no id', () => {
    // The console uses the principal to decide whether the signed-in operator raised a request.
    // Guessing would either offer a button that 403s or hide one that would have worked.
    const operator = readOperator({ user: { handle: 'jo', roles: ['admin'] } })
    assert.equal(operator.principal, null)
    assert.equal(operator.handle, 'jo')
  })

  it('returns an empty role list rather than null, so callers need no null check', () => {
    assert.deepEqual(readOperator({}).roles, [])
  })

  it('is not an operator when the roles are absent', () => {
    assert.equal(readOperator({}).isOperator, false)
  })

  it('is not an operator without the admin role', () => {
    assert.equal(readOperator({ user: { id: 'a', roles: ['player'] } }).isOperator, false)
  })

  it('survives a null body', () => {
    assert.deepEqual(readOperator(null), {
      principal: null,
      handle: null,
      roles: [],
      isOperator: false,
    })
  })

  it('survives a string body', () => {
    assert.equal(readOperator('nope').principal, null)
  })

  it('survives a null `user`', () => {
    assert.equal(readOperator({ user: null }).principal, null)
  })

  it('ignores a non-array roles value rather than throwing', () => {
    assert.deepEqual(readOperator({ user: { id: 'a', roles: 'admin' } }).roles, [])
  })

  it('drops non-string entries from a roles array', () => {
    assert.deepEqual(readOperator({ user: { id: 'a', roles: ['admin', 7, null] } }).roles, ['admin'])
  })

  it('treats an empty-string id as absent, not as `user:`', () => {
    assert.equal(readOperator({ user: { id: '' } }).principal, null)
  })
})

describe('the role name', () => {
  it('is the one admin-api requires', () => {
    // `requireOperator` at admin-api/src/server.ts:496 calls `isAdmin`, which reads `role:admin`.
    assert.equal(OPERATOR_ROLE, 'admin')
  })
})

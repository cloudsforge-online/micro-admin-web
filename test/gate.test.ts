/**
 * The gates, proven to refuse in every direction.
 *
 * A confirmation gate that only passes when it should is half a gate. Every test here has a
 * matching one for the opposite outcome, because the failure that actually ships is a gate that
 * has been quietly loosened — an accidental `||` for an `&&`, a `trim()` added to the wrong side
 * — and a suite that only checks the happy path goes green through all of them.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Approval } from '../src/lib/admin.ts'
import {
  confirmationGate,
  confirmationPhrase,
  decisionGate,
  idempotencyKeyFor,
  previewBroadcast,
  previewDecision,
  previewFlag,
  previewRequest,
} from '../src/lib/gate.ts'

const ID = '3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'
const OTHER_ID = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a'
const RAISER = 'user:11111111-2222-3333-4444-555555555555'
const APPROVER = 'user:66666666-7777-8888-9999-000000000000'
const NOW = new Date('2026-08-01T12:00:00.000Z')

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: ID,
    action: 'ledger.entry.reverse',
    subjectKind: 'ledger_entry',
    subjectId: 'entry-1',
    params: { description: 'reverses entry-1' },
    reasonCode: 'incident_remediation',
    reason: 'double posting during the 03:14 incident',
    requestedBy: RAISER,
    requestedAt: '2026-08-01T11:00:00.000Z',
    expiresAt: '2026-08-01T13:00:00.000Z',
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    executedAt: null,
    executionOutcome: null,
    executionDetail: null,
    correlationId: 'cf-abc',
    ...overrides,
  }
}

/* ══════════════════════════════ the phrase ══════════════════════════════ */

describe('the confirmation phrase names the request AND the outcome', () => {
  it('names the request and the action for an approval', () => {
    assert.equal(
      confirmationPhrase(true, ID, 'ledger.entry.reverse'),
      'approve 3f2a1b9c ledger.entry.reverse',
    )
  })

  it('names the request for a rejection', () => {
    assert.equal(confirmationPhrase(false, ID, 'ledger.entry.reverse'), 'reject 3f2a1b9c')
  })

  it('differs between approve and reject on the same request', () => {
    // A phrase that did not would let an operator who meant to reject confirm an approval.
    assert.notEqual(
      confirmationPhrase(true, ID, 'a'),
      confirmationPhrase(false, ID, 'a'),
    )
  })

  it('differs between two requests for the same action', () => {
    assert.notEqual(
      confirmationPhrase(true, ID, 'a'),
      confirmationPhrase(true, OTHER_ID, 'a'),
    )
  })

  it('differs between two actions on the same request', () => {
    assert.notEqual(
      confirmationPhrase(true, ID, 'ledger.entry.reverse'),
      confirmationPhrase(true, ID, 'billing.entitlement.revoke'),
    )
  })

  it('uses eight characters of the id — short enough to type, long enough not to collide', () => {
    assert.match(confirmationPhrase(false, ID, 'a'), /^reject [0-9a-f]{8}$/)
  })
})

/* ══════════════════════════════ the gate ══════════════════════════════ */

describe('the confirmation gate opens only when everything is right', () => {
  const phrase = 'approve 3f2a1b9c ledger.entry.reverse'

  it('opens with the right phrase and a rationale', () => {
    const gate = confirmationGate({ typed: phrase, required: phrase, rationale: 'checked' })
    assert.equal(gate.ready, true)
    assert.equal(gate.reason, null)
  })

  it('refuses an empty rationale, and says why', () => {
    const gate = confirmationGate({ typed: phrase, required: phrase, rationale: '' })
    assert.equal(gate.ready, false)
    assert.match(gate.reason ?? '', /audit row/)
  })

  it('refuses a whitespace-only rationale', () => {
    const gate = confirmationGate({ typed: phrase, required: phrase, rationale: '   \n\t ' })
    assert.equal(gate.ready, false)
  })

  it('refuses the WRONG PHRASE entirely', () => {
    const gate = confirmationGate({ typed: 'yes', required: phrase, rationale: 'checked' })
    assert.equal(gate.ready, false)
    assert.match(gate.reason ?? '', /to confirm/)
  })

  it('refuses the right verb against the WRONG OBJECT', () => {
    // The single most valuable refusal in the file: an operator with two requests open who types
    // the phrase for the other one.
    const gate = confirmationGate({
      typed: 'approve 9e8d7c6b ledger.entry.reverse',
      required: phrase,
      rationale: 'checked',
    })
    assert.equal(gate.ready, false)
  })

  it('refuses the right object with the WRONG OUTCOME', () => {
    const gate = confirmationGate({
      typed: 'reject 3f2a1b9c',
      required: phrase,
      rationale: 'checked',
    })
    assert.equal(gate.ready, false)
  })

  it('refuses the right object with the WRONG ACTION NAME', () => {
    const gate = confirmationGate({
      typed: 'approve 3f2a1b9c billing.entitlement.revoke',
      required: phrase,
      rationale: 'checked',
    })
    assert.equal(gate.ready, false)
  })

  it('refuses a prefix of the phrase', () => {
    const gate = confirmationGate({ typed: 'approve 3f2a1b9c', required: phrase, rationale: 'c' })
    assert.equal(gate.ready, false)
  })

  it('refuses a phrase with something appended to it', () => {
    const gate = confirmationGate({ typed: `${phrase} now`, required: phrase, rationale: 'c' })
    assert.equal(gate.ready, false)
  })

  it('refuses while a decision is already in flight — the CONCURRENT case', () => {
    // A double click that fires two decisions is exactly the shape the service's Idempotency-Key
    // exists to survive, and surviving it is not a reason to cause it.
    const gate = confirmationGate({ typed: phrase, required: phrase, rationale: 'c', busy: true })
    assert.equal(gate.ready, false)
    assert.match(gate.reason ?? '', /already being sent/)
  })

  it('reports the busy refusal FIRST, before the phrase or the rationale', () => {
    // Otherwise an operator whose first click is in flight is told to type the phrase they have
    // already typed, and clicks again.
    const gate = confirmationGate({ typed: '', required: phrase, rationale: '', busy: true })
    assert.match(gate.reason ?? '', /already being sent/)
  })

  it('accepts a different case: a caps-lock key is not evidence of anything', () => {
    const gate = confirmationGate({
      typed: 'APPROVE 3F2A1B9C LEDGER.ENTRY.REVERSE',
      required: phrase,
      rationale: 'c',
    })
    assert.equal(gate.ready, true)
  })

  it('accepts surrounding whitespace', () => {
    const gate = confirmationGate({ typed: `  ${phrase}  `, required: phrase, rationale: 'c' })
    assert.equal(gate.ready, true)
  })

  it('accepts collapsed internal whitespace', () => {
    // A gate that failed on a double space teaches people to copy and paste the phrase, which
    // defeats the entire mechanism.
    const gate = confirmationGate({
      typed: 'approve  3f2a1b9c   ledger.entry.reverse',
      required: phrase,
      rationale: 'c',
    })
    assert.equal(gate.ready, true)
  })

  it('does NOT accept a phrase with the words reordered', () => {
    const gate = confirmationGate({
      typed: 'ledger.entry.reverse 3f2a1b9c approve',
      required: phrase,
      rationale: 'c',
    })
    assert.equal(gate.ready, false)
  })

  it('states a reason for every refusal, so no control is ever silently disabled', () => {
    const cases = [
      { typed: phrase, required: phrase, rationale: '', busy: false },
      { typed: 'wrong', required: phrase, rationale: 'c', busy: false },
      { typed: phrase, required: phrase, rationale: 'c', busy: true },
    ]
    for (const input of cases) {
      const gate = confirmationGate(input)
      assert.equal(gate.ready, false)
      assert.ok((gate.reason ?? '').length > 10, `no usable reason for ${JSON.stringify(input)}`)
    }
  })
})

/* ══════════════════════════════ four eyes ══════════════════════════════ */

describe('the decision gate — four eyes, state and the deadline', () => {
  it('lets a different operator decide a live pending request', () => {
    const gate = decisionGate(approval(), APPROVER, NOW)
    assert.equal(gate.decidable, true)
    assert.equal(gate.reason, null)
    assert.equal(gate.selfRaised, false)
  })

  it('REFUSES the operator who raised it', () => {
    const gate = decisionGate(approval(), RAISER, NOW)
    assert.equal(gate.decidable, false)
    assert.equal(gate.selfRaised, true)
  })

  it('explains the refusal rather than only stating it', () => {
    const gate = decisionGate(approval(), RAISER, NOW)
    assert.match(gate.reason ?? '', /You raised this request/)
    assert.match(gate.reason ?? '', /Two operators are required/)
  })

  it('names all three places admin-api enforces it', () => {
    // The console's job is to make the control legible, not merely to obey it.
    const gate = decisionGate(approval(), RAISER, NOW)
    assert.match(gate.reason ?? '', /route/)
    assert.match(gate.reason ?? '', /UPDATE/)
    assert.match(gate.reason ?? '', /constraint/)
  })

  it('refuses an already-approved request', () => {
    const gate = decisionGate(approval({ state: 'approved', decidedBy: APPROVER }), APPROVER, NOW)
    assert.equal(gate.decidable, false)
    assert.match(gate.reason ?? '', /already approved/)
  })

  it('names who decided it, so the reader knows who to ask', () => {
    const gate = decisionGate(approval({ state: 'rejected', decidedBy: APPROVER }), RAISER, NOW)
    assert.match(gate.reason ?? '', new RegExp(APPROVER))
  })

  it('says nobody decided an expired request', () => {
    // An expired request carries no decidedBy, because nobody decided anything. Calling it
    // "rejected" would say two operators disagreed, which is not what happened.
    const gate = decisionGate(approval({ state: 'expired' }), APPROVER, NOW)
    assert.equal(gate.decidable, false)
    assert.match(gate.reason ?? '', /nobody decided it/)
  })

  it('refuses a request past its deadline that still reads pending', () => {
    // The row only says `expired` once the leased job sweeps it; `decide()` answers 409 in the
    // gap. A console that trusted `state` alone would offer a live-looking Approve button.
    const gate = decisionGate(
      approval({ expiresAt: '2026-08-01T11:59:00.000Z' }),
      APPROVER,
      NOW,
    )
    assert.equal(gate.decidable, false)
    assert.equal(gate.pastDeadline, true)
    assert.match(gate.reason ?? '', /passed its deadline/)
  })

  it('says the row is still listed as pending, so the two do not look like a contradiction', () => {
    const gate = decisionGate(approval({ expiresAt: '2026-08-01T11:00:00.000Z' }), APPROVER, NOW)
    assert.match(gate.reason ?? '', /expiry job has not swept it/)
  })

  it('reports the deadline exactly at the boundary as passed', () => {
    // `decide()` refuses at `expires_at <= now` (approvals.ts:263), so the console must too.
    const gate = decisionGate(approval({ expiresAt: NOW.toISOString() }), APPROVER, NOW)
    assert.equal(gate.pastDeadline, true)
    assert.equal(gate.decidable, false)
  })

  it('reports one second before the deadline as still open', () => {
    const gate = decisionGate(
      approval({ expiresAt: new Date(NOW.getTime() + 1000).toISOString() }),
      APPROVER,
      NOW,
    )
    assert.equal(gate.pastDeadline, false)
    assert.equal(gate.decidable, true)
  })

  it('reports the SELF refusal ahead of the deadline one', () => {
    // Both are true for an expired self-raised request. "You raised this" is the fact that tells
    // the operator what to do about it — find somebody else — and the deadline is secondary.
    const gate = decisionGate(approval({ expiresAt: '2026-08-01T11:00:00.000Z' }), RAISER, NOW)
    assert.match(gate.reason ?? '', /You raised this request/)
  })

  it('reports the DECIDED refusal ahead of everything: a decision is made once', () => {
    const gate = decisionGate(
      approval({ state: 'approved', decidedBy: APPROVER, expiresAt: '2026-08-01T11:00:00.000Z' }),
      RAISER,
      NOW,
    )
    assert.match(gate.reason ?? '', /already approved/)
  })

  it('offers the decision when the operator is UNKNOWN, and flags it', () => {
    // /auth/me is allowed to fail quietly. Refusing on a guess would block a legitimate approver,
    // and admin-api remains the thing that actually refuses.
    const gate = decisionGate(approval(), null, NOW)
    assert.equal(gate.decidable, true)
    assert.equal(gate.unknownOperator, true)
    assert.equal(gate.selfRaised, false)
  })

  it('does not mark an unknown operator as the raiser, even if the raiser is unknown too', () => {
    const gate = decisionGate(approval({ requestedBy: 'user:' }), null, NOW)
    assert.equal(gate.selfRaised, false)
  })

  it('treats an unparseable deadline as not passed rather than as passed', () => {
    // Refusing on a value the console could not read would block a decision on the strength of a
    // parsing failure. admin-api holds the real deadline and will refuse if it has gone.
    const gate = decisionGate(approval({ expiresAt: 'not a date' }), APPROVER, NOW)
    assert.equal(gate.pastDeadline, false)
    assert.equal(gate.decidable, true)
  })
})

/* ══════════════════════════════ the audit preview ══════════════════════════════ */

describe('the preview reproduces the rows admin-api will write', () => {
  it('a request writes admin.approval.requested against the approval', () => {
    const preview = previewRequest({
      actor: APPROVER,
      action: 'ledger.entry.reverse',
      subjectKind: 'ledger_entry',
      subjectId: 'entry-1',
      reasonCode: 'incident_remediation',
    })
    assert.equal(preview.action, 'admin.approval.requested')
    assert.equal(preview.subjectKind, 'approval')
    assert.equal(preview.outcome, 'allowed')
    assert.equal(preview.reasonCode, 'incident_remediation')
  })

  it('says the request id does not exist yet rather than showing a blank', () => {
    const preview = previewRequest({
      actor: APPROVER,
      action: 'a',
      subjectKind: 'k',
      subjectId: 's',
      reasonCode: 'r',
    })
    assert.match(preview.subjectId, /the id of the request this creates/)
  })

  it('says plainly that raising a request runs nothing', () => {
    const preview = previewRequest({
      actor: APPROVER,
      action: 'a',
      subjectKind: 'k',
      subjectId: 's',
      reasonCode: 'r',
    })
    assert.ok(preview.notes.some((n) => /Nothing happens until a second operator approves/.test(n)))
  })

  it('a grant previews TWO rows: the decision and the execution', () => {
    const previews = previewDecision(approval(), true, APPROVER)
    assert.equal(previews.length, 2)
    assert.equal(previews[0]?.action, 'admin.approval.granted')
    assert.equal(previews[1]?.action, 'admin.approval.executed')
  })

  it('a rejection previews ONE row, because nothing runs', () => {
    const previews = previewDecision(approval(), false, APPROVER)
    assert.equal(previews.length, 1)
    assert.equal(previews[0]?.action, 'admin.approval.rejected')
  })

  it('the execution row’s subject is the THING ACTED ON, not the approval', () => {
    // approvals.ts:350-351. Getting this wrong would make the audit unable to answer "what
    // happened to this ledger entry" by subject.
    const previews = previewDecision(approval(), true, APPROVER)
    assert.equal(previews[1]?.subjectKind, 'ledger_entry')
    assert.equal(previews[1]?.subjectId, 'entry-1')
  })

  it('the decision row’s subject IS the approval', () => {
    const previews = previewDecision(approval(), true, APPROVER)
    assert.equal(previews[0]?.subjectKind, 'approval')
    assert.equal(previews[0]?.subjectId, ID)
  })

  it('names both operators on the decision row', () => {
    const previews = previewDecision(approval(), true, APPROVER)
    assert.ok(previews[0]?.notes.some((n) => n.includes(RAISER)))
  })

  it('warns that a failed execution leaves the approval standing', () => {
    const previews = previewDecision(approval(), true, APPROVER)
    assert.ok(previews[1]?.notes.some((n) => /stays approved and unexecuted/.test(n)))
  })

  it('says a rejection cannot be decided again', () => {
    const previews = previewDecision(approval(), false, APPROVER)
    assert.ok(previews[0]?.notes.some((n) => /cannot be decided again/.test(n)))
  })

  it('names the actor when the console knows it', () => {
    assert.equal(previewDecision(approval(), false, APPROVER)[0]?.actor, APPROVER)
  })

  it('says where the actor comes from when the console does NOT know it', () => {
    // Never a blank and never a guess: admin-api takes the actor from the token.
    const preview = previewDecision(approval(), false, null)[0]
    assert.match(preview?.actor ?? '', /from your token/)
  })

  it('a first flag write previews admin.flag.created', () => {
    const preview = previewFlag({ actor: APPROVER, key: 'k', exists: false, enabled: false })
    assert.equal(preview.action, 'admin.flag.created')
    assert.equal(preview.subjectKind, 'feature_flag')
    assert.equal(preview.subjectId, 'k')
  })

  it('a later flag write previews admin.flag.changed', () => {
    assert.equal(
      previewFlag({ actor: APPROVER, key: 'k', exists: true, enabled: true }).action,
      'admin.flag.changed',
    )
  })

  it('says the flag row records the value before and after', () => {
    const preview = previewFlag({ actor: APPROVER, key: 'k', exists: true, enabled: true })
    assert.ok(preview.notes.some((n) => /BEFORE and AFTER/.test(n)))
  })

  it('a publish previews admin.broadcast.published', () => {
    const preview = previewBroadcast({ actor: APPROVER, retract: false, id: null, severity: 'info' })
    assert.equal(preview.action, 'admin.broadcast.published')
    assert.equal(preview.subjectKind, 'broadcast')
  })

  it('a retraction previews admin.broadcast.retracted', () => {
    const preview = previewBroadcast({ actor: APPROVER, retract: true, id: 'b1' })
    assert.equal(preview.action, 'admin.broadcast.retracted')
    assert.equal(preview.subjectId, 'b1')
  })

  it('says a retracted broadcast is not deleted', () => {
    const preview = previewBroadcast({ actor: APPROVER, retract: true, id: 'b1' })
    assert.ok(preview.notes.some((n) => /not deleted/.test(n)))
  })

  it('every preview carries at least one sentence, never a bare field list', () => {
    const all = [
      previewRequest({ actor: null, action: 'a', subjectKind: 'k', subjectId: 's', reasonCode: 'r' }),
      ...previewDecision(approval(), true, null),
      ...previewDecision(approval(), false, null),
      previewFlag({ actor: null, key: 'k', exists: true, enabled: true }),
      previewBroadcast({ actor: null, retract: false, id: null }),
      previewBroadcast({ actor: null, retract: true, id: 'b' }),
    ]
    for (const preview of all) {
      assert.ok(preview.notes.length > 0, `${preview.action} has no notes`)
      for (const note of preview.notes) assert.ok(note.length > 20)
    }
  })
})

/* ══════════════════════════════ idempotency keys ══════════════════════════════ */

describe('the idempotency key is per intention, not per click', () => {
  it('is stable for the same scope, subject and mint time', () => {
    assert.equal(idempotencyKeyFor('grant', ID, 1000), idempotencyKeyFor('grant', ID, 1000))
  })

  it('differs between approving and rejecting the same request', () => {
    assert.notEqual(idempotencyKeyFor('grant', ID, 1000), idempotencyKeyFor('reject', ID, 1000))
  })

  it('differs between two requests', () => {
    assert.notEqual(idempotencyKeyFor('grant', ID, 1000), idempotencyKeyFor('grant', OTHER_ID, 1000))
  })

  it('differs across page loads, because a reload is a new intention', () => {
    assert.notEqual(idempotencyKeyFor('grant', ID, 1000), idempotencyKeyFor('grant', ID, 2000))
  })

  it('is at least the eight characters the route requires (server.ts:994)', () => {
    for (const subject of ['', 'a', ID]) {
      assert.ok(idempotencyKeyFor('g', subject, 0).length >= 8)
    }
  })

  it('is at most the two hundred characters the route allows', () => {
    assert.ok(idempotencyKeyFor('grant', 'x'.repeat(500), Date.now()).length <= 200)
  })

  it('contains no character that would need escaping in a header', () => {
    assert.match(idempotencyKeyFor('grant', ID, Date.now()), /^[A-Za-z0-9._-]+$/)
  })
})

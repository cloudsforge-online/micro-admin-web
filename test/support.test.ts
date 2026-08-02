/**
 * The support lookup's logic, proven as pure functions.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **WHAT THIS SUITE REFUSES TO BE.**
 *
 * `docs/ecosystem/14 §11` records the defect class this estate keeps producing: a client test that
 * asserts the client posts to the URL the client was written to post to. It passes against a
 * broken client, because the stub answers whatever it is asked, and it is why a broken sign-in
 * went unnoticed. There is no such test here. Nothing below stubs `fetch`, and nothing below
 * asserts that `SupportPage` calls `loadAudit` — `test/admin.test.ts` already asserts the method,
 * path, query and headers of every request this bundle can make, against the route table, and
 * this screen deliberately adds no route to it.
 *
 * What is asserted here is the part that can be WRONG in a way a type checker and a stub both
 * miss: the ordering of a timeline, the merge of two answers into one, and the reading of an
 * amount out of a payload this console does not control.
 *
 * **No business rule is asserted here either.** Every rule in this estate is enforced server-side;
 * a frontend test that asserted one would pass against a backend that had stopped enforcing it,
 * which is 14 §11's game client hiding four SKUs while the payment routes stayed chargeable.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AuditEvent } from '../src/lib/admin.ts'
import {
  amountOf,
  compareSeq,
  correlationSpine,
  coverageOf,
  MIRROR_EXPECTED,
  mergeTimeline,
  parseSubject,
  readAmount,
} from '../src/lib/support.ts'

/** A row shaped exactly like `auditToJson` produces one. Overridden per case. */
function event(over: Partial<AuditEvent> & { seq: string; id: string }): AuditEvent {
  return {
    occurredAt: '2026-08-03T10:00:00.000Z',
    recordedAt: '2026-08-03T10:00:00.000Z',
    actor: 'user:11111111-1111-4111-8111-111111111111',
    action: 'approval.requested',
    subjectKind: 'user',
    subjectId: '22222222-2222-4222-8222-222222222222',
    reasonCode: null,
    outcome: 'allowed',
    source: 'admin-api',
    sourceEventId: null,
    correlationId: 'cf-thread-a',
    payload: {},
    prevHash: 'p',
    hash: 'h',
    ...over,
  }
}

/* ══════════════════════════════ the subject ══════════════════════════════ */

describe('parseSubject', () => {
  it('refuses an empty box, and says so rather than searching for nothing', () => {
    const parsed = parseSubject('   ')
    assert.equal(parsed.ok, false)
    assert.equal(parsed.ok === false && parsed.refusal, 'empty')
  })

  it('refuses anything that is not a uuid, and explains where a correlation id goes', () => {
    const parsed = parseSubject('cf-1a2b3c')
    assert.equal(parsed.ok, false)
    assert.equal(parsed.ok === false && parsed.refusal, 'not-a-uuid')
    // The refusal has to point somewhere: a correlation id IS searchable, on the audit screen.
    assert.match(parsed.ok === false ? parsed.message : '', /audit screen/)
  })

  it('accepts a uuid and trims what was pasted around it', () => {
    const parsed = parseSubject('  22222222-2222-4222-8222-222222222222\n')
    assert.equal(parsed.ok, true)
    assert.equal(parsed.ok === true && parsed.userId, '22222222-2222-4222-8222-222222222222')
  })

  it('lower-cases, because the filter is an equality match on the stored value', () => {
    // A uuid typed in capitals would match nothing and look like a user with no history — which,
    // on a balance dispute, is the wrong answer delivered silently.
    const parsed = parseSubject('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE')
    assert.equal(parsed.ok === true && parsed.userId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })
})

/* ══════════════════════════════ ordering ══════════════════════════════ */

describe('compareSeq', () => {
  it('compares as numbers, not as strings — seq 9 comes BEFORE seq 10', () => {
    // The whole reason this function exists. String comparison puts '10' before '9', which
    // reorders the events of an incident on a screen whose entire job is showing what happened in
    // what order.
    assert.ok(compareSeq('9', '10') < 0)
    assert.ok('9' < '10' === false, 'the string comparison this guards against still misbehaves')
  })

  it('handles sequences past Number.MAX_SAFE_INTEGER exactly', () => {
    // `seq` is a bigint on the wire for this reason; a Number() round trip would collapse these
    // two distinct sequences into one value and report them as equal.
    assert.ok(compareSeq('9007199254740993', '9007199254740992') > 0)
  })

  it('answers zero for the same sequence', () => {
    assert.equal(compareSeq('42', '42'), 0)
  })
})

/* ══════════════════════════════ the merge ══════════════════════════════ */

describe('mergeTimeline', () => {
  it('orders oldest first, by sequence and not by arrival', () => {
    // Both inputs arrive NEWEST first from the service, so a merge that preserved input order
    // would print the account backwards.
    const rows = mergeTimeline(
      [event({ seq: '10', id: 'b' }), event({ seq: '9', id: 'a' })],
      [],
    )
    assert.deepEqual(rows.map((r) => r.event.seq), ['9', '10'])
  })

  it('reports a row that arrived from BOTH queries once, as both', () => {
    // The user acting on themselves. Listed twice, an agent counting movements counts one too many.
    const shared = event({ seq: '5', id: 'same' })
    const rows = mergeTimeline([shared], [shared])
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.relation, 'both')
  })

  it('distinguishes what the user did from what was done to them', () => {
    const rows = mergeTimeline([event({ seq: '1', id: 'a' })], [event({ seq: '2', id: 'b' })])
    assert.deepEqual(rows.map((r) => r.relation), ['acted', 'subject'])
  })

  it('keeps every row when neither query overlaps the other', () => {
    const rows = mergeTimeline(
      [event({ seq: '3', id: 'c' }), event({ seq: '1', id: 'a' })],
      [event({ seq: '2', id: 'b' })],
    )
    assert.deepEqual(rows.map((r) => r.event.id), ['a', 'b', 'c'])
  })
})

/* ══════════════════════════════ the spine ══════════════════════════════ */

describe('correlationSpine', () => {
  it('groups the rows of one thread together and counts them', () => {
    const rows = mergeTimeline(
      [
        event({ seq: '1', id: 'a', correlationId: 'cf-one' }),
        event({ seq: '2', id: 'b', correlationId: 'cf-one' }),
        event({ seq: '3', id: 'c', correlationId: 'cf-two' }),
      ],
      [],
    )
    const spine = correlationSpine(rows)
    assert.equal(spine.groups.length, 2)
    assert.equal(spine.groups.find((g) => g.correlationId === 'cf-one')?.events, 2)
  })

  it('puts the most recently active thread first', () => {
    // A support request is nearly always about something that just happened.
    const rows = mergeTimeline(
      [
        event({ seq: '1', id: 'a', correlationId: 'cf-old' }),
        event({ seq: '9', id: 'b', correlationId: 'cf-new' }),
        event({ seq: '10', id: 'c', correlationId: 'cf-newest' }),
      ],
      [],
    )
    assert.deepEqual(
      correlationSpine(rows).groups.map((g) => g.correlationId),
      ['cf-newest', 'cf-new', 'cf-old'],
    )
  })

  it('records the sequence range of each thread, first and last', () => {
    const rows = mergeTimeline(
      [
        event({ seq: '4', id: 'a', correlationId: 'cf-one' }),
        event({ seq: '8', id: 'b', correlationId: 'cf-one' }),
      ],
      [],
    )
    const group = correlationSpine(rows).groups[0]
    assert.equal(group?.firstSeq, '4')
    assert.equal(group?.lastSeq, '8')
  })

  it('counts refused and failed rows, because "why was I blocked" is one of the five questions', () => {
    const rows = mergeTimeline(
      [
        event({ seq: '1', id: 'a', correlationId: 'cf-one', outcome: 'allowed' }),
        event({ seq: '2', id: 'b', correlationId: 'cf-one', outcome: 'refused' }),
        event({ seq: '3', id: 'c', correlationId: 'cf-one', outcome: 'failed' }),
      ],
      [],
    )
    assert.equal(correlationSpine(rows).groups[0]?.notAllowed, 2)
  })

  it('lists each contributing service once, in first-seen order', () => {
    const rows = mergeTimeline(
      [
        event({ seq: '1', id: 'a', correlationId: 'cf-one', source: 'admin-api' }),
        event({ seq: '2', id: 'b', correlationId: 'cf-one', source: 'ledger' }),
        event({ seq: '3', id: 'c', correlationId: 'cf-one', source: 'admin-api' }),
      ],
      [],
    )
    assert.deepEqual(correlationSpine(rows).groups[0]?.sources, ['admin-api', 'ledger'])
  })

  it('COUNTS rows with no correlation id rather than dropping them', () => {
    // A dropped row is a hole in the answer that the screen would present as completeness.
    const rows = mergeTimeline(
      [
        event({ seq: '1', id: 'a', correlationId: null }),
        event({ seq: '2', id: 'b', correlationId: '' }),
        event({ seq: '3', id: 'c', correlationId: 'cf-one' }),
      ],
      [],
    )
    const spine = correlationSpine(rows)
    assert.equal(spine.uncorrelated, 2)
    assert.equal(spine.groups.length, 1)
  })
})

/* ══════════════════════════════ coverage ══════════════════════════════ */

describe('coverageOf', () => {
  it('says NO service mirrors when every row came from admin-api itself', () => {
    // The estate's state today: `*.audit.recorded` has no producer anywhere, so this is the branch
    // that renders in a real deployment, and it must be the loud one.
    const rows = mergeTimeline([event({ seq: '1', id: 'a', source: 'admin-api' })], [])
    const coverage = coverageOf(rows)
    assert.equal(coverage.anyServiceMirrors, false)
    assert.deepEqual(coverage.present, ['admin-api'])
  })

  it('flips the moment any other service contributes a row', () => {
    // Derived from the rows, not from a constant — so the day a producer lands, the screen narrows
    // its own caveat without anybody editing this file.
    const rows = mergeTimeline([event({ seq: '1', id: 'a', source: 'ledger' })], [])
    assert.equal(coverageOf(rows).anyServiceMirrors, true)
  })

  it('names the services 17 §2 expects that produced nothing', () => {
    const rows = mergeTimeline([event({ seq: '1', id: 'a', source: 'ledger' })], [])
    const coverage = coverageOf(rows)
    assert.ok(!coverage.absent.includes('ledger'))
    assert.ok(coverage.absent.includes('wallet'))
    assert.ok(coverage.absent.includes('settlement'))
  })

  it('treats an empty answer as covering nothing, not as covering everything', () => {
    const coverage = coverageOf([])
    assert.equal(coverage.anyServiceMirrors, false)
    assert.deepEqual([...coverage.absent], [...MIRROR_EXPECTED])
  })
})

/* ══════════════════════════════ money ══════════════════════════════ */

describe('readAmount — the BigInt("") guard', () => {
  it('answers null for the empty string, which BigInt would make a confident zero', () => {
    // The single most important assertion in this file. `BigInt('')` is `0n` and does not throw,
    // so an absent amount coerced without this check is shown to a support agent as "0" while
    // they are answering "my balance is wrong".
    assert.equal(BigInt(''), 0n, 'the trap this guards against is still real')
    assert.equal(readAmount(''), null)
  })

  it('answers null for whitespace, which BigInt also makes zero', () => {
    assert.equal(BigInt('   '), 0n)
    assert.equal(readAmount('   '), null)
  })

  it('answers null for a missing field rather than zero', () => {
    assert.equal(readAmount(undefined), null)
    assert.equal(readAmount(null), null)
  })

  it('answers null for a JSON number, because money never arrives as one', () => {
    // A number near an 18-decimal amount comes back subtly wrong rather than visibly broken, so a
    // number in this position is a bug upstream and must not be rendered as if it were fine.
    assert.equal(readAmount(1000), null)
  })

  it('answers null for anything that is not a decimal integer', () => {
    for (const bad of ['1.5', '1e3', '1_000', '0x10', 'abc', '1,000', '+5']) {
      assert.equal(readAmount(bad), null, bad)
    }
  })

  it('reads a real amount, and normalises it through BigInt', () => {
    assert.equal(readAmount('0'), '0')
    assert.equal(readAmount('007'), '7')
    assert.equal(readAmount('-0'), '0')
    assert.equal(readAmount('-500'), '-500')
  })

  it('keeps an amount larger than a double exactly', () => {
    assert.equal(readAmount('123456789012345678901234567890'), '123456789012345678901234567890')
  })

  it('accepts a padded amount, since a payload is whatever the producer wrote', () => {
    assert.equal(readAmount(' 42 '), '42')
  })
})

describe('amountOf', () => {
  it('finds the field this estate actually writes', () => {
    assert.deepEqual(amountOf({ amountShards: '250' }), { field: 'amountShards', value: '250' })
  })

  it('falls back to a plain amount', () => {
    assert.deepEqual(amountOf({ amount: '17' }), { field: 'amount', value: '17' })
  })

  it('answers null rather than hunting for anything that looks like a number', () => {
    // A screen that scanned a payload for the first numeric-looking value would eventually find a
    // nonce, or a confirmation count, and call it money.
    assert.equal(amountOf({ nonce: '7', confirmations: '12' }), null)
  })

  it('does not let an empty amount field become a zero', () => {
    assert.equal(amountOf({ amountShards: '' }), null)
  })

  it('skips an unusable first field and takes the usable second', () => {
    assert.deepEqual(amountOf({ amountShards: '', amount: '9' }), { field: 'amount', value: '9' })
  })
})

/**
 * Audit rows, shaped like the ones `admin-api` sends.
 *
 * Read off `src/lib/admin.ts`'s `AuditEvent`, which mirrors `admin-api/src/audit.ts`'s
 * `auditToJson` field for field — including the one that matters most here: **`seq` is a STRING**,
 * because a bigint is not a JSON number. A fixture that made it a number would make the ordering
 * scenario assert against a payload no service sends, and the string-sort defect it exists to
 * catch would be untestable.
 *
 * The one rule these fixtures follow: **a fixture never carries a value the scenario asserts as a
 * literal.** Every scenario reads what it expects OUT of the fixture it supplied, so a fixture and
 * an assertion cannot agree with each other while both being wrong about the page.
 */
import type { AuditEvent, AuditPage } from '../src/lib/admin.ts'

export const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
export const OTHER_USER = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'

let n = 0

/**
 * One audit row.
 *
 * `source` defaults to `admin-api`, which is the only value the estate can actually produce today:
 * the topic `admin-api` consumes, `*.audit.recorded`, has no producer anywhere. A fixture
 * defaulting to `ledger` would make the coverage scenarios pass against a state the estate cannot
 * reach, which is the opposite of what they are for.
 */
export function event(over: Partial<AuditEvent> = {}): AuditEvent {
  n += 1
  return {
    seq: String(n),
    id: `evt-${String(n).padStart(4, '0')}`,
    occurredAt: '2026-08-03T09:00:00.000Z',
    recordedAt: '2026-08-03T09:00:00.000Z',
    actor: `user:${USER_ID}`,
    action: 'approval.decide',
    subjectKind: 'approval',
    subjectId: 'apr-0001',
    reasonCode: null,
    outcome: 'allowed',
    source: 'admin-api',
    sourceEventId: null,
    correlationId: 'corr-aaaa-0001',
    payload: {},
    prevHash: 'h0',
    hash: 'h1',
    ...over,
  }
}

/** A page of audit rows. `nextCursor` non-null is the service saying there are older rows. */
export const page = (events: readonly AuditEvent[], nextCursor: string | null = null): AuditPage => ({
  events,
  nextCursor,
})

/**
 * The estate's error envelope. `admin-api/src/server.ts` and `service-template/src/server.ts:342`
 * are the same three lines.
 */
export const errorBody = (
  code: string,
  message: string,
  requestId = 'cf-req-0042',
): Record<string, unknown> => ({ error: { code, message, requestId } })

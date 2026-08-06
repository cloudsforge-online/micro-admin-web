/**
 * The support lookup: from a USER to the correlation ids that answer "where did their money go".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **WHAT THIS SCREEN EXISTS FOR, AND THE ONE THING IT IS MEASURED AGAINST.**
 *
 * 17-definition-of-done.md, claim 9 of the eleven "one platform" tests:
 *
 *   > One operator view — a support agent can answer any question from one place.
 *   > *Evidence:* an operator answers "where did this user's money go" from `admin-web` alone,
 *   > **by correlation id**, without a `docker logs`.
 *
 * 05-user-journeys.md (journey 16) is the same requirement written as a workflow: a user
 * says "my balance is wrong", and the agent answers it from this console.
 *
 * The console already had half of it. `/audit` searches `GET /v1/audit?correlationId=…`, which is
 * the second half of claim 9 — *given a correlation id*, show what happened. What no screen could
 * do was the FIRST half: a support agent does not arrive holding a correlation id. They arrive
 * holding a **user**. This module is the missing pivot, and it is the whole reason this screen is
 * not a second copy of `/audit`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── Why TWO queries, and why they are not one ─────────────────────────────────────────────────
 *
 * `GET /v1/audit`'s filters are equality matches on indexed columns and there is no OR between
 * them (`admin-api/src/server.ts`, where the audit filters are read). "Everything about this user" is
 * therefore two different questions:
 *
 *   1. `actor=user:<id>`                   — what the user DID.
 *   2. `subjectKind=user&subjectId=<id>`   — what was done TO the user.
 *
 * Both are real filters on a real route. They are asked separately and merged here rather than
 * pretending one of them is the answer: a screen that asked only `actor` would silently omit every
 * refund, every reversal and every moderation decision taken about the user by somebody else,
 * which is most of what a balance dispute turns on. `relation` on each row records which question
 * produced it, so the operator can see which of the two they are reading.
 *
 * ── Ordering is by `seq`, compared as a NUMBER ────────────────────────────────────────────────
 *
 * `AuditEvent.seq` is a decimal STRING because a bigint is not a JSON number (`lib/admin.ts`).
 * Sorting those as strings puts seq 9 after seq 10, which on a timeline reorders the events of an
 * incident and is exactly the kind of wrong that looks right. `compareSeq` compares as `BigInt`.
 *
 * The timeline reads OLDEST FIRST, which is the opposite of `/audit`'s newest-first table and is
 * deliberate: "where did the money go" is a question about a sequence of events, and a sequence
 * read backwards is a sequence the reader has to reverse in their head.
 *
 * ── The BigInt('') trap, which on this screen shows somebody a balance of nothing ─────────────
 *
 * Money in this estate is `bigint` and travels as a decimal string. `BigInt('')` is `0n` — it does
 * not throw — so an absent amount coerced without checking renders as a confident `0`. On a
 * support screen answering a balance dispute that is not a cosmetic defect: it tells an agent that
 * a transfer moved nothing, and the agent tells the user. `readAmount` returns `null` for anything
 * that is not a well-formed decimal integer, and the screen renders the null as an absence.
 */
import type { AuditEvent } from './admin.ts'

/** A user id is a uuid — `admin-api/src/server.ts` is the same pattern, applied to item ids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Why a typed subject was not accepted, as something to SAY rather than a boolean.
 *
 * A search box that goes quiet on a malformed id teaches the operator that the user has no
 * history, which during a dispute is the wrong conclusion delivered silently.
 */
export type SubjectRefusal = 'empty' | 'not-a-uuid'

export type ParsedSubject =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly refusal: SubjectRefusal; readonly message: string }

/**
 * Read a user id out of what the operator typed.
 *
 * Trimmed, because an id arrives pasted out of a chat window and carries whatever was around it.
 * Lower-cased, because `audit_events.subject_id` stores what the producing service wrote and the
 * filter is an equality match: a uuid typed in capitals would match nothing and look like a user
 * with no history.
 *
 * **A correlation id is deliberately not accepted here.** It may be any
 * `[A-Za-z0-9._-]{1,128}` (`admin-api/src/server.ts`), which includes every uuid — so an
 * input box that took either could not tell which it had been given, and would have to guess
 * which column to search. Guessing is not a thing a money surface does. `/audit` already takes a
 * correlation id, this screen takes a user, and the correlation ids it finds link across.
 */
export function parseSubject(raw: string): ParsedSubject {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: false, refusal: 'empty', message: 'Enter the user id to look up.' }
  }
  if (!UUID.test(trimmed)) {
    return {
      ok: false,
      refusal: 'not-a-uuid',
      message:
        'A user id is a uuid. This box takes the user, not a correlation id — the audit screen ' +
        'takes those, and every correlation id found here links to it.',
    }
  }
  return { ok: true, userId: trimmed.toLowerCase() }
}

/** Which of the two questions produced a row. `both` is the user acting on themselves. */
export type Relation = 'acted' | 'subject' | 'both'

export interface TimelineRow {
  readonly event: AuditEvent
  readonly relation: Relation
}

/** Compare two `seq` strings as the bigints they are. See the header. */
export function compareSeq(a: string, b: string): number {
  const left = BigInt(a)
  const right = BigInt(b)
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Merge the two answers into one timeline, oldest first.
 *
 * Deduped by `AuditEvent.id`, not by `seq`: `seq` is unique in the log, but keying on the id is
 * what makes the merge express the actual relationship — the SAME row arriving from both queries
 * is the user having acted on themselves, and it is reported as `both` rather than listed twice.
 * A timeline that showed one event twice would make an agent counting movements count one too
 * many.
 */
export function mergeTimeline(
  byActor: readonly AuditEvent[],
  bySubject: readonly AuditEvent[],
): readonly TimelineRow[] {
  const rows = new Map<string, TimelineRow>()
  for (const event of byActor) rows.set(event.id, { event, relation: 'acted' })
  for (const event of bySubject) {
    const existing = rows.get(event.id)
    rows.set(event.id, { event, relation: existing === undefined ? 'subject' : 'both' })
  }
  return [...rows.values()].sort((a, b) => compareSeq(a.event.seq, b.event.seq))
}

/**
 * The correlation spine: the ids this user's history hangs off, and what each one covers.
 *
 * This is the object claim 9 names. Each group is one thread of activity that can be followed
 * across every service that shares the id — the same id is the `traceparent`, so it is also the
 * key into Grafana and Loki (05:408-410) — and each links to `/audit?correlationId=…`.
 *
 * Ordered by the LAST event in the group, most recent first: a support request is almost always
 * about something that just happened, so the thread the agent wants is at the top. Within the
 * group the events keep their own order, which `mergeTimeline` already fixed.
 */
export interface CorrelationGroup {
  readonly correlationId: string
  readonly events: number
  /** The `seq` of the first and last event in the group, for the range the operator reads. */
  readonly firstSeq: string
  readonly lastSeq: string
  readonly firstAt: string
  readonly lastAt: string
  /** Which services produced rows on this thread, in the order they first appear. */
  readonly sources: readonly string[]
  /** Rows the estate REFUSED or that FAILED. The thing a balance dispute usually turns out to be. */
  readonly notAllowed: number
}

export interface Spine {
  readonly groups: readonly CorrelationGroup[]
  /**
   * Rows carrying no correlation id at all.
   *
   * Reported rather than dropped. A row with no correlation id is a row that CANNOT be joined to
   * anything in another service, so it is a hole in the answer to claim 9, and an operator who was
   * shown a tidy list of threads with these quietly removed would think the account was fully
   * covered.
   */
  readonly uncorrelated: number
}

export function correlationSpine(rows: readonly TimelineRow[]): Spine {
  const groups = new Map<string, {
    events: number
    firstSeq: string
    lastSeq: string
    firstAt: string
    lastAt: string
    sources: string[]
    notAllowed: number
  }>()
  let uncorrelated = 0

  for (const row of rows) {
    const id = row.event.correlationId
    if (id === null || id.length === 0) {
      uncorrelated += 1
      continue
    }
    const existing = groups.get(id)
    // `rows` is already oldest-first, so the first sighting is the earliest and every later one
    // extends the end. No re-sorting, and therefore no second place for the order to be wrong.
    if (existing === undefined) {
      groups.set(id, {
        events: 1,
        firstSeq: row.event.seq,
        lastSeq: row.event.seq,
        firstAt: row.event.occurredAt,
        lastAt: row.event.occurredAt,
        sources: [row.event.source],
        notAllowed: row.event.outcome === 'allowed' ? 0 : 1,
      })
      continue
    }
    existing.events += 1
    existing.lastSeq = row.event.seq
    existing.lastAt = row.event.occurredAt
    if (!existing.sources.includes(row.event.source)) existing.sources.push(row.event.source)
    if (row.event.outcome !== 'allowed') existing.notAllowed += 1
  }

  const list = [...groups.entries()].map(([correlationId, g]) => ({
    correlationId,
    events: g.events,
    firstSeq: g.firstSeq,
    lastSeq: g.lastSeq,
    firstAt: g.firstAt,
    lastAt: g.lastAt,
    sources: g.sources,
    notAllowed: g.notAllowed,
  }))
  // Most recent thread first — see the doc comment.
  list.sort((a, b) => compareSeq(b.lastSeq, a.lastSeq))
  return { groups: list, uncorrelated }
}

/* ══════════════════════════════ what the answer does NOT cover ══════════════════════════════ */

/**
 * The services 17 §2 requires to mirror their audit rows here.
 *
 * `docs/ecosystem/17-definition-of-done.md`, on the Done checklist for every service:
 * "**Audit events** for every privileged action, written in the same transaction as the change,
 * **mirrored to `admin-api`**."
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **NOTHING IN THE ESTATE MIRRORS YET, AND THIS SCREEN SAYS SO RATHER THAN LOOKING COMPLETE.**
 *
 * `admin-api`'s intake is built: `POST /v1/events` verifies a signature over the exact bytes
 * before parsing them, demands the exact `admin:audit:write` scope, dedupes on the envelope id,
 * and takes the `source` from the authenticated sender rather than the payload
 * (`admin-api/src/server.ts`). What does not exist is a PRODUCER. The topic it consumes is
 * `*.audit.recorded` (`admin-api/src/server.ts`), and a search of every `src/` in the estate
 * finds that string in exactly one place: that line. `admin-api`'s own README records the same
 * finding as gap 2 (`admin-api/README.md`).
 *
 * So the timeline this screen renders contains `admin-api`'s own rows — approvals, decisions,
 * flags, broadcasts, engagement policy — and **nothing from identity, ledger, wallet, settlement,
 * custody, market or activity**, because those rows have no route into this database.
 *
 * That is the difference between this screen answering claim 9 and merely appearing to. An
 * operator shown a short, tidy timeline with no caveat concludes that little happened. The truth
 * is that little was *recorded here*, and the money services are the ones missing. The coverage
 * panel is therefore not decoration: it is the part that stops the screen from lying, and it is
 * rendered on every result including the empty one.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export const MIRROR_EXPECTED: readonly string[] = Object.freeze([
  'identity',
  'ledger',
  'wallet',
  'settlement',
  'custody',
  'market',
  'billing',
  'activity',
])

export interface Coverage {
  /** Services that produced at least one row in this answer. */
  readonly present: readonly string[]
  /** Services 17 §2 expects to mirror that produced none. */
  readonly absent: readonly string[]
  /**
   * True when at least one row came from a service OTHER than `admin-api`.
   *
   * The moment any service starts mirroring, this flips, and the screen's caveat narrows from
   * "nothing mirrors" to "these did not". Derived from the rows rather than from a constant, so
   * the day a producer lands this screen tells the truth without being edited.
   */
  readonly anyServiceMirrors: boolean
}

export function coverageOf(rows: readonly TimelineRow[]): Coverage {
  const present: string[] = []
  for (const row of rows) {
    if (!present.includes(row.event.source)) present.push(row.event.source)
  }
  present.sort()
  return {
    present,
    absent: MIRROR_EXPECTED.filter((service) => !present.includes(service)),
    anyServiceMirrors: present.some((source) => source !== 'admin-api'),
  }
}

/* ══════════════════════════════ money out of an audit payload ══════════════════════════════ */

/** A decimal integer, optionally negative. No exponent, no decimal point, no separators. */
const DECIMAL_INTEGER = /^-?\d+$/

/**
 * Read an amount out of an audit row's payload, or answer that there is not one.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **`BigInt('')` IS `0n`.** It does not throw. Neither does `BigInt(' ')`, which is also `0n`.
 *
 * An audit payload is `Record<string, unknown>` — it is whatever the producing service wrote, and
 * this console cannot make it be anything else. So an amount read out of one and handed to
 * `BigInt` without a check turns a missing field, an empty string and a whitespace string into a
 * confident, correctly-formatted **zero**. On this screen that zero is shown to a support agent
 * who is answering "my balance is wrong", and the agent repeats it to the user.
 *
 * `null` is therefore the answer for anything not provably a decimal integer, and the caller
 * renders the null as an absence. Showing "not recorded" where an amount should be is a prompt to
 * go and look; showing `0` is a wrong answer that nobody will question.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The round trip through `BigInt` is what normalises `007` and `-0`; the regex is what makes the
 * round trip safe to attempt.
 */
export function readAmount(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  // The empty string is checked FIRST and explicitly, rather than being left to the pattern,
  // because it is the specific value this function exists for.
  if (trimmed.length === 0) return null
  if (!DECIMAL_INTEGER.test(trimmed)) return null
  return BigInt(trimmed).toString()
}

/**
 * The amount an audit row is about, if it names one.
 *
 * The field names are the ones this estate's own actions write: `engagement.transfer` puts
 * `amountShards` in `params` (`admin-api/src/actions.ts`), and a ledger movement carries
 * `amount`. Anything else answers null rather than being guessed at — a support screen that
 * hunted through a payload for the first thing that looked like a number would eventually find a
 * nonce and call it money.
 */
export const AMOUNT_FIELDS: readonly string[] = Object.freeze(['amountShards', 'amount'])

export function amountOf(payload: Record<string, unknown>): { field: string; value: string } | null {
  for (const field of AMOUNT_FIELDS) {
    const value = readAmount(payload[field])
    if (value !== null) return { field, value }
  }
  return null
}

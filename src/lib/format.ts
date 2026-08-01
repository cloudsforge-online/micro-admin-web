/**
 * Turning the estate's facts into words, without inventing any.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TWO RULES, AND THEY PULL IN THE SAME DIRECTION.
 *
 * **1. Every figure carries its observation time.** `GET /v1/estate` has no cache and no
 * `asOf` field: `estate.ts` fetches every tile live with a deadline, deliberately, because "an
 * operator who acts on a cached 'ledger: ok' from ninety seconds ago is acting on a fact that has
 * since changed". The service therefore does not stamp the answer — so this console stamps the
 * moment the RESPONSE ARRIVED, and labels it as that rather than as the moment the fact was true.
 * The two are not the same and the difference is the network. Saying "read at 14:32:07" is
 * honest; saying "as at 14:32:07" would be a claim about the estate that this bundle cannot make.
 *
 * **2. Never invent a number. Missing is missing, not zero.** `Tile.data` is never null — the
 * service always returns the empty value so a client can render a state — but the fields inside
 * it are: `trialBalance.data.balanced` is `null` when the ledger could not be reached, and
 * `openModerationCases.data.count` is `null` when market could not. A console that rendered
 * either as `0` would report a balanced ledger and an empty moderation queue during an outage,
 * which is the most dangerous possible reading of both.
 *
 * So `figure()` returns a discriminated answer rather than a string, and there is no code path
 * anywhere in this bundle that coalesces a null count to zero. `test/format.test.ts` walks every
 * one of them.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import type { TileStatus } from './admin.ts'

/* ══════════════════════════════ time ══════════════════════════════ */

/** A wall-clock time, in the reader's locale, to the second. Operators work in seconds. */
export function clockTime(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/**
 * When this figure was READ, and how long ago that was.
 *
 * The relative half is what makes a stale page visible: an operator who left the tab open through
 * a handover sees "read 41 minutes ago" rather than a number that looks current. The absolute
 * half is what they quote.
 */
export function asOfLabel(readAt: Date, now: Date): string {
  return `read at ${clockTime(readAt)} · ${relative(readAt, now)}`
}

/** "just now", "12 seconds ago", "3 minutes ago", "in 2 hours". Never a bare number. */
export function relative(at: Date, now: Date): string {
  const ms = at.getTime() - now.getTime()
  const abs = Math.abs(ms)
  if (abs < 5_000) return 'just now'
  const [value, unit] = pick(abs)
  const plural = value === 1 ? unit : `${unit}s`
  return ms < 0 ? `${value} ${plural} ago` : `in ${value} ${plural}`
}

function pick(ms: number): [number, string] {
  const seconds = Math.round(ms / 1000)
  if (seconds < 90) return [seconds, 'second']
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return [minutes, 'minute']
  const hours = Math.round(minutes / 60)
  if (hours < 36) return [hours, 'hour']
  return [Math.round(hours / 24), 'day']
}

/**
 * An ISO timestamp from the service, as a full local date and time.
 *
 * An unparseable value is returned VERBATIM rather than replaced with "Invalid Date": if a
 * service ever puts something unexpected on the wire, an operator seeing the actual string can
 * report it, and an operator seeing "Invalid Date" can only report that the console is broken.
 */
export function timestamp(iso: string | null): string {
  if (iso === null || iso.length === 0) return '—'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * How long until a deadline, and whether it has passed.
 *
 * Used on the approval queue, where "expires in 4 minutes" is the difference between a request a
 * second operator can still answer and one they cannot. The clock is the browser's and may be
 * wrong; the absolute deadline is always rendered beside this for that reason.
 */
export interface Deadline {
  readonly passed: boolean
  readonly label: string
  /** True inside the last hour, which is what `estate.approvals.expiringWithinHour` counts. */
  readonly soon: boolean
}

export function deadline(expiresAt: string, now: Date): Deadline {
  const at = new Date(expiresAt)
  if (Number.isNaN(at.getTime())) {
    return { passed: false, label: 'no readable deadline', soon: false }
  }
  const ms = at.getTime() - now.getTime()
  if (ms <= 0) return { passed: true, label: `deadline passed ${relative(at, now)}`, soon: false }
  return { passed: false, label: `expires ${relative(at, now)}`, soon: ms <= 3_600_000 }
}

/* ══════════════════════════════ numbers that may be absent ══════════════════════════════ */

/**
 * A figure, or the honest absence of one.
 *
 * `present: false` is NOT "zero" and never renders as a digit. The `because` field carries the
 * tile's own reason so the absence names its cause — "market answered 503" rather than a dash the
 * reader has to interpret.
 */
export interface Figure {
  readonly present: boolean
  readonly text: string
  readonly because: string | null
}

export function figure(value: number | string | null | undefined, because: string | null = null): Figure {
  if (value === null || value === undefined) {
    return { present: false, text: 'not measured', because }
  }
  return {
    present: true,
    text: typeof value === 'number' ? value.toLocaleString() : value,
    because: null,
  }
}

/** A count with its noun, pluralised. "1 request", "0 requests" — zero is a real answer here. */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`
}

/* ══════════════════════════════ principals and ids ══════════════════════════════ */

/**
 * A principal, split into what it IS and who it is.
 *
 * `admin-api` writes `user:<uuid>` or `service:<name>` and `audit_events_actor_is_a_principal`
 * refuses anything else. The two are rendered differently on purpose: an action taken by a person
 * and an action taken by a service are different facts, and an audit log that looked the same for
 * both is one where "how many distinct parties touched this" cannot be answered by reading it.
 */
export interface Principal {
  readonly kind: 'user' | 'service' | 'unknown'
  readonly id: string
  /** Eight characters of a uuid, or the whole service name. What fits in a table cell. */
  readonly short: string
  readonly raw: string
}

export function principal(raw: string): Principal {
  const at = raw.indexOf(':')
  if (at < 0) return { kind: 'unknown', id: raw, short: raw.slice(0, 8), raw }
  const kind = raw.slice(0, at)
  const id = raw.slice(at + 1)
  if (kind === 'user') return { kind: 'user', id, short: id.slice(0, 8), raw }
  if (kind === 'service') return { kind: 'service', id, short: id, raw }
  return { kind: 'unknown', id, short: id.slice(0, 8), raw }
}

/** The first eight characters of a uuid — what a phrase names and what a table shows. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}

/* ══════════════════════════════ state, never by colour alone ══════════════════════════════ */

/**
 * How a state is rendered: a word, a glyph, and a tone.
 *
 * **The word and the glyph come first and the tone is third**, which is the order they matter in.
 * The estate's reserved status hues sit ΔE 4.6 apart under protanopia (measured in `micro-ui`,
 * and the reason `status-web` encodes every day three times), so colour cannot be the channel
 * that says whether the ledger balances. Every consumer of this function renders the word.
 */
export interface Tone {
  readonly tone: 'good' | 'warn' | 'crit' | 'mute'
  readonly glyph: string
  readonly word: string
}

/** `admin-api/src/estate.ts:35` — the three tile statuses, and what each one means to a reader. */
export function tileTone(status: TileStatus): Tone {
  if (status === 'ok') return { tone: 'good', glyph: '●', word: 'OK' }
  // Degraded is not "slightly unavailable". `estate.ts` marks the services tile degraded when it
  // HAS its data and the data is that services are down, and marks the ledger tile degraded when
  // the trial balance is answered and is not zero. Both are answers, and both are bad news.
  if (status === 'degraded') return { tone: 'warn', glyph: '▲', word: 'DEGRADED' }
  return { tone: 'crit', glyph: '■', word: 'UNAVAILABLE' }
}

/** `admin-api/src/approvals.ts:42`. */
export function approvalTone(state: string): Tone {
  if (state === 'pending') return { tone: 'warn', glyph: '◷', word: 'PENDING' }
  if (state === 'approved') return { tone: 'good', glyph: '✓', word: 'APPROVED' }
  if (state === 'rejected') return { tone: 'mute', glyph: '×', word: 'REJECTED' }
  if (state === 'expired') return { tone: 'mute', glyph: '⊘', word: 'EXPIRED' }
  return { tone: 'mute', glyph: '?', word: state.toUpperCase() }
}

/** `admin-api/src/audit.ts` — the three audit outcomes. */
export function outcomeTone(outcome: string): Tone {
  if (outcome === 'allowed') return { tone: 'good', glyph: '✓', word: 'ALLOWED' }
  if (outcome === 'refused') return { tone: 'warn', glyph: '⊘', word: 'REFUSED' }
  if (outcome === 'failed') return { tone: 'crit', glyph: '■', word: 'FAILED' }
  return { tone: 'mute', glyph: '?', word: outcome.toUpperCase() }
}

/** `admin-api/src/broadcasts.ts:27`. */
export function severityTone(severity: string): Tone {
  if (severity === 'incident') return { tone: 'crit', glyph: '■', word: 'INCIDENT' }
  if (severity === 'maintenance') return { tone: 'warn', glyph: '▲', word: 'MAINTENANCE' }
  return { tone: 'mute', glyph: '●', word: 'INFO' }
}

/**
 * The verdict on the audit chain.
 *
 * Three answers, not two. A chain that verifies and a chain that has NEVER BEEN VERIFIED are
 * different facts: SD-16 verifies continuity nightly and calls a break a P0, so a verification
 * that has never run is a control that is not running — and `estate.ts` marks the tile degraded
 * for exactly that (estate.ts:206-216). Reporting it as "OK" would be reporting the absence of
 * evidence as evidence of absence.
 */
export function chainTone(input: { ok: boolean; breaks: number; everVerified: boolean }): Tone {
  if (!input.ok || input.breaks > 0) return { tone: 'crit', glyph: '■', word: 'BROKEN' }
  if (!input.everVerified) return { tone: 'warn', glyph: '▲', word: 'NEVER VERIFIED' }
  return { tone: 'good', glyph: '✓', word: 'VERIFIED' }
}

/**
 * A hash, shortened for a table but never silently.
 *
 * The full value is always available in a `title` and on the detail row; this is the reading
 * form. A truncated hash rendered without the ellipsis is how somebody comes to compare two
 * prefixes and conclude two different rows are the same row.
 */
export function shortHash(hash: string | null): string {
  if (hash === null || hash.length === 0) return '—'
  return hash.length <= 20 ? hash : `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

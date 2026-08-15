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

/** `admin-api/src/estate.ts` — the three tile statuses, and what each one means to a reader. */
export function tileTone(status: TileStatus): Tone {
  if (status === 'ok') return { tone: 'good', glyph: '●', word: 'OK' }
  // Degraded is not "slightly unavailable". `estate.ts` marks the services tile degraded when it
  // HAS its data and the data is that services are down, and marks the ledger tile degraded when
  // the trial balance is answered and is not zero. Both are answers, and both are bad news.
  if (status === 'degraded') return { tone: 'warn', glyph: '▲', word: 'DEGRADED' }
  return { tone: 'crit', glyph: '■', word: 'UNAVAILABLE' }
}

/** `admin-api/src/approvals.ts`. */
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

/**
 * `nda/src/worlds.ts` — where a world is in its own life.
 *
 * A world in LOBBY is warn rather than mute, and that is the whole judgement here: it is finished,
 * it has a map, and not one person can be in it until an operator opens it. That is work waiting,
 * which is what this console's warn tone means everywhere else — the same reading `approvalTone`
 * gives `pending`. Rendering it as a neutral state would put the one world that needs a decision
 * in the same visual register as the ones that are over.
 */
export function worldTone(status: string): Tone {
  if (status === 'lobby') return { tone: 'warn', glyph: '◷', word: 'IN LOBBY' }
  if (status === 'active') return { tone: 'good', glyph: '●', word: 'BEING PLAYED' }
  if (status === 'archived') return { tone: 'mute', glyph: '⊘', word: 'ARCHIVED' }
  return { tone: 'mute', glyph: '?', word: status.toUpperCase() }
}

/** `admin-api/src/broadcasts.ts`. */
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
 * for exactly that (estate.ts). Reporting it as "OK" would be reporting the absence of
 * evidence as evidence of absence.
 */
export function chainTone(input: { ok: boolean; breaks: number; everVerified: boolean }): Tone {
  if (!input.ok || input.breaks > 0) return { tone: 'crit', glyph: '■', word: 'BROKEN' }
  if (!input.everVerified) return { tone: 'warn', glyph: '▲', word: 'NEVER VERIFIED' }
  return { tone: 'good', glyph: '✓', word: 'VERIFIED' }
}

/* ══════════════════════════ backup and restore ══════════════════════════ */

/*
 * `UINT` and `groupDigits` are declared further down, with the Foresight helpers that first needed
 * them. Neither is Foresight-specific — one refuses a string that is not a run of digits, the
 * other groups digits in threes without going near `Intl.NumberFormat`, which takes a `number` —
 * so they are shared rather than copied. A second `/^\d+$/` in this file would be the beginning of
 * two rules about what counts as a number.
 */

/** The five states of a backup run. `BackupRun.state` in lib/admin.ts. */
export function backupTone(state: string): Tone {
  if (state === 'succeeded') return { tone: 'good', glyph: '✓', word: 'SUCCEEDED' }
  if (state === 'running') return { tone: 'warn', glyph: '◷', word: 'RUNNING' }
  if (state === 'queued') return { tone: 'warn', glyph: '◷', word: 'QUEUED' }
  if (state === 'failed') return { tone: 'crit', glyph: '■', word: 'FAILED' }
  // Pruned is not a failure and it is not nothing: the run happened, and its files are gone. A
  // console that rendered it as mute-and-unlabelled would let an operator plan a restore from a
  // directory that no longer exists.
  if (state === 'pruned') return { tone: 'mute', glyph: '⊘', word: 'PRUNED' }
  return { tone: 'mute', glyph: '?', word: state.toUpperCase() }
}

/** The five states of a restore run. `RestoreRun.state` in lib/admin.ts. */
export function restoreTone(state: string): Tone {
  if (state === 'succeeded') return { tone: 'good', glyph: '✓', word: 'SUCCEEDED' }
  if (state === 'running') return { tone: 'warn', glyph: '◷', word: 'RUNNING' }
  if (state === 'queued') return { tone: 'warn', glyph: '◷', word: 'QUEUED' }
  if (state === 'failed') return { tone: 'crit', glyph: '■', word: 'FAILED' }
  // REFUSED is the service declining to act — an environment mismatch, a missing approval — and it
  // is the same tone `outcomeTone` gives a refusal, because it means the same thing: nothing
  // happened, and the reason is worth reading.
  if (state === 'refused') return { tone: 'warn', glyph: '⊘', word: 'REFUSED' }
  return { tone: 'mute', glyph: '?', word: state.toUpperCase() }
}

/**
 * Whether anything has ever PROVED this backup, which is a different question from whether it ran.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * A BACKUP NOBODY HAS RESTORED IS A WISH.
 *
 * The same three-answer shape as `chainTone`, and for the same reason it exists there: a backup
 * that verifies and a backup that has NEVER BEEN VERIFIED are different facts, and reporting the
 * second as the first is reporting the absence of evidence as evidence of absence. `succeeded`
 * means the files were written. It says nothing whatsoever about whether they read back.
 *
 * The third answer is for a run with no artefacts a restore could have proved — queued, running,
 * failed, or pruned. Calling those "never verified" would put a warning on every row in a healthy
 * list and teach an operator to read past the one that matters.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function verificationTone(input: { verifiedAt: string | null; state: string }): Tone {
  if (input.verifiedAt !== null && input.verifiedAt.length > 0) {
    return { tone: 'good', glyph: '✓', word: 'VERIFIED BY RESTORE' }
  }
  if (input.state === 'succeeded') return { tone: 'warn', glyph: '▲', word: 'NEVER VERIFIED' }
  return { tone: 'mute', glyph: '·', word: 'NOTHING TO VERIFY' }
}

/** 1024, as a bigint, because every divisor below one is one. */
const KIB = 1024n
const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const

/**
 * A byte count, from a bigint-as-string, without ever going through `Number`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `BackupRun.totalBytes` AND `Artefact.bytes` ARE STRINGS BECAUSE THEY ARE bigint COLUMNS.
 *
 * A directory of database dumps and vault tarballs passes 2^53 bytes long before it is
 * remarkable, and past that point `Number(s)` silently returns a different number — so
 * `Number(bytes) / 1024 ** 3` is a size that is wrong in the direction nobody checks, on the one
 * screen where the size is the evidence that the backup contains anything at all.
 *
 * So the whole computation is bigint. The two decimal places are produced by scaling into
 * hundredths BEFORE the final divide, and the remainder is CUT rather than rounded — the same
 * decision `formatWei` records, and the safe direction here too: understating a size by less than
 * the last displayed digit can never make an empty backup look populated.
 *
 * Anything that is not a run of digits returns null rather than being coerced. `BigInt('')` is
 * `0n`, and "0 B" is precisely the reading a missing size must never produce.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function formatBytes(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const raw = value.trim()
  if (!UINT.test(raw)) return null

  let n = BigInt(raw)
  // Below a kibibyte there is nothing to scale and no fraction worth showing.
  if (n < KIB) return `${groupDigits(raw)} B`

  let unit = 0
  // Stop while `n` is still under 1024^2, so the last divide below has two whole digits of
  // precision left to take its hundredths from.
  while (n >= KIB * KIB && unit < BYTE_UNITS.length - 2) {
    n /= KIB
    unit += 1
  }
  const hundredths = (n * 100n) / KIB
  unit += 1
  const whole = hundredths / 100n
  const fraction = hundredths % 100n
  return `${groupDigits(whole.toString())}.${fraction.toString().padStart(2, '0')} ${
    BYTE_UNITS[unit] ?? BYTE_UNITS[BYTE_UNITS.length - 1]
  }`
}

/** The exact count, grouped, for the title beside the human size. Null when it is not a number. */
export function exactBytes(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const raw = value.trim()
  return UINT.test(raw) ? `${groupDigits(raw)} bytes` : null
}

/**
 * An instant as `2026-08-04T12:00:00Z` — seconds, UTC, no fractional part.
 *
 * **This is a wire format, not a reading format**, and the difference matters more here than
 * anywhere else in this file: it is the exact spelling of the timestamp inside the phrase
 * `admin-api` compares a live restore's `confirmation` against, byte for byte. `timestamp()`
 * renders in the reader's locale and would produce a phrase the service rejects; `utcStamp()`
 * renders `2026-08-04 12:00 UTC`, which is a different string again and drops the seconds.
 *
 * Null for anything unparseable, and the caller must then refuse to offer the action rather than
 * ask an operator to type a phrase this console could not construct.
 */
export function utcSecondStamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return `${at.toISOString().slice(0, 19)}Z`
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

/* ══════════════════════════ the Foresight screens (P13, folded in) ══════════════════════════ */

/**
 * Everything below serves the Foresight operator screens, which moved into this console at P13.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── MONEY IS A STRING ALL THE WAY TO THE DOM ─────────────────────────────────────────────────
 *
 * Pool amounts are wei: decimal strings of up to 78 digits, summed in bigint by the mirror and
 * stored in `numeric(78,0)` (foresight/src/mirror.ts). One EMBER is 1e18 wei, so
 * `Number('1234567890123456789')` has already lost the bottom four digits before anything is
 * displayed. Every function in this section is a STRING operation or a bigint one. Nothing calls
 * `parseFloat`, `Number()` or `toLocaleString` on an amount.
 *
 * ── TWO NAMES CHANGED ON THE WAY IN, AND BOTH FOR THE SAME REASON ────────────────────────────
 *
 * `micro-foresight-admin-web` had a `format.ts` of its own and this console already had one. Two
 * of the names collided with DIFFERENT SIGNATURES, which is the merge hazard worth naming because
 * TypeScript would not have caught either — each call site imports one symbol and typechecks
 * against whichever definition won:
 *
 *   * `asOfLabel(iso: string | null)` there vs `asOfLabel(readAt: Date, now: Date)` here. They are
 *     not two spellings of one idea: this console's stamps when a RESPONSE ARRIVED, and
 *     foresight's stamps when the CHAIN MIRROR last synced. Renamed to `mirrorAsOf` below, which
 *     is what it has always meant.
 *   * `shortId(id: string | null | undefined): string | null` there vs
 *     `shortId(id: string): string` here. Same idea, same eight characters — so foresight's copy
 *     is simply gone and its call sites use this file's, which is above.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Anything that is not an unsigned integer string is refused rather than coerced. */
const UINT = /^\d+$/

/**
 * Wei as EMBER, cut to `maxDecimals`.
 *
 * Pure string work: the point is inserted `decimals` from the right and the tail is CUT, never
 * rounded. Rounding a pool up shows an operator EMBER that is not in the contract, and on a
 * settlement screen that is the error nobody forgives. Cutting understates by less than the last
 * displayed digit, which is the safe direction.
 */
export function formatWei(
  value: string | null | undefined,
  { decimals = 18, maxDecimals = 4 }: { decimals?: number; maxDecimals?: number } = {},
): string | null {
  if (value === null || value === undefined) return null
  const raw = value.trim()
  if (!UINT.test(raw)) return null

  const padded = raw.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  const fraction = decimals === 0 ? '' : padded.slice(padded.length - decimals)

  let shown = fraction.slice(0, maxDecimals)
  while (shown.length > 0 && shown.endsWith('0')) shown = shown.slice(0, -1)

  const grouped = groupDigits(whole)
  return shown.length > 0 ? `${grouped}.${shown}` : grouped
}

/**
 * Group an integer digit string in threes — `12345678` → `12,345,678`.
 *
 * Written out rather than delegated to `Intl.NumberFormat`, which takes a `number` and therefore
 * silently rounds anything past 2^53 — which a pool in wei routinely is.
 */
export function groupDigits(digits: string): string {
  let out = ''
  for (let i = 0; i < digits.length; i += 1) {
    const fromRight = digits.length - i
    if (i > 0 && fromRight % 3 === 0) out += ','
    out += digits[i]
  }
  return out
}

/**
 * Basis points as a percentage, to one decimal place.
 *
 * `yesBps` is an integer the service computed in bigint before narrowing (mirror.ts), so
 * this genuinely is integer arithmetic and not a money value passing through a double.
 */
export function formatBps(bps: number | null | undefined): string | null {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return null
  const whole = Math.trunc(bps / 100)
  const tenths = Math.trunc(Math.abs(bps % 100) / 10)
  return `${whole}.${tenths}%`
}

/**
 * `2026-07-31 14:22 UTC`. Null for anything unparseable — never "now", never the empty string.
 *
 * Deliberately NOT `timestamp()` above, which renders in the reader's locale and time zone. The
 * same market close time has to read identically on a laptop, in CI and in a screenshot attached
 * to an incident: an operator in Athens and an operator in London must not disagree about when a
 * pool was last observed, which is the one thing an observation stamp exists to settle.
 */
export function utcStamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const date = at.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const time = at.toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  // en-GB gives dd/mm/yyyy; ISO order sorts and reads unambiguously for an audience that is half
  // British and half not.
  const [day, month, year] = date.split('/')
  return `${year}-${month}-${day} ${time} UTC`
}

/**
 * The observation stamp shown beside every mirrored figure.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * A NUMBER WITH NO `asOf` IS A CLAIM ABOUT NOW THAT IS REALLY A CLAIM ABOUT THE LAST SYNC.
 *
 * `null` in gives **"never synced"**, not "as of now" and not an empty string. The mirror having
 * never run and the pool being empty produce identical numbers and mean opposite things
 * (mirror.ts), so the two are never allowed to render the same.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function mirrorAsOf(iso: string | null | undefined): string {
  const stamp = utcStamp(iso)
  return stamp === null ? 'never synced' : `as of ${stamp}`
}

/** How far behind the tip, in words. Null when the service did not say. */
export function behindLabel(behindBlocks: number | null | undefined): string | null {
  if (behindBlocks === null || behindBlocks === undefined || !Number.isFinite(behindBlocks)) {
    return null
  }
  if (behindBlocks <= 0) return 'at the chain tip'
  return `${behindBlocks} block${behindBlocks === 1 ? '' : 's'} behind the tip`
}

/**
 * A duration in seconds, in words. Used for the dispute window.
 *
 * Exact rather than approximate: "48 hours" and "47 hours 59 minutes" are different promises when
 * one of them is when a stranger may claim their money.
 */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return null
  }
  const whole = Math.trunc(seconds)
  if (whole === 0) return 'none'
  const parts: string[] = []
  const days = Math.trunc(whole / 86_400)
  const hours = Math.trunc((whole % 86_400) / 3600)
  const minutes = Math.trunc((whole % 3600) / 60)
  const secs = whole % 60
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (secs) parts.push(`${secs}s`)
  return parts.join(' ')
}

/**
 * A link that is safe to put in an operator's browser.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE SOURCES ON THE IDEA QUEUE CAME OUT OF A WEB SEARCH AND A LANGUAGE MODEL.
 *
 * They are rendered prominently, which is the point of the screen — and they are also the one
 * field in this whole console whose content nobody in this estate wrote. A `javascript:` URL in a
 * source list is a script that runs with the operator's session, and since the fold that session
 * is the one that can also authorise a ledger reversal. So the scheme is checked against an
 * allowlist and anything else renders as inert text with its raw value shown, rather than as a
 * link that does not work or a link that does something else.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    // A relative reference has no origin to judge and no business in a cited-source list.
    return null
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
}

/** The host of a source, shown beside its title so the operator sees who is being cited. */
export function hostOf(url: string | null | undefined): string | null {
  const safe = safeHref(url)
  if (safe === null) return null
  try {
    return new URL(safe).host
  } catch {
    return null
  }
}

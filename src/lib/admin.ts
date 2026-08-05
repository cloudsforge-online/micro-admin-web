/**
 * The `admin-api` client — every route this console can reach, and the line each was read off.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **EVERY CALL BELOW CITES THE `admin-api/src/server.ts` LINE IT WAS VERIFIED AGAINST.**
 *
 * This estate has shipped clients against imagined surfaces repeatedly —
 * `docs/ecosystem/18-build-status.md` §3.3i and §3.3m, which record the class rather than a count
 * that has drifted in four repositories.
 * `wallet/src/pricingclient.ts` called `GET /v1/quotes`; pricing has never served that route.
 * `micro-market` called `POST /v1/decisions/market.listing`; policy has no `/v1` routes at all, a
 * 404 from policy is `peerDecided`, and every listing came back 403 for as long as it lived. Most
 * recently a client made every on-chain escrow activation fail and reported a false cause.
 *
 * All of them had tests. The tests stubbed fetch and asserted the RESPONSE — and a stub answers
 * whatever it is told to whatever it is asked, so a wrong path is invisible to it. Nothing in a
 * TypeScript build catches it either: the types on both sides are perfect and the string between
 * them is fiction.
 *
 * So `test/admin.test.ts` asserts the METHOD, the PATH, the QUERY, the BODY and the HEADERS of
 * every request this bundle can make, and a final test asserts that the set of paths exercised is
 * EXACTLY `ADMIN_ROUTES` below — so a route invented in a later edit fails the build rather than
 * production.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── The one route on `admin-api` this console deliberately never calls ────────────────────────
 *
 * `POST /v1/events` (server.ts:497) is the estate's audit mirror intake. Its body is verified
 * against `OUTBOX_SIGNING_SECRET` over the exact bytes received, with a timing-safe comparison,
 * BEFORE `JSON.parse` is called on it, and the bearer must additionally hold the exact
 * `admin:audit:write` scope (server.ts:501-510). A browser holds neither the estate secret nor a
 * service scope, and a console that appeared to offer it would be offering a forgery endpoint for
 * the record disputes are settled against. It is absent on purpose and `test/admin.test.ts`
 * asserts its absence.
 *
 * ── An operator acts as themselves ────────────────────────────────────────────────────────────
 *
 * No function here takes an actor, a `userId`, or any other parameter naming who the action is
 * for. `admin-api` derives the actor from the verified bearer on every mutating route, and the
 * frozen estate's `/internal` routes — which took a `userId` as a parameter, and which
 * `deploy/gateway/dynamic/policy.yml` refuses from outside for exactly that reason — are the
 * thing this shape exists not to be. Where a route names a user it is a SUBJECT.
 */
import { api, type RequestOptions } from './api.ts'

/* ══════════════════════════════ the wire shapes ══════════════════════════════ */

/** `admin-api/src/estate.ts:35`. */
export type TileStatus = 'ok' | 'degraded' | 'unavailable'

/** `admin-api/src/estate.ts:37-44`. `data` is never null, so a client renders a state. */
export interface Tile<T> {
  readonly status: TileStatus
  readonly upstream: string
  readonly reason: string | null
  readonly data: T
}

/** `admin-api/src/estate.ts:56-61`. */
export interface ServiceHealth {
  readonly name: string
  readonly ready: boolean
  readonly state: string
  readonly detail: string | null
}

/** `admin-api/src/estate.ts:63-70`, served by `GET /v1/estate` at server.ts:879. */
export interface EstateView {
  readonly services: Tile<readonly ServiceHealth[]>
  readonly trialBalance: Tile<{ balanced: boolean | null; totalAbsoluteDelta: string | null }>
  readonly openModerationCases: Tile<{ count: number | null }>
  readonly approvals: Tile<{ pending: number; expiringWithinHour: number }>
  readonly audit: Tile<{ headSeq: string; headHash: string | null; lastVerifiedSeq: string | null }>
  readonly broadcasts: Tile<{ live: number }>
}

/** `admin-api/src/actions.ts:84-99`, served by `GET /v1/actions` at server.ts:617. */
export interface ActionSpec {
  readonly name: string
  readonly subjectKind: string
  readonly upstream: 'ledger' | 'market' | 'billing' | null
  readonly summary: string
  /** The upstream route this executes, cited. **`null` means there is no executor.** */
  readonly route: string | null
  readonly blockedReason: string | null
  readonly requiredParams: readonly string[]
}

export interface ActionCatalogue {
  readonly actions: readonly ActionSpec[]
  /** `admin-api/src/approvals.ts:53-61` — a CLOSED list; free text is required as well. */
  readonly reasonCodes: readonly string[]
}

/** `admin-api/src/approvals.ts:42`. */
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired'
export type ExecutionOutcome = 'succeeded' | 'failed'

/** `admin-api/src/approvals.ts:93-112`. */
export interface Approval {
  readonly id: string
  readonly action: string
  readonly subjectKind: string
  readonly subjectId: string
  readonly params: Record<string, unknown>
  readonly reasonCode: string
  readonly reason: string
  /** `user:<uuid>`. The four-eyes control compares this with the deciding operator. */
  readonly requestedBy: string
  readonly requestedAt: string
  readonly expiresAt: string
  readonly state: ApprovalState
  readonly decidedBy: string | null
  readonly decidedAt: string | null
  readonly decisionNote: string | null
  readonly executedAt: string | null
  readonly executionOutcome: ExecutionOutcome | null
  readonly executionDetail: Record<string, unknown> | null
  readonly correlationId: string | null
}

/** `admin-api/src/audit.ts:auditToJson`. `seq` is a STRING: a bigint is not a JSON number. */
export interface AuditEvent {
  readonly seq: string
  readonly id: string
  readonly occurredAt: string
  readonly recordedAt: string
  readonly actor: string
  readonly action: string
  readonly subjectKind: string
  readonly subjectId: string
  readonly reasonCode: string | null
  readonly outcome: 'allowed' | 'refused' | 'failed'
  readonly source: string
  readonly sourceEventId: string | null
  readonly correlationId: string | null
  readonly payload: Record<string, unknown>
  readonly prevHash: string
  readonly hash: string
}

export interface AuditPage {
  readonly events: readonly AuditEvent[]
  /** The seq to pass as `before` for the next page. Null when there is no next page. */
  readonly nextCursor: string | null
}

/** One finding from a verification pass. `admin-api/src/audit.ts`, rendered at server.ts:602. */
export interface ChainBreak {
  readonly kind:
    | 'hash_mismatch'
    | 'link_mismatch'
    | 'checkpoint_missing'
    | 'checkpoint_mismatch'
    | 'checkpoint_truncated'
  readonly seq: string
  readonly detail: string
}

/** `GET /v1/audit/verify`, server.ts:595-603. Answers 200 whether or not the chain verifies. */
export interface ChainVerification {
  readonly ok: boolean
  readonly checked: number
  readonly from: string
  readonly to: string
  readonly totalEvents: number
  readonly headHash: string
  readonly breaks: readonly ChainBreak[]
}

/** `admin-api/src/flags.ts:45-53`. */
export interface FeatureFlag {
  readonly key: string
  readonly enabled: boolean
  readonly description: string
  readonly owner: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly updatedBy: string
}

/** `admin-api/src/broadcasts.ts:27`. */
export type Severity = 'info' | 'maintenance' | 'incident'
export const SEVERITIES: readonly Severity[] = ['info', 'maintenance', 'incident']

/** `admin-api/src/broadcasts.ts:45-56`. */
export interface Broadcast {
  readonly id: string
  readonly severity: Severity
  readonly title: string
  readonly body: string
  readonly startsAt: string
  readonly endsAt: string | null
  readonly publishedBy: string
  readonly publishedAt: string
  readonly retractedAt: string | null
  readonly retractedBy: string | null
}

/* ══════════════════════════ backup and restore ══════════════════════════ */

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THESE SEVEN WERE WRITTEN AGAINST AN AGREED CONTRACT AND THEN RE-READ AGAINST THE SERVICE.
 *
 * `admin-api`'s backup module was being built in parallel with these screens, so for a while they
 * were the only routes in this client with no `server.ts` line behind them — which is exactly the
 * situation that produced `wallet/src/pricingclient.ts` calling `GET /v1/quotes` against a service
 * that has never served it. They now carry their lines, and the re-read moved four things. Each is
 * recorded where it bites rather than only here, because the next person to compare the two will
 * be looking at the call, not at this block:
 *
 *   1. **`POST /v1/restores` REFUSES `mode: "live"`** (server.ts:1552). The only door to a live
 *      restore is the approval queue: `estate.restore`, two operators, and the executor at
 *      `approvals.ts` creates the restore itself. `startVerifyRestore` below is therefore the only
 *      restore this client can post, and the live path raises an APPROVAL instead.
 *   2. **`GET /v1/backups` serves `estate`** (server.ts:1350), so this console no longer derives
 *      the estate's environment from the runs it can see. The service holds the fact; a derivation
 *      beside it would be a second, unversioned opinion.
 *   3. **`GET /v1/backups/:id` serves `liveConfirmationPhrase`** (server.ts:1460), built by
 *      `expectedConfirmation` — the same string `requestRestore` compares with `!==`. The console
 *      shows the SERVED one for that reason, and keeps its own builder only as a fallback.
 *   4. **`ceilings` is a set of `{min, max}` ranges** (server.ts:1368-1382), not the flat map the
 *      contract left unspecified. It is declared below now that it exists.
 *
 * The one thing the contract did not specify and the service confirmed: `POST /v1/backups` takes
 * `kind` (optional, defaulting to `full`) and `reason` (server.ts:1479, 1490).
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The estate a backup was taken from. A restore across two of these is refused by the service. */
export type BackupEnvironment = 'mainnet' | 'testnet' | 'development'

export type BackupKind = 'full' | 'databases' | 'custody' | 'files'
export const BACKUP_KINDS: readonly BackupKind[] = ['full', 'databases', 'custody', 'files']

export type BackupState = 'queued' | 'running' | 'succeeded' | 'failed' | 'pruned'

/**
 * One backup run.
 *
 * **`totalBytes` is a bigint as a STRING.** A directory of database dumps and vault tarballs
 * passes 2^53 bytes long before it is remarkable, and `Number('9007199254740993')` is already
 * wrong. Nothing in this bundle parses it to a number; `formatBytes` in lib/format.ts is bigint
 * and string work throughout.
 */
export interface BackupRun {
  readonly id: string
  readonly environment: BackupEnvironment
  readonly composeProject: string
  readonly kind: BackupKind
  readonly state: BackupState
  readonly requestedBy: string
  readonly reason: string | null
  readonly rootPath: string
  readonly directory: string | null
  readonly queuedAt: string
  readonly startedAt: string | null
  readonly finishedAt: string | null
  /** Bigint as a string. Never parsed to a number for display maths. */
  readonly totalBytes: string | null
  readonly artefactCount: number | null
  readonly manifestSha256: string | null
  readonly clusterSystemId: string | null
  readonly includesCustody: boolean
  readonly error: string | null
  /**
   * When a restore last PROVED this backup, and which one did.
   *
   * The single most important field on the row. A backup nobody has restored is a claim about the
   * future, and `null` here is that claim being unproven rather than a missing value.
   */
  readonly verifiedAt: string | null
  readonly verifiedByRestore: string | null
}

/**
 * One file inside a backup.
 *
 * **Names and checksums only.** There is no field here that carries contents, and nothing in this
 * console asks for one: an operator console that could render the inside of a vault tarball is a
 * console that leaks every key it is meant to be protecting. `bytes` and `entryCount` are bigints
 * as strings for the same reason `totalBytes` is.
 */
export interface Artefact {
  readonly id: string
  readonly kind: 'database' | 'vault' | 'files'
  readonly name: string
  readonly relPath: string
  readonly bytes: string
  readonly sha256: string
  readonly entryCount: string | null
}

export type RestoreMode = 'verify' | 'live'
export type RestoreState = 'queued' | 'running' | 'succeeded' | 'failed' | 'refused'

export interface RestoreRun {
  readonly id: string
  readonly backupRunId: string
  readonly environment: string
  readonly mode: RestoreMode
  readonly targets: readonly string[]
  readonly state: RestoreState
  readonly requestedBy: string
  readonly reason: string | null
  /** The approved two-operator `estate.restore` request. Required by the service for `live`. */
  readonly approvalId: string | null
  readonly queuedAt: string
  readonly startedAt: string | null
  readonly finishedAt: string | null
  /** The environment stamped INSIDE the artefacts, which is what the service compares. */
  readonly artefactEnvironment: string | null
  readonly checksumsVerified: boolean | null
  readonly outcome: Record<string, unknown>
  readonly error: string | null
}

/**
 * What the backup destination actually protects against, in the service's own words.
 *
 * `covers` and `doesNotCover` are served rather than written here on purpose. The console's job is
 * to render them plainly and refuse to dress them up — see `components/protection.tsx`.
 * `custodyKeyringIncluded` is typed as the literal `false` because the contract types it that way:
 * it is not a flag that might one day be true, it is a statement.
 */
export interface Protection {
  readonly destinationDevice: string
  readonly sameHost: boolean
  readonly covers: readonly string[]
  readonly doesNotCover: readonly string[]
  readonly custodyKeyringIncluded: false
  readonly custodyKeyringNote: string
}

export interface BackupSettings {
  readonly rootPath: string
  readonly retentionCopies: number
  /** Bigint as a string. */
  readonly ceilingBytes: string
  /** Bigint as a string. */
  readonly minFreeBytes: string
  readonly scheduleEnabled: boolean
  readonly scheduleEveryMinutes: number
  readonly verifyEnabled: boolean
  readonly verifyEveryMinutes: number
  readonly updatedAt: string
  readonly updatedBy: string
}

/**
 * The bounds `admin-api` enforces on the settings above — `CEILINGS`, admin-api/src/backups.ts:179,
 * served at **server.ts:1368-1382**.
 *
 * A pair per field rather than a single number, because both ends are real: a retention of 400
 * copies and a schedule of one minute are both refused. The two byte figures arrive as decimal
 * STRINGS for the same reason `ceilingBytes` does on the settings themselves — they are `bigint`
 * in the service.
 */
export interface Bound<T> {
  readonly min: T
  readonly max: T
}

export interface BackupCeilings {
  readonly retentionCopies: Bound<number>
  /** Bigint bounds, as decimal strings. */
  readonly ceilingBytes: Bound<string>
  /** Bigint bounds, as decimal strings. */
  readonly minFreeBytes: Bound<string>
  readonly scheduleEveryMinutes: Bound<number>
  readonly verifyEveryMinutes: Bound<number>
  /**
   * A bound `admin-api` adds later, and this console has not been rebuilt for.
   *
   * ── WHY AN INDEX SIGNATURE BESIDE FIVE NAMED FIELDS, WHICH LOOKS LIKE HAVING IT BOTH WAYS ────
   *
   * It is not a hedge about the shape; the five above are the shape, and they typecheck. It is
   * about the direction the two failures point in. A settings form that renders only the fields
   * this bundle knew about at build time WITHDRAWS any bound the service has started enforcing —
   * and the operator meets it as a 400 with no explanation on screen. There is no equivalent cost
   * to rendering one extra row.
   *
   * So the renderer walks the object (`ceilingRows`, lib/backups.ts) and the type says such a walk
   * is legitimate rather than requiring a cast to make it compile. A cast would have hidden exactly
   * this, which is the point: the honest widening is in the type, not at the call site.
   */
  readonly [bound: string]: Bound<number> | Bound<string> | undefined
}

/**
 * Which estate this is, as the SERVICE says it is — `estate_identity`, served at server.ts:1350.
 *
 * ── WHY THIS BEING SERVED MATTERS MORE THAN IT LOOKS ──────────────────────────────────────────
 *
 * `requestRestore` (admin-api/src/backups.ts:608-622) reads this row and refuses a restore whose
 * backup was taken in a different environment, with `EnvironmentMismatchError`. So this is not a
 * label: it is one half of the comparison that decides whether a restore happens, and the console
 * puts it beside the other half so the operator sees the refusal coming.
 *
 * `environment` is nullable because an estate that has never claimed an identity has none — and in
 * that state `requestRestore` refuses every restore outright rather than guessing. The console
 * renders the absence rather than a plausible default.
 */
export interface EstateIdentity {
  readonly environment: string | null
  readonly composeProject: string
}

export interface BackupsPage {
  readonly backups: readonly BackupRun[]
  readonly settings: BackupSettings
  readonly protection: Protection
  readonly estate: EstateIdentity
}

export interface BackupDetail {
  readonly backup: BackupRun
  readonly artefacts: readonly Artefact[]
  readonly restores: readonly RestoreRun[]
  /**
   * The exact phrase a live restore's `confirmation` must equal.
   *
   * Served rather than composed by the console (server.ts:1460), and USED rather than merely
   * compared: `requestRestore` checks it with `!==` (backups.ts:645), so a client that rendered its
   * own rendering of the same timestamp would refuse every live restore in the estate the day the
   * two spellings diverged by one character. `restoreConfirmationPhrase` in lib/gate.ts survives
   * only as the fallback for a response that does not carry this.
   */
  readonly liveConfirmationPhrase?: string
}

/* ══════════════════════════════ the route table ══════════════════════════════ */

/**
 * Every path this bundle may request, with the `admin-api/src/server.ts` line that defines it.
 *
 * Read by `test/admin.test.ts`, which fails if a call is made to a path that is not here and if a
 * path here is never exercised. A parameterised segment is written as it appears in the service's
 * own `define(...)` call, so the two can be compared by eye as well as by test.
 */
export const ADMIN_ROUTES: Readonly<
  Record<string, { method: string; line: number | null; contract?: string }>
> =
  Object.freeze({
    // Re-read against admin-api at 25beaea+bc88503, when the engagement routes shifted every
    // line below them. A citation that has drifted is worse than none: it is checkable, and it
    // checks out against the wrong thing.
    '/v1/estate': { method: 'GET', line: 1075 },
    '/v1/actions': { method: 'GET', line: 638 },
    '/v1/approvals': { method: 'GET', line: 652 },
    '/v1/approvals/:id': { method: 'GET', line: 666 },
    '/v1/approvals#post': { method: 'POST', line: 674 },
    '/v1/approvals/:id/decision': { method: 'POST', line: 786 },
    '/v1/audit': { method: 'GET', line: 586 },
    '/v1/audit/verify': { method: 'GET', line: 608 },
    '/v1/flags': { method: 'GET', line: 851 },
    '/v1/flags/:key': { method: 'PUT', line: 857 },
    '/v1/broadcasts': { method: 'GET', line: 888 },
    '/v1/broadcasts#post': { method: 'POST', line: 904 },
    '/v1/broadcasts/:id': { method: 'DELETE', line: 941 },
    // The engagement treasury — docs/ecosystem/21 §6.
    '/v1/engagement/policies': { method: 'GET', line: 956 },
    '/v1/engagement/policies/:service': { method: 'PUT', line: 984 },
    '/v1/engagement/report': { method: 'GET', line: 1046 },
    // ── Backup and restore. Agreed as a contract, then re-read against the service. ────────────
    //
    // `/v1/backups/settings` is DECLARED BEFORE `/v1/backups/:id` so a reader sees the collision
    // rather than discovering it: `settings` occupies the id slot. `admin-api` defines them in the
    // same order (server.ts:1359 before :1445), which is what makes the literal win.
    '/v1/backups': { method: 'GET', line: 1332 },
    '/v1/backups#post': { method: 'POST', line: 1473 },
    '/v1/backups/settings': { method: 'GET', line: 1359 },
    '/v1/backups/settings#put': { method: 'PUT', line: 1387 },
    '/v1/backups/:id': { method: 'GET', line: 1445 },
    '/v1/restores': { method: 'GET', line: 1520 },
    // Verify only. `mode: "live"` is a 400 here by design (server.ts:1552), and the live path goes
    // through `/v1/approvals#post` above with action `estate.restore`.
    '/v1/restores#post': { method: 'POST', line: 1546 },
  })

/**
 * Routes on `admin-api` that this bundle must NEVER call, and why.
 *
 * Asserted by `test/admin.test.ts`. An absence is not something a reader can see, so it is
 * written down and checked — the same reason `foresight-admin-web` asserts the absence of the
 * three routes it might have invented.
 */
export const REFUSED_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  'POST /v1/events':
    'the estate audit mirror intake (server.ts:497). Its body is signature-checked against ' +
    'OUTBOX_SIGNING_SECRET before it is parsed, and the bearer must hold the exact ' +
    'admin:audit:write scope — a browser holds neither, and a console that offered it would be ' +
    'offering a forgery endpoint for the record disputes are settled against.',
})

/* ══════════════════════════════ reads ══════════════════════════════ */

type Signal = { signal?: AbortSignal }

function withSignal(opts: Signal): RequestOptions {
  return opts.signal ? { signal: opts.signal } : {}
}

/**
 * The estate view: six tiles, one call, always 200.
 *
 * `GET /v1/estate` — **admin-api/src/server.ts:879**.
 *
 * It answers 200 even when an upstream is dead (server.ts:895-897), because the console is read
 * DURING an incident, which is precisely when something is down. A dead upstream marks ONE tile;
 * `estate.ts` composes with `Promise.allSettled` so one rejection cannot discard five answers
 * that had already arrived. This function therefore never treats a degraded tile as a failure.
 */
export function loadEstate(opts: Signal = {}): Promise<EstateView> {
  return api<EstateView>('/v1/estate', withSignal(opts))
}

/**
 * The action catalogue AND the closed reason-code list, in one call.
 *
 * `GET /v1/actions` — **admin-api/src/server.ts:609**.
 *
 * The response includes the BLOCKED entry and its reason (server.ts:612-620: "an operator console
 * renders the 501 before the operator hits it, and the reason is the same string the 501
 * carries"). See `catalogue.ts` for what this console does with that.
 */
export function loadActions(opts: Signal = {}): Promise<ActionCatalogue> {
  return api<ActionCatalogue>('/v1/actions', withSignal(opts))
}

export interface ApprovalQuery {
  readonly state?: ApprovalState
  readonly action?: string
  /** `user:<uuid>`. A filter on the REQUESTER; there is no filter that acts as one. */
  readonly requestedBy?: string
  readonly limit?: number
}

/**
 * The approval queue.
 *
 * `GET /v1/approvals` — **admin-api/src/server.ts:623**. Query parameters read at
 * server.ts:627-632: `state`, `action`, `requestedBy`, `limit`. `state` is validated against the
 * four-value list at server.ts:1055 and anything else is a 400, so this client sends only a
 * declared `ApprovalState`.
 */
export function loadApprovals(query: ApprovalQuery = {}, opts: Signal = {}): Promise<{ approvals: readonly Approval[] }> {
  return api<{ approvals: readonly Approval[] }>('/v1/approvals', {
    ...withSignal(opts),
    query: {
      ...(query.state ? { state: query.state } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.requestedBy ? { requestedBy: query.requestedBy } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    },
  })
}

/**
 * One approval request.
 *
 * `GET /v1/approvals/:id` — **admin-api/src/server.ts:637**. The id is checked against a uuid
 * pattern in the service (`itemIdOf`, server.ts:1086) so a malformed id is a 404 rather than the
 * 500 Postgres error 22P02 would otherwise become.
 */
export function loadApproval(id: string, opts: Signal = {}): Promise<{ approval: Approval }> {
  return api<{ approval: Approval }>(`/v1/approvals/${encodeURIComponent(id)}`, withSignal(opts))
}

export interface AuditQuery {
  readonly actor?: string
  readonly action?: string
  readonly subjectKind?: string
  readonly subjectId?: string
  readonly correlationId?: string
  readonly source?: string
  /** A seq to read backwards from, exclusive. `AuditPage.nextCursor` is the value to pass. */
  readonly before?: string
  readonly limit?: number
}

/**
 * The audit log, newest first.
 *
 * `GET /v1/audit` — **admin-api/src/server.ts:557**. Every filter is read at server.ts:563-570
 * and each is an equality match on an indexed column: `actor`, `action`, `subjectKind`,
 * `subjectId`, `correlationId`, `source`, plus `before` and `limit`. There is deliberately NO
 * free-text search (`audit.ts` on `readAudit`: a console offering a LIKE over `payload` is a
 * console that table-scans the estate's audit of record during an incident), so this console
 * offers none either.
 *
 * `correlationId` is the workflow 13 §16 names — "one search box accepts a `cf.request_id` … and
 * fans out" — and it is the reason the search box on the audit page is one field and not six.
 */
export function loadAudit(query: AuditQuery = {}, opts: Signal = {}): Promise<AuditPage> {
  return api<AuditPage>('/v1/audit', {
    ...withSignal(opts),
    query: {
      ...(query.actor ? { actor: query.actor } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.subjectKind ? { subjectKind: query.subjectKind } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.before ? { before: query.before } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    },
  })
}

/**
 * Verify the hash chain.
 *
 * `GET /v1/audit/verify` — **admin-api/src/server.ts:579**.
 *
 * **`from=0` re-walks the whole chain rather than resuming from the last checkpoint** — that is
 * the thing an operator investigating a suspected tamper needs, and the reason it is a parameter
 * rather than the default is cost (server.ts:582-584). This console offers both, labelled by what
 * they mean rather than by the parameter they set.
 *
 * The route answers **200 either way** (server.ts:591-592): the caller asked whether the chain
 * verifies and this is the answer, and a 500 would deny a monitoring system the fact it exists to
 * read. So `ok: false` is a successful request reporting a failed chain, and this client must
 * never render it as a failed request.
 */
export function verifyChain(
  query: { from?: string; limit?: number } = {},
  opts: Signal = {},
): Promise<ChainVerification> {
  return api<ChainVerification>('/v1/audit/verify', {
    ...withSignal(opts),
    query: {
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    },
  })
}

/** `GET /v1/flags` — **admin-api/src/server.ts:774**. */
export function loadFlags(opts: Signal = {}): Promise<{ flags: readonly FeatureFlag[] }> {
  return api<{ flags: readonly FeatureFlag[] }>('/v1/flags', withSignal(opts))
}

/**
 * `GET /v1/broadcasts` — **admin-api/src/server.ts:811**.
 *
 * `live=true` (read at server.ts:814) narrows to those started, not ended and not retracted at
 * the service's own clock — which is the right clock, because the browser's may be wrong.
 */
export function loadBroadcasts(
  query: { live?: boolean; limit?: number } = {},
  opts: Signal = {},
): Promise<{ broadcasts: readonly Broadcast[] }> {
  return api<{ broadcasts: readonly Broadcast[] }>('/v1/broadcasts', {
    ...withSignal(opts),
    query: {
      ...(query.live ? { live: 'true' } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    },
  })
}

/* ══════════════════════════════ writes ══════════════════════════════ */

/**
 * Raise an approval request.
 *
 * `POST /v1/approvals` — **admin-api/src/server.ts:645**.
 *
 * Required by the service, in the order it checks them:
 *   * `action` must be in the catalogue (server.ts:651-655) — anything else is a 400 naming the
 *     legal set.
 *   * **an action whose `route` is null is refused with 501** (server.ts:660-662), which is the
 *     §3.3g decision. This console does not reach that branch: `catalogue.ts` renders such an
 *     action as unavailable and offers no control that would send this request. The 501 is still
 *     handled, because a catalogue fetched a minute ago is a claim about the past.
 *   * `subjectId`, `reasonCode` and `reason` are required non-empty strings (server.ts:664, 689,
 *     690, via `requireString` at server.ts:1092).
 *   * every name in the action's `requiredParams` must be a string or a boolean
 *     (server.ts:669-673).
 *   * an `Idempotency-Key` header of 8 to 200 characters, or 400 (server.ts:988-998).
 *
 * The idempotency key is passed IN rather than minted here, for the reason `mutation.ts` sets
 * out: a key generated inside a click handler makes every retry a fresh operation, which is the
 * failure the header exists to prevent implemented by the client meant to prevent it.
 */
export interface ApprovalRequestInput {
  readonly action: string
  readonly subjectId: string
  readonly reasonCode: string
  readonly reason: string
  /**
   * ── WHY A LIST IS ALLOWED HERE, WHEN THE SERVICE CHECKS FOR `string | boolean` ───────────────
   *
   * That check is on `spec.requiredParams` ONLY (server.ts:925-929): a required parameter must be a
   * string or a boolean, and everything else in `params` is stored as the JSON it is.
   * `estate.restore` requires `confirmation` — a string — and its executor reads an OPTIONAL
   * `targets` array (`admin-api/src/approvals.ts`, `Array.isArray(rawTargets)`), where an absent
   * value means the whole set. A `Record<string, string | boolean>` could not express that, and the
   * alternative — a comma-joined string the executor would never split — would send a request that
   * typechecks and restores nothing.
   */
  readonly params: Record<string, string | boolean | readonly string[]>
}

export function requestApproval(
  input: ApprovalRequestInput,
  idempotencyKey: string,
  opts: Signal = {},
): Promise<{ approval: Approval }> {
  return api<{ approval: Approval }>('/v1/approvals', {
    ...withSignal(opts),
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: {
      action: input.action,
      subjectId: input.subjectId,
      reasonCode: input.reasonCode,
      reason: input.reason,
      params: input.params,
    },
  })
}

/**
 * Approve or reject a request — and, on an approval, run it.
 *
 * `POST /v1/approvals/:id/decision` — **admin-api/src/server.ts:709**.
 *
 * `grant` must be a boolean or the service answers 400 (server.ts:715). `note` is optional and
 * read at server.ts:731. An `Idempotency-Key` is required (server.ts:718).
 *
 * ── What comes back, and why `execution` is on the response at all ────────────────────────────
 *
 * A grant DECIDES and then EXECUTES, in two transactions, deliberately (server.ts:753-767): an
 * HTTP request is not transactional, and holding a database transaction open across one is how a
 * slow peer exhausts a connection pool. So a failed execution leaves an APPROVED, UNEXECUTED row
 * — the honest state, and the one an operator can act on — and the route answers 502 or 503
 * rather than 201. This console renders that as "authorised, and the run failed", never as
 * "nothing happened": the second reading is what makes a third operator authorise it again.
 *
 * A rejection, and a replay of a decision already made, answer with `execution: null`
 * (server.ts:749-751).
 *
 * ── The four-eyes refusal has its own code ────────────────────────────────────────────────────
 *
 * `self_approval_refused` with status 403 (server.ts:356-361), separate from a generic forbidden,
 * so a console can say "you raised this one" rather than "forbidden". `gate.ts` uses it.
 */
export interface DecisionResult {
  readonly approval: Approval
  readonly execution: Record<string, unknown> | null
}

export function decideApproval(
  id: string,
  decision: { grant: boolean; note?: string },
  idempotencyKey: string,
  opts: Signal = {},
): Promise<DecisionResult> {
  return api<DecisionResult>(`/v1/approvals/${encodeURIComponent(id)}/decision`, {
    ...withSignal(opts),
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: {
      grant: decision.grant,
      ...(decision.note !== undefined && decision.note.length > 0 ? { note: decision.note } : {}),
    },
  })
}

/**
 * Create or change a feature flag.
 *
 * `PUT /v1/flags/:key` — **admin-api/src/server.ts:780**. `enabled` must be a boolean
 * (server.ts:785); `description` and `owner` are required non-empty strings (server.ts:793-794).
 *
 * **No `Idempotency-Key`, deliberately.** This route is exempt in
 * `admin-api/src/routeidempotency.test.ts:35-37` with the reason recorded there: it is an upsert
 * keyed on the flag key, a retry writes the same row, and the audit records the value BEFORE and
 * AFTER — so a replayed no-op is visible as one rather than as a second change. Sending a key
 * would be harmless and would also be a claim about the route that is not true.
 *
 * `changed` in the response says whether the value actually moved (server.ts:806).
 */
export function setFlag(
  key: string,
  input: { enabled: boolean; description: string; owner: string },
  opts: Signal = {},
): Promise<{ flag: FeatureFlag; changed: boolean }> {
  return api<{ flag: FeatureFlag; changed: boolean }>(`/v1/flags/${encodeURIComponent(key)}`, {
    ...withSignal(opts),
    method: 'PUT',
    body: { enabled: input.enabled, description: input.description, owner: input.owner },
  })
}

/**
 * Publish a broadcast.
 *
 * `POST /v1/broadcasts` — **admin-api/src/server.ts:827**. `severity`, `title` and `body` are
 * required non-empty strings (server.ts:842-844); `startsAt` and `endsAt` are optional ISO 8601
 * timestamps and a malformed one is a 400 (server.ts:845-846, via `parseDate` at server.ts:1072).
 * An `Idempotency-Key` is required (server.ts:832) — a retry must not publish a second notice.
 */
export interface BroadcastInput {
  readonly severity: Severity
  readonly title: string
  readonly body: string
  readonly startsAt?: string
  readonly endsAt?: string
}

export function publishBroadcast(
  input: BroadcastInput,
  idempotencyKey: string,
  opts: Signal = {},
): Promise<{ broadcast: Broadcast }> {
  return api<{ broadcast: Broadcast }>('/v1/broadcasts', {
    ...withSignal(opts),
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: {
      severity: input.severity,
      title: input.title,
      body: input.body,
      ...(input.startsAt ? { startsAt: input.startsAt } : {}),
      ...(input.endsAt ? { endsAt: input.endsAt } : {}),
    },
  })
}

/**
 * Retract a broadcast.
 *
 * `DELETE /v1/broadcasts/:id` — **admin-api/src/server.ts:864**.
 *
 * **No `Idempotency-Key`, deliberately**, and for a different reason from the flag route: this is
 * a state transition claimed with `where retracted_at is null`, so a second attempt matches no
 * row and is refused rather than audited twice
 * (`admin-api/src/routeidempotency.test.ts:37-38`).
 */
export function retractBroadcast(id: string, opts: Signal = {}): Promise<{ broadcast: Broadcast }> {
  return api<{ broadcast: Broadcast }>(`/v1/broadcasts/${encodeURIComponent(id)}`, {
    ...withSignal(opts),
    method: 'DELETE',
  })
}

/* ══════════════════════════ the engagement treasury — docs/ecosystem/21 ══════════════════════ */

/** `admin-api/src/engagement.ts` — amounts are DECIMAL STRINGS on the wire, never JSON numbers. */
export interface EngagementPolicy {
  readonly service: string
  readonly transferCapShards: string
  readonly seedPerMarketWei: string | null
  readonly seedPerDayWei: string | null
  readonly lastChangeApprovalId: string | null
  readonly updatedAt: string
  readonly updatedBy: string
}

export interface FeeRecyclePolicy {
  readonly recycleBps: number
  readonly lastChangeApprovalId: string | null
  readonly updatedAt: string | null
  readonly updatedBy: string | null
}

/** The schema ceilings, served so this console renders the bounds rather than inventing them. */
export interface EngagementCeilings {
  readonly transferCapShards: string
  readonly seedPerMarketWei: string
  readonly seedPerDayWei: string
  readonly feeRecycleBps: number
}

export interface EngagementPolicies {
  readonly policies: readonly EngagementPolicy[]
  readonly feeRecycle: FeeRecyclePolicy
  readonly ceilings: EngagementCeilings
}

export interface AccountBalance {
  readonly subject: string
  readonly assetCode: string
  readonly purpose: string
  readonly type: string
  readonly status: string
  readonly amount: string
}

export interface EngagementTransfer {
  readonly id: string
  readonly service: string
  readonly amountShards: string
  readonly approvalId: string
  readonly ledgerEntryId: string | null
  readonly state: 'posting' | 'posted'
  readonly createdAt: string
  readonly postedAt: string | null
}

export interface EngagementReport {
  readonly treasury: { readonly subject: string; readonly balances: readonly AccountBalance[] }
  readonly services: ReadonlyArray<{
    readonly service: string
    readonly subject: string
    readonly balances: readonly AccountBalance[]
  }>
  readonly spendShardsByService: Readonly<Record<string, string>>
  readonly transfers: readonly EngagementTransfer[]
  readonly policies: readonly EngagementPolicy[]
  readonly feeRecycle: FeeRecyclePolicy
}

/**
 * The caps and the ceilings. `GET /v1/engagement/policies` — **admin-api/src/server.ts:956**.
 * `requireReader` (server.ts:481), so an operator's own token is enough.
 */
export function loadEngagementPolicies(opts: Signal = {}): Promise<EngagementPolicies> {
  return api<EngagementPolicies>('/v1/engagement/policies', withSignal(opts))
}

/**
 * Balances and spend, read off the ledger. `GET /v1/engagement/report` —
 * **admin-api/src/server.ts:1046**. This is 21 §6's third action, whose approval column reads
 * "none (read)": the approval queue REFUSES `engagement.report` and names this route, so the
 * console calls it directly rather than spending two operators' signatures on a read.
 */
export function loadEngagementReport(opts: Signal = {}): Promise<EngagementReport> {
  return api<EngagementReport>('/v1/engagement/report', withSignal(opts))
}

/**
 * **LOWER** a cap. `PUT /v1/engagement/policies/:service` — **admin-api/src/server.ts:984**.
 *
 * One operator, deliberately, and only downwards: `micro-devplatform`'s quota asymmetry
 * (`devplatform/src/server.ts:981`, "the direction is the authority"). Lowering narrows the blast
 * radius and is the operator doing the platform's work for it; RAISING is the abuse, and this
 * route answers **403 `raise_needs_approval`** for one — the caller must go through
 * `engagement.policy.set` in the approval queue instead, which needs two operators. The
 * `engagement_raise_needs_approval` trigger says the same thing in the schema, so a raise cannot
 * arrive by any other door either.
 *
 * `:service` may be `platform`, which addresses the fee-recycle percentage rather than a
 * per-service cap.
 */
export interface PolicyLowerInput {
  readonly transferCapShards?: string
  readonly seedPerMarketWei?: string | null
  readonly seedPerDayWei?: string | null
  readonly recycleBps?: string
}

export function lowerEngagementPolicy(
  service: string,
  input: PolicyLowerInput,
  opts: Signal = {},
): Promise<{ policy?: EngagementPolicy; feeRecycle?: FeeRecyclePolicy }> {
  return api<{ policy?: EngagementPolicy; feeRecycle?: FeeRecyclePolicy }>(
    `/v1/engagement/policies/${encodeURIComponent(service)}`,
    { ...withSignal(opts), method: 'PUT', body: { ...input } },
  )
}

/* ══════════════════════════ backup and restore ══════════════════════════ */

/**
 * The backup runs, the settings they were taken under, and what the destination protects against.
 *
 * `GET /v1/backups?limit=` — **admin-api/src/server.ts:1332**.
 *
 * Three things in one response rather than three calls, and the console leans on that: an operator
 * reading a list of green rows and a list of what those rows do NOT protect against must be
 * reading one observation, not two taken a second apart.
 */
export function loadBackups(
  query: { limit?: number } = {},
  opts: Signal = {},
): Promise<BackupsPage> {
  return api<BackupsPage>('/v1/backups', {
    ...withSignal(opts),
    query: { ...(query.limit !== undefined ? { limit: query.limit } : {}) },
  })
}

/**
 * One backup run, its files, and every restore ever attempted from it.
 *
 * `GET /v1/backups/:id` — **admin-api/src/server.ts:1445**.
 *
 * The `restores` half is what makes `verifiedAt` legible rather than magic: an operator can see
 * which run proved this backup, in which mode, and whether its checksums matched.
 */
export function loadBackup(id: string, opts: Signal = {}): Promise<BackupDetail> {
  return api<BackupDetail>(`/v1/backups/${encodeURIComponent(id)}`, withSignal(opts))
}

/**
 * Take a backup now.
 *
 * `POST /v1/backups` — **admin-api/src/server.ts:1473**. An `Idempotency-Key` is required
 * (server.ts:1479).
 *
 * The body was the one thing the agreed contract did not specify, and the two fields sent here —
 * read off `BackupRun`'s own declared fields at the time — are the two the service reads:
 * `kind` (server.ts:1479, optional and defaulting to `full`) and `reason` (server.ts:1490). The
 * kind is offered as a choice rather than defaulted, because the type has four values and an
 * operator taking a backup before a migration means a different one from an operator rehearsing.
 *
 * Nothing else is sent. `requestedBy` in particular is NOT a field: `admin-api` derives the actor
 * from the verified bearer on every mutating route, and a client that supplied it would be
 * offering an act-as-anyone primitive on the one screen that can overwrite the money data.
 */
export function startBackup(
  input: { kind: BackupKind; reason: string },
  idempotencyKey: string,
  opts: Signal = {},
): Promise<{ backup: BackupRun }> {
  return api<{ backup: BackupRun }>('/v1/backups', {
    ...withSignal(opts),
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: { kind: input.kind, reason: input.reason },
  })
}

/**
 * The settings, and the bounds the service enforces on them.
 *
 * `GET /v1/backups/settings` — **admin-api/src/server.ts:1359**.
 *
 * Called separately from `loadBackups` even though that route also returns `settings`, because the
 * CEILINGS are only here — and a settings form that showed the values without the bounds would let
 * an operator type a number the service will refuse and learn about it afterwards.
 */
export function loadBackupSettings(
  opts: Signal = {},
): Promise<{ settings: BackupSettings; ceilings: BackupCeilings; protection: Protection }> {
  return api<{ settings: BackupSettings; ceilings: BackupCeilings; protection: Protection }>(
    '/v1/backups/settings',
    withSignal(opts),
  )
}

/**
 * Change the settings.
 *
 * `PUT /v1/backups/settings` — **admin-api/src/server.ts:1387**.
 *
 * **No `Idempotency-Key`, and the service agrees**: it wraps neither this route nor the reads,
 * only the two POSTs. That matches the shape of the route — a partial update of a single settings
 * row, where a retry writes the same values and the audit records `admin.backup.settings.changed`
 * either way (server.ts:1427) — and it matches how this console already treats
 * `PUT /v1/flags/:key`.
 *
 * ── Only the four fields the form edits are sent, and the route is happy with that ────────────
 *
 * `admin-api` builds its change set from whichever fields are PRESENT (server.ts:1393-1414) and
 * answers 400 only when none is. So omitting `ceilingBytes`, `minFreeBytes` and the verification
 * schedule leaves them untouched rather than clearing them — which is what makes it safe not to
 * echo them back. Echoing them WOULD be unsafe: a form opened before a bound was tightened would
 * overwrite the tightening, which is the lost update, on the settings that decide whether there is
 * a backup at all.
 */
export interface BackupSettingsInput {
  readonly rootPath: string
  readonly retentionCopies: number
  readonly scheduleEnabled: boolean
  readonly scheduleEveryMinutes: number
}

export function saveBackupSettings(
  input: BackupSettingsInput,
  opts: Signal = {},
): Promise<{ settings: BackupSettings }> {
  return api<{ settings: BackupSettings }>('/v1/backups/settings', {
    ...withSignal(opts),
    method: 'PUT',
    body: {
      rootPath: input.rootPath,
      retentionCopies: input.retentionCopies,
      scheduleEnabled: input.scheduleEnabled,
      scheduleEveryMinutes: input.scheduleEveryMinutes,
    },
  })
}

/** Every restore ever attempted, newest first. `GET /v1/restores` — **server.ts:1520**. */
export function loadRestores(
  query: { limit?: number } = {},
  opts: Signal = {},
): Promise<{ restores: readonly RestoreRun[] }> {
  return api<{ restores: readonly RestoreRun[] }>('/v1/restores', {
    ...withSignal(opts),
    query: { ...(query.limit !== undefined ? { limit: query.limit } : {}) },
  })
}

/**
 * Restore into a throwaway scratch database, prove the artefacts read back, and drop it.
 *
 * `POST /v1/restores` — **admin-api/src/server.ts:1546**. An `Idempotency-Key` is required
 * (server.ts:1568).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THERE IS NO `startLiveRestore`, AND THE ABSENCE IS THE SHAPE OF THE SERVICE.**
 *
 * The contract these screens were first written to had one route and two modes. The service that
 * landed **refuses `mode: "live"` at this route outright** (server.ts:1552-1558), answering 400
 * with the route to use instead — exactly as a read action is refused by `POST /v1/approvals` with
 * the GET to call. The only door to a live restore is the approval queue: `estate.restore`, two
 * operators, and `approvals.ts`'s executor creates the restore row itself with the approval id on
 * it.
 *
 * So this function fixes `mode` to `verify` rather than taking it as a parameter. A signature that
 * accepted `'verify' | 'live'` would offer a call that is a 400 on one of its two values, and a
 * console built on it would walk an operator through a confirmation ritual to reach an error
 * message. `requestApproval` above is what the live path calls.
 *
 * ── Why the asymmetry is load-bearing rather than lenient ─────────────────────────────────────
 *
 * The service's own comment (server.ts:1533-1545): a verify touches nothing live, "so it needs one
 * operator and no ceremony — and that asymmetry is load-bearing rather than lenient … if the only
 * available restore were the terrifying one, no restore would ever be rehearsed and every backup
 * would stay a wish." This console follows it: the safe restore is one explained click.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface VerifyRestoreInput {
  readonly backupRunId: string
  /** Artefact names. An empty list is the service's "everything" (server.ts:1564). */
  readonly targets: readonly string[]
  readonly reason: string
}

export function startVerifyRestore(
  input: VerifyRestoreInput,
  idempotencyKey: string,
  opts: Signal = {},
): Promise<{ restore: RestoreRun }> {
  return api<{ restore: RestoreRun }>('/v1/restores', {
    ...withSignal(opts),
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: {
      backupRunId: input.backupRunId,
      // A literal, not a parameter. See the block above.
      mode: 'verify',
      // Copied: the caller holds this in React state, and serialising the live array is the shape
      // of a bug the day anything mutates it between the call and the send.
      targets: [...input.targets],
      reason: input.reason,
    },
  })
}

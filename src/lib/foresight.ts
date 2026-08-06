/**
 * `micro-foresight`, as this bundle actually calls it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY PATH BELOW WAS READ OFF `foresight/src/server.ts`. NOT OFF A SPECIFICATION.
 *
 * This estate has paid for the alternative twice, and both times the client typechecked perfectly
 * while calling a route that does not exist:
 *
 *   * `wallet/src/pricingclient.ts` calls `GET /v1/quotes`. Pricing serves `GET /rates`.
 *   * `market` called `POST /v1/decisions/market.listing`. Policy has no `/v1` routes at all —
 *     and because a 404 from policy is `peerDecided`, every listing came back 403. The
 *     marketplace was closed, by a string.
 *
 * So each function carries the `foresight/src/server.ts` line its method, path and response shape
 * were verified against, and `test/foresight.test.ts` asserts the METHOD, the PATH, the QUERY and
 * the BODY of every one of them against a fetch stub. Asserting the response only — which is what
 * the tests behind both defects above did — cannot catch a wrong path, because a stub answers
 * whatever it is told to whatever it is asked.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── What foresight does NOT serve ─────────────────────────────────────────────────────────────
 *
 * Written down because an operator panel is exactly the client that would invent them:
 *
 *   * **There is no `POST /markets/:id/close`.** A market closes when its close time passes: the
 *     CONTRACT stops taking stakes by itself (`ForesightMarket.stake` reverts on
 *     `block.timestamp >= closeTime`), and the `market.close` leased job writes the registry row
 *     to match (`marketCloseHandler`, foresight/src/jobs.ts, calling `closeMarket` at
 *     markets.ts). Close is
 *     bookkeeping that follows the chain; there is no operator button for it and this file does
 *     not pretend otherwise. See `lifecycle.ts`.
 *   * **There are no dispute routes.** The dispute window is a market FIELD
 *     (`disputeWindowSeconds`, publicView at markets.ts) enforced by the contract, which
 *     refuses `claim` until `resolvedAt + disputeWindowSeconds`. A contest inside that window is
 *     handled by `resolved → void`, which is a transition the state table permits for exactly
 *     this reason (markets.ts). What this panel can do about a dispute is show the window,
 *     the named source and the posted outcome, and offer the void path.
 *   * **There is no `GET /ideas/:id`.** Only the list. So the queue page loads `GET /ideas` and
 *     finds the row; there is no deep link to one proposal.
 *   * **There is no `/v1` prefix.** Not on one route.
 *
 * ── Types are mirrors ─────────────────────────────────────────────────────────────────────────
 *
 * Each interface mirrors a shape in foresight and names the file and lines it mirrors. Dates
 * arrive as ISO strings because `JSON.stringify` renders a `Date` that way; the fields are typed
 * `string` here for that reason and never `Date`.
 *
 * ── The transport is `foresight`, never `api` ─────────────────────────────────────────────────
 *
 * `api()` is bound to `admin-api`, which in production is THIS ORIGIN — every one of its requests
 * is relative. Foresight is a different service on a different host and stays one after the fold
 * (see `FORESIGHT_SURFACE` in lib/hosts.ts). Calling `api('/markets')` here would therefore ask
 * `admin.<apex>/markets`, which no router matches: the gateway's `cf-api-admin` only claims
 * `/v1` on this host (`deploy/gateway/dynamic/estate-web.yml`), so the request would fall to
 * `cf-web-admin` and be answered by this console's own index.html — a 200 carrying HTML where
 * JSON was expected, which is the failure shape this estate has been bitten by repeatedly.
 *
 * `test/foresight.test.ts` asserts the ORIGIN of every call for that reason, not only the path.
 */
import { foresight, type RequestOptions } from './api.ts'

/* ══════════════════════════════ the idea queue ══════════════════════════════ */

/** One thing the search step found, kept as it was found. Mirrors `IdeaSource`, ideas.ts. */
export interface IdeaSource {
  readonly url: string
  readonly title: string
  /** When the pipeline retrieved it. A source that has since changed is still evidence. */
  readonly retrievedAt: string
}

export type IdeaStatus = 'proposed' | 'approved' | 'discarded'
export type IdeaOrigin = 'model' | 'operator'

/**
 * A proposal. Mirrors `Idea`, foresight/src/ideas.ts.
 *
 * The five provenance fields — `searchQuery`, `sources`, `modelId`, `promptSha256`, `proposedAt`
 * — are the reason this screen exists. `ideas_model_has_provenance` means a model-origin row
 * cannot be stored without them (ideas.ts), so a model proposal that arrives here with none is
 * a signal worth refusing on rather than a shape to render defensively around.
 */
export interface Idea {
  readonly id: string
  readonly status: IdeaStatus
  readonly question: string
  readonly resolutionCriteria: string
  readonly category: string
  readonly categoryVersion: number
  readonly resolutionSourceKind: string
  readonly resolutionSourceRef: string
  /** ISO-8601. */
  readonly suggestedCloseTime: string
  readonly origin: IdeaOrigin
  readonly searchQuery: string | null
  readonly sources: readonly IdeaSource[]
  readonly modelId: string | null
  readonly promptSha256: string | null
  readonly proposedAt: string
  readonly decidedBy: string | null
  readonly decidedAt: string | null
  readonly decisionNote: string | null
  readonly refusalId: string | null
}

/**
 * The queue.
 *
 * `GET /ideas` — server.ts. Admin only (`requireAdmin`, line 649). `status` defaults to
 * `proposed` SERVER-side and must be one of proposed|approved|discarded or the route answers 400
 * (lines 650-653). `limit` is 1..200, default 50 (parseLimit, server.ts).
 */
export function loadIdeas(
  status: IdeaStatus,
  limit?: number,
  opts?: RequestOptions,
): Promise<{ ideas: readonly Idea[] }> {
  return foresight<{ ideas: readonly Idea[] }>('/ideas', {
    ...opts,
    query: { status, ...(limit === undefined ? {} : { limit }) },
  })
}

/** The editable half of a proposal. Every field is REQUIRED by both write routes. */
export interface IdeaDraft {
  readonly question: string
  readonly resolutionCriteria: string
  readonly category: string
  readonly resolutionSourceKind: string
  readonly resolutionSourceRef: string
  /** ISO-8601. Must be in the future, or ideas.ts answers `bad_close_time`. */
  readonly suggestedCloseTime: string
}

/**
 * An operator writes a question themselves.
 *
 * `POST /ideas` — server.ts, **201**. `categoryVersion` and `origin: 'operator'` are set
 * by the SERVER (lines 669, 673) and must not be sent: the version a proposal was judged under is
 * not a client's to state.
 */
export function createIdea(draft: IdeaDraft, opts?: RequestOptions): Promise<{ idea: Idea }> {
  return foresight<{ idea: Idea }>('/ideas', { ...opts, method: 'POST', body: { ...draft } })
}

/**
 * Edit a proposal before approving it. `PATCH /ideas/:id` — server.ts.
 *
 * Named PATCH but every field is required (`requireString`/`requireDate` on all six, lines 689-695), so this
 * sends the whole draft rather than a delta. A partial body answers 400.
 */
export function editIdea(
  id: string,
  draft: IdeaDraft,
  opts?: RequestOptions,
): Promise<{ idea: Idea }> {
  return foresight<{ idea: Idea }>(`/ideas/${id}`, { ...opts, method: 'PATCH', body: { ...draft } })
}

/**
 * A person approves. `POST /ideas/:id/approve` — server.ts.
 *
 * The approval is recorded under `operator:<userId>`, and `operatorOf` (server.ts) throws
 * `ForbiddenError` for a SERVICE principal even one holding the admin role. That is the transport
 * half of "the AI proposes; a person opens": no machine token can produce this subject.
 */
export function approveIdea(
  id: string,
  note: string | null,
  opts?: RequestOptions,
): Promise<{ idea: Idea }> {
  return foresight<{ idea: Idea }>(`/ideas/${id}/approve`, {
    ...opts,
    method: 'POST',
    // `optionalString` (server.ts) treats a blank string as absent, so an empty note is
    // omitted rather than sent as ''. Sending it would be indistinguishable server-side anyway;
    // omitting it keeps the request honest about what the operator actually wrote.
    body: note && note.trim() ? { note: note.trim() } : {},
  })
}

/**
 * Discard, against one of the three named refusals.
 *
 * `POST /ideas/:id/discard` — server.ts. `refusalId` is REQUIRED (`requireString`, line
 * 722) and must be one of the ids in `GET /categories` — free text is deliberately not accepted,
 * so that a reason can be counted rather than read (categories.ts).
 */
export function discardIdea(
  id: string,
  refusalId: string,
  note: string | null,
  opts?: RequestOptions,
): Promise<{ idea: Idea }> {
  return foresight<{ idea: Idea }>(`/ideas/${id}/discard`, {
    ...opts,
    method: 'POST',
    body: { refusalId, ...(note && note.trim() ? { note: note.trim() } : {}) },
  })
}

/* ══════════════════════════════ the allowlist ══════════════════════════════ */

/** Mirrors `CategorySpec`, foresight/src/categories.ts. */
export interface CategorySpec {
  readonly id: string
  readonly title: string
  readonly description: string
  /** `resolution_source_kind` must be one of these, and the service checks it. */
  readonly sourceKinds: readonly string[]
}

export interface Refusal {
  readonly id: string
  readonly reason: string
}

export interface CategoryBoard {
  readonly version: number
  readonly categories: readonly CategorySpec[]
  readonly refusals: readonly Refusal[]
}

/**
 * What this platform will and will not run a market on.
 *
 * `GET /categories` — server.ts. **Public and unauthenticated**, deliberately: "a refusal
 * list behind a token is a refusal list nobody can hold the platform to" (server.ts). It is
 * still fetched with the bearer token here, because sending one costs nothing and the operator
 * always has one.
 */
export function loadCategories(opts?: RequestOptions): Promise<CategoryBoard> {
  return foresight<CategoryBoard>('/categories', { ...opts })
}

/* ══════════════════════════════ markets ══════════════════════════════ */

export type MarketStatus =
  | 'draft'
  | 'approved'
  | 'open'
  | 'closed'
  | 'resolved'
  | 'settled'
  | 'void'

/**
 * A market, as it leaves the service.
 *
 * Mirrors `publicView`, foresight/src/markets.ts — and `publicView` is what BOTH the
 * public route and every operator route return. It is deliberately narrow: no lease owner, no raw
 * transaction, no custody audit id, no operator subject.
 *
 * ** It also carries no `deployState`.** So this panel cannot show how a deploy is progressing;
 * `contractAddress` turning non-null is the only visible evidence that it finished. Noted here
 * because the absence is easy to mistake for a field this client forgot to read.
 */
export interface Market {
  readonly id: string
  readonly status: MarketStatus
  readonly question: string
  readonly resolutionCriteria: string
  readonly category: string
  readonly categoryVersion: number
  readonly resolutionSourceKind: string
  readonly resolutionSourceRef: string
  readonly questionHash: string
  readonly closeTime: string
  readonly disputeWindowSeconds: number
  readonly feeBps: number
  readonly chain: string
  readonly network: string
  readonly contractAddress: string | null
  /** 0 is YES and 1 is NO. See `OUTCOME_YES` in lifecycle.ts. Null until resolved. */
  readonly outcome: number | null
  readonly voidReason: string | null
  readonly openedAt: string | null
  readonly closedAt: string | null
  readonly resolvedAt: string | null
  readonly settledAt: string | null
  readonly voidedAt: string | null
}

/**
 * The mirrored pool. Mirrors `PoolView` as built by `poolOf`, foresight/src/mirror.ts.
 *
 * Amounts are decimal STRINGS of wei and stay strings all the way to the DOM — one EMBER is 1e18
 * and a double loses the bottom of that. `yesBps`/`noBps` are exact integers the service computed
 * in bigint before narrowing (mirror.ts), which is why the chart is drawn from THOSE and
 * never from a ratio this bundle divides out.
 *
 * `asOf` is null when the mirror has never run, and `stale` is true both then and when it is
 * further behind the tip than the chain's confirmation depth (mirror.ts). The two are
 * different sentences and the UI says which.
 */
export interface Pool {
  readonly yes: string
  readonly no: string
  readonly total: string
  readonly yesBps: number | null
  readonly noBps: number | null
  readonly stakerCount: number
  /** When the mirror last synced. NULL means never — not "now". */
  readonly asOf: string | null
  readonly lastBlock: number | null
  readonly tipBlock: number | null
  readonly behindBlocks: number | null
  readonly stale: boolean
}

/** The provenance carried from the idea a market was built from. server.ts. */
export interface MarketProvenance {
  readonly origin: IdeaOrigin
  readonly searchQuery: string | null
  readonly sources: readonly IdeaSource[]
  readonly modelId: string | null
  readonly promptSha256: string | null
  readonly proposedAt: string
}

/**
 * One market with everything needed to judge it. `GET /markets/:id` — server.ts.
 *
 * `document.canonical` is the exact byte string `questionHash` is computed over, so the hash can
 * be recomputed and checked against the contract rather than taken on trust (questiondoc.ts).
 * `provenance` is null for a market nobody proposed — an operator wrote it.
 */
export interface MarketDetail {
  readonly market: Market
  readonly pool: Pool
  readonly document: { readonly canonical: string; readonly hash: string }
  readonly provenance: MarketProvenance | null
}

/**
 * The market list. `GET /markets` — server.ts.
 *
 * Public and unauthenticated. `status` must be one of the seven lifecycle states or the route
 * answers 400 (`parseStatus`, server.ts); omitting it lists every status.
 */
export function loadMarkets(
  status: MarketStatus | null,
  limit?: number,
  opts?: RequestOptions,
): Promise<{ markets: readonly Market[] }> {
  return foresight<{ markets: readonly Market[] }>('/markets', {
    ...opts,
    query: {
      ...(status === null ? {} : { status }),
      ...(limit === undefined ? {} : { limit }),
    },
  })
}

/** One market. `GET /markets/:id` — server.ts. */
export function loadMarket(id: string, opts?: RequestOptions): Promise<MarketDetail> {
  return foresight<MarketDetail>(`/markets/${id}`, { ...opts })
}

/** What `POST /markets` takes. server.ts. */
export interface MarketDraft {
  /** The approved proposal this market is built from. Omitted for an operator's own question. */
  readonly ideaId?: string | undefined
  readonly question: string
  readonly resolutionCriteria: string
  readonly category: string
  readonly resolutionSourceKind: string
  readonly resolutionSourceRef: string
  /** ISO-8601, in the future. */
  readonly closeTime: string
  /** Seconds, 0..2_592_000. Omitted takes the service default (server.ts). */
  readonly disputeWindowSeconds?: number | undefined
  /** Basis points, 0..1000. Omitted takes the service default (server.ts). */
  readonly feeBps?: number | undefined
}

/**
 * Create the draft. `POST /markets` — server.ts, **201**.
 *
 * `chain` and `network` come from the service's own configuration (lines 752-753) and are not
 * this client's to send. `ideaId` must be a uuid if present (line 736).
 */
export function createMarket(
  draft: MarketDraft,
  opts?: RequestOptions,
): Promise<{ market: Market }> {
  return foresight<{ market: Market }>('/markets', { ...opts, method: 'POST', body: { ...draft } })
}

/**
 * A person approves the market. `POST /markets/:id/approve` — server.ts.
 *
 * `draft → approved`. Refused with `idea_not_approved` when the market was built from a proposal
 * nobody approved (markets.ts) — and refused again by the
 * `markets_unapproved_never_opens` constraint if that check were ever removed.
 */
export function approveMarket(id: string, opts?: RequestOptions): Promise<{ market: Market }> {
  return foresight<{ market: Market }>(`/markets/${id}/approve`, { ...opts, method: 'POST' })
}

/**
 * Deploy the contract. `POST /markets/:id/deploy` — server.ts, **202**.
 *
 * It reaches no chain: the reply is an acceptance and the work is a leased job. The
 * `Idempotency-Key` header is REQUIRED, 8 to 200 characters (`idempotencyKeyOf`,
 * server.ts), and it is what stops a retried request producing a second contract for one
 * question — "the loss from a double-apply here is not a double payment, it is two pools for one
 * question" (server.ts).
 *
 * The key is passed in by the caller rather than generated here, so that a retry after a lost
 * response can present THE SAME key. A key minted per attempt makes every retry a fresh
 * operation, which is the opposite of what the header is for — foresight says so itself at
 * server.ts, refusing to default the header for exactly that reason.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THIS IS THE ONE CALL IN THE BUNDLE THAT NEEDS A CORS PREFLIGHT TO SUCCEED.**
 *
 * `idempotency-key` is not on the browser's CORS-safelisted request-header list, so sending it
 * cross-origin makes the browser issue an `OPTIONS` preflight and refuse the real request unless
 * the gateway echoes that header name in `Access-Control-Allow-Headers`. It did not: the estate's
 * one CORS allowlist (`deploy/gateway/dynamic/policy.yml`, `cf-cors`) named `content-type`,
 * `authorization`, `x-request-id` and the three W3C trace headers, and nothing else.
 *
 * Nothing caught it, because the only other caller of this route is
 * `deploy/scripts/foresight-market-journey.mjs:372`, which runs under Node — where there is no
 * origin, no preflight and no CORS at all. The header is now allowlisted and
 * `deploy/scripts/surface-routes.py` check 8 keeps it there.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function deployMarket(
  id: string,
  idempotencyKey: string,
  opts?: RequestOptions,
): Promise<{ marketId: string; accepted: boolean; replayed: boolean }> {
  return foresight<{ marketId: string; accepted: boolean; replayed: boolean }>(
    `/markets/${id}/deploy`,
    { ...opts, method: 'POST', headers: { 'idempotency-key': idempotencyKey } },
  )
}

/**
 * Open for stakes. `POST /markets/:id/open` — server.ts.
 *
 * Refused unless `deploy_state = 'deployed'` and a contract address exists (markets.ts, `markets_open_has_contract`),
 * because "a market that says `open` with no contract address is an invitation to send money to
 * an address that does not exist".
 */
export function openMarket(id: string, opts?: RequestOptions): Promise<{ market: Market }> {
  return foresight<{ market: Market }>(`/markets/${id}/open`, { ...opts, method: 'POST' })
}

/** The resolution plan, as `POST /markets/:id/resolve` returns it. server.ts. */
export interface ResolutionAcceptance {
  readonly id: string
  readonly marketId: string
  /** 0 resolve-YES, 1 resolve-NO, 2 VOID. resolve.ts. */
  readonly action: number
  readonly rationale: string
  readonly state: string
}

/**
 * Post the outcome. `POST /markets/:id/resolve` — server.ts, **202**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS MOVES REAL MONEY AND IT IS NOT REVERSIBLE BY THIS PANEL.
 *
 * The reply is an acceptance; a leased job signs with the custody-held oracle key and broadcasts.
 * Once the chain accepts it, the pool pays the winning side after the dispute window.
 *
 * Two things the caller must understand, both of which the confirmation dialog states in words:
 *
 *   1. **`outcome: 0` is YES and `outcome: 1` is NO** — `planResolution` maps 0 to
 *      `ACTION_RESOLVE_YES` (resolve.ts, constants at resolve.ts), and the mirror sums
 *      `outcome = 0` into the `yes` pool (mirror.ts). Getting this backwards pays the
 *      wrong half of the market.
 *   2. **The service may overrule the outcome with a VOID.** `planResolution` probes the source
 *      the market NAMED AT OPEN, and if it is unreachable the action becomes `ACTION_VOID`
 *      whatever the operator asked for (resolve.ts). That is not the caller being
 *      ignored; it is the rule the market was opened under. So the returned `action` is read and
 *      shown, never assumed to be the one that was requested.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `rationale` is required and must be non-empty (resolve.ts).
 */
export function resolveMarket(
  id: string,
  outcome: 0 | 1,
  rationale: string,
  opts?: RequestOptions,
): Promise<{ resolution: ResolutionAcceptance }> {
  return foresight<{ resolution: ResolutionAcceptance }>(`/markets/${id}/resolve`, {
    ...opts,
    method: 'POST',
    // A JSON NUMBER, not a string: `requireInteger` (server.ts) refuses anything else.
    // The opposite of the amount rule on the staking route, and both are deliberate.
    body: { outcome, rationale },
  })
}

/** Mirrors `Resolution`, foresight/src/resolve.ts, minus the fields this panel refuses. */
export interface Resolution {
  readonly id: string
  readonly marketId: string
  readonly chain: string
  readonly network: string
  readonly action: number
  readonly rationale: string
  readonly state: string
  readonly txHash: string | null
  readonly broadcastAt: string | null
  readonly confirmedAt: string | null
  readonly attempts: number
  readonly lastError: string | null
}

/**
 * How the oracle post is going. `GET /markets/:id/resolution` — server.ts. Admin only.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE 500 THIS CLIENT USED TO WARN ABOUT IS FIXED, AND THE WARNING IS GONE WITH IT.**
 *
 * The version of this file inherited from `micro-foresight-admin-web` carried a long ⚠ block
 * saying the route "answers 500 once the oracle has signed": it returned the `Resolution` row
 * verbatim, `Resolution.oracleNonce` is a bigint, and `JSON.stringify` throws on one — so every
 * call an operator would actually make failed, while foresight's own tests stayed green because
 * none of them covered the route.
 *
 * That was true when it was written and is not true now. `foresight/src/resolve.ts`
 * defines `resolutionView`, which narrows the row and renders the nonce as a decimal STRING, and
 * server.ts serves that instead of the row. Its header credits the report: "Found by
 * micro-foresight-admin-web, the first client to call the route."
 *
 * Re-checked against source rather than carried across, because a stale warning is worse than no
 * warning: it tells an operator to distrust a panel that now works, and it would have survived
 * this fold unread.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The narrowing also closed an exposure, which is why the interface below still omits fields the
 * wire no longer carries: `rawTx`, `oracleAddress`, `resolverAddress` and `custodyAuditId` are the
 * signing path, `resolve.test.ts` asserts none of them reaches a browser, and this console
 * asks for none of them. `oracleNonce` IS on the wire now and is deliberately still not read here
 * — an operator needs a resolution's state, not its nonce.
 */
export function loadResolution(
  id: string,
  opts?: RequestOptions,
): Promise<{ resolution: Resolution }> {
  return foresight<{ resolution: Resolution }>(`/markets/${id}/resolution`, { ...opts })
}

/**
 * Void a market that has no contract. `POST /markets/:id/void` — server.ts.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS ROUTE IS ONLY HALF OF VOID, AND CONFUSING THE HALVES IS HOW THE DATABASE AND THE CHAIN
 * COME TO DISAGREE.
 *
 * It refuses with **409 `on_chain`** for any market that has a `contractAddress`
 * (server.ts). A DEPLOYED market is voided through the ORACLE — `resolveMarket` above,
 * whose plan becomes `ACTION_VOID` when the named source is gone. This route exists for the case
 * where there is nothing on chain to void at all: a draft, or an approved market whose contract
 * was never deployed.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `reason` is required (`requireString`, server.ts). A void refunds the pool WHOLE — no fee
 * (19-new-products.md §2.5).
 */
export function voidMarket(
  id: string,
  reason: string,
  opts?: RequestOptions,
): Promise<{ market: Market }> {
  return foresight<{ market: Market }>(`/markets/${id}/void`, {
    ...opts,
    method: 'POST',
    body: { reason },
  })
}

/**
 * Every path this bundle may request, as data.
 *
 * Exported so `test/foresight.test.ts` can assert that the set of paths actually requested during
 * the suite is exactly this set — the check that catches a route invented in a later edit, which
 * is the failure mode both estate defects were.
 */
export const FORESIGHT_ROUTES: readonly string[] = [
  'GET /categories',
  'GET /markets',
  'GET /markets/:id',
  'GET /markets/:id/resolution',
  'GET /ideas',
  'POST /ideas',
  'PATCH /ideas/:id',
  'POST /ideas/:id/approve',
  'POST /ideas/:id/discard',
  'POST /markets',
  'POST /markets/:id/approve',
  'POST /markets/:id/deploy',
  'POST /markets/:id/open',
  'POST /markets/:id/resolve',
  'POST /markets/:id/void',
]

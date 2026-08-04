/**
 * One market: where it is, what it says, who has staked, and the four things an operator can do.
 *
 * ── The order of the page is the order of the decision ────────────────────────────────────────
 *
 * The question and its resolution criteria come first, because they are what is being decided.
 * The named source comes next, because whether it still answers is what decides between resolve
 * and void. The pool comes third, with its observation time — it is who gets paid, and it is a
 * MIRROR, so it is shown with the caveat attached rather than as a fact. The actions come last,
 * and the two irreversible ones come after the two that are not.
 *
 * ── Void is reachable, and it does not look like resolve ──────────────────────────────────────
 *
 * Both are here, both are irreversible, and they are drawn as two clearly separate blocks with
 * different words, because they are opposite acts: resolve pays one side and takes a fee, void
 * refunds everybody whole and takes none. A console that renders them as two buttons in a row is
 * a console where the difference between them is four pixels.
 *
 * The `void` BUTTON only applies to a market with no contract — foresight refuses that route with
 * 409 `on_chain` otherwise (server.ts:780-787). For a deployed market the void path runs through
 * the oracle, and the resolve block says so in words rather than leaving the operator to wonder
 * why the obvious button is disabled.
 */
import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Failed, Forbidden, Loading } from '../../components/states.tsx'
import { IrreversibleAction, ReversibleAction } from '../../components/irreversible.tsx'
import { PoolPanel } from '../../components/pool.tsx'
import { ProvenanceFacts, Sources } from '../../components/provenance.tsx'
import { ForesightRecord, LifecycleRail, StatusPill, statusMeaning } from '../../components/status.tsx'
import {
  approveMarket,
  deployMarket,
  loadMarket,
  loadResolution,
  openMarket,
  resolveMarket,
  voidMarket,
  type Market,
  type MarketDetail,
  type MarketProvenance,
} from '../../lib/foresight.ts'
import { formatBps, formatDuration, formatWei, safeHref, shortId, utcStamp } from '../../lib/format.ts'
import {
  OUTCOME_NO,
  OUTCOME_YES,
  actionById,
  actionLabel,
  disputeWindow,
  marketConfirmationPhrase,
  outcomeLabel,
  type LifecycleAction,
} from '../../lib/lifecycle.ts'
import { idempotencyKeyFor } from '../../lib/gate.ts'
import { useMutation } from '../../lib/mutation.ts'
import { provenanceRows } from '../../lib/provenance.ts'
import { useResource } from '../../lib/resource.ts'
import { foresightPath } from '../../lib/routes.ts'
import { MutationError } from './queue.tsx'

export function MarketPage() {
  const { id = '' } = useParams()

  const detail = useResource(
    useCallback((signal) => loadMarket(id, { signal }), [id]),
    () => 1,
    'This market could not be loaded.',
  )

  if (detail.state === 'loading') return <Loading label="Loading the market" />
  if (detail.state === 'forbidden') return <Forbidden notice={detail.error ?? undefined} />
  if (detail.state === 'failed' && detail.error) {
    return <Failed notice={detail.error} onRetry={detail.reload} title="The market did not load" />
  }
  if (!detail.data) return <Loading label="Loading the market" />

  return <MarketView detail={detail.data} onChanged={detail.reload} />
}

function MarketView({ detail, onChanged }: { detail: MarketDetail; onChanged: () => void }) {
  const { market, pool, document, provenance } = detail
  const window_ = disputeWindow(market, new Date())

  return (
    <>
      <div className="wt-page__head">
        <div>
          <h1 className="wt-page__title">{market.question}</h1>
          <p className="wt-page__meta">
            <StatusPill status={market.status} /> {statusMeaning(market.status)}
          </p>
        </div>
        <Link className="wt-link" to={foresightPath.markets()}>
          ← All markets
        </Link>
      </div>

      <LifecycleRail status={market.status} />

      {/* ── what is being decided ────────────────────────────────────────────────────────── */}
      <section className="wt-panel">
        <div className="wt-panel__head">
          <h2 className="wt-panel__title">The question, as it was hashed</h2>
          <span className="aw-mono aw-stamp">{shortId(market.id)}</span>
        </div>
        <dl className="wt-facts">
          <dt>Resolution criteria</dt>
          <dd>{market.resolutionCriteria}</dd>
          <dt>Named source</dt>
          <dd>
            {market.resolutionSourceKind} —{' '}
            <NamedSource reference={market.resolutionSourceRef} />
          </dd>
          <dt>Category</dt>
          <dd>
            {market.category} <span className="aw-unit">allowlist v{market.categoryVersion}</span>
          </dd>
          <dt>Closes</dt>
          <dd className="cf-num">{utcStamp(market.closeTime) ?? 'not recorded'}</dd>
          <dt>Dispute window</dt>
          <dd className="cf-num">{formatDuration(market.disputeWindowSeconds) ?? 'not recorded'}</dd>
          <dt>Settlement fee</dt>
          <dd className="cf-num">
            {formatBps(market.feeBps) ?? 'not recorded'}{' '}
            <span className="aw-unit">of the winning pool; none on a void</span>
          </dd>
          <dt>Chain</dt>
          <dd>
            {market.chain} / {market.network}
          </dd>
          <dt>Contract</dt>
          <dd className="aw-mono">
            {market.contractAddress ?? <span className="aw-missing">not deployed</span>}
          </dd>
        </dl>

        <details className="aw-details">
          <summary>The canonical document and its hash</summary>
          <p className="aw-field__hint aw-field__hint--block">
            This is the exact byte string <code className="aw-mono">questionHash</code> is computed
            over, so anybody can recompute it and check it against the contract rather than taking
            this platform’s word that the criteria have not been edited since it opened.
          </p>
          <pre className="aw-pre">{document.canonical}</pre>
          <p className="aw-mono aw-stamp">{document.hash}</p>
        </details>
      </section>

      <MarketProvenancePanel provenance={provenance} />

      <PoolPanel pool={pool} />

      {market.status === 'resolved' || market.status === 'settled' || market.status === 'void' ? (
        <Outcome market={market} claimableFrom={window_.claimableFrom} windowOpen={window_.open} />
      ) : null}

      <ResolutionProgress marketId={market.id} status={market.status} />

      <h2 className="aw-section">What you can do</h2>
      <Lifecycle market={market} pool={detail.pool} onChanged={onChanged} />
    </>
  )
}

/* ══════════════════════════════ pieces ══════════════════════════════ */

/** The named source, as a link when it is one and as plain text when it is not. */
function NamedSource({ reference }: { reference: string }) {
  const href = safeHref(reference)
  if (href === null) return <span className="aw-mono">{reference}</span>
  return (
    <a className="wt-link aw-mono" href={href} target="_blank" rel="noreferrer noopener">
      {reference}
    </a>
  )
}

function MarketProvenancePanel({ provenance }: { provenance: MarketProvenance | null }) {
  if (provenance === null) {
    return (
      <section className="wt-panel">
        <div className="wt-panel__head">
          <h2 className="wt-panel__title">Provenance</h2>
        </div>
        <p className="aw-note">
          <span className="aw-note__icon" aria-hidden="true">
            ◇
          </span>
          This market was not built from a proposal. An operator wrote the question, and there is
          no pipeline provenance to show.
        </p>
      </section>
    )
  }

  return (
    <section className="wt-panel">
      <div className="wt-panel__head">
        <h2 className="wt-panel__title">Why this market exists</h2>
      </div>
      <Sources sources={provenance.sources} defaultOpen />
      <ProvenanceFacts
        rows={provenanceRows({
          // `provenanceRows` reads a proposal, and a market's provenance is the same five fields
          // under the same names (server.ts:434-443). The fields it does not carry are supplied
          // as null so the rows still render "not recorded" rather than disappearing.
          id: '',
          status: 'approved',
          question: '',
          resolutionCriteria: '',
          category: '',
          categoryVersion: 0,
          resolutionSourceKind: '',
          resolutionSourceRef: '',
          suggestedCloseTime: '',
          origin: provenance.origin,
          searchQuery: provenance.searchQuery,
          sources: provenance.sources,
          modelId: provenance.modelId,
          promptSha256: provenance.promptSha256,
          proposedAt: provenance.proposedAt,
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
          refusalId: null,
        })}
      />
    </section>
  )
}

/** What was decided, and when the money can move. */
function Outcome({
  market,
  claimableFrom,
  windowOpen,
}: {
  market: Market
  claimableFrom: string | null
  windowOpen: boolean
}) {
  const decided = outcomeLabel(market.outcome)

  return (
    <section className={`wt-panel aw-outcome${windowOpen ? ' aw-outcome--contestable' : ''}`}>
      <div className="wt-panel__head">
        <h2 className="wt-panel__title">The outcome</h2>
      </div>
      {market.status === 'void' ? (
        <p className="aw-outcome__headline">
          <span aria-hidden="true">⊘ </span>
          Void — every stake refunded whole, no fee.
          {market.voidReason ? ` Reason: ${market.voidReason}` : ''}
        </p>
      ) : (
        <p className="aw-outcome__headline">
          <span aria-hidden="true">◆ </span>
          {/* Never "0" or "1" on screen. 0 is YES and 1 is NO, and a console that prints the wire
              value invites somebody to reason about it as a boolean. */}
          {decided === null ? 'no outcome recorded' : `Resolved ${decided}`}
        </p>
      )}
      <dl className="wt-facts">
        <dt>Posted</dt>
        <dd className="cf-num">{utcStamp(market.resolvedAt) ?? 'not recorded'}</dd>
        <dt>Claimable from</dt>
        <dd className="cf-num">
          {claimableFrom === null ? (
            <span className="aw-missing">not recorded</span>
          ) : (
            utcStamp(claimableFrom)
          )}
        </dd>
        <dt>Settled</dt>
        <dd className="cf-num">{utcStamp(market.settledAt) ?? <span className="aw-missing">not yet</span>}</dd>
      </dl>
      {windowOpen && (
        <p className="aw-note aw-note--warn">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          The dispute window is still open. Nobody can claim yet, so the money has not moved — this
          is the period in which a wrong outcome can still be turned into a void.
        </p>
      )}
    </section>
  )
}

/**
 * How the oracle post is going.
 *
 * ── The 500 this panel used to warn about is fixed, and the warning has gone with it ──────────
 *
 * `GET /markets/:id/resolution` returned the `Resolution` row verbatim, `oracleNonce` is a bigint
 * and `JSON.stringify` throws on one — so the route answered 500 from the moment the oracle
 * signed, which is every call an operator would actually make. foresight narrowed it:
 * `resolutionView` (foresight/src/resolve.ts:120-136) renders the nonce as a decimal string and
 * drops the signing path, and server.ts:963 serves that. Its header credits the report to this
 * console's predecessor — "Found by micro-foresight-admin-web, the first client to call the route".
 *
 * ── What has NOT changed is how a failure is worded ───────────────────────────────────────────
 *
 * A failure here is still rendered as "the plan cannot be read", never as "there is no plan".
 * Those are opposite facts about money that is about to move, and treating the first as the second
 * is how an operator resolves a market twice. That reading was right when the 500 was routine and
 * is right now that a failure means something else.
 */
function ResolutionProgress({ marketId, status }: { marketId: string; status: Market['status'] }) {
  const shouldLoad = status === 'closed' || status === 'resolved' || status === 'settled'
  const resolution = useResource(
    useCallback(
      (signal) => (shouldLoad ? loadResolution(marketId, { signal }) : Promise.resolve(null)),
      [marketId, shouldLoad],
    ),
    (data) => (data === null ? 0 : 1),
    'The resolution plan could not be read.',
  )

  if (!shouldLoad) return null
  if (resolution.state === 'loading') return <Loading label="Reading the resolution plan" />
  if (resolution.state === 'empty') return null

  if (resolution.state !== 'ok' || !resolution.data) {
    return (
      <section className="wt-panel">
        <div className="wt-panel__head">
          <h2 className="wt-panel__title">The oracle post</h2>
        </div>
        <p className="aw-note aw-note--warn">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          The resolution plan could not be read
          {resolution.error?.requestId ? ` (${resolution.error.requestId})` : ''}. This does NOT
          mean no plan exists — it means this panel cannot tell you either way. Do not resolve
          again on the strength of it being empty.
        </p>
      </section>
    )
  }

  const plan = resolution.data.resolution
  return (
    <section className="wt-panel">
      <div className="wt-panel__head">
        <h2 className="wt-panel__title">The oracle post</h2>
        <span className="wt-chip">{plan.state}</span>
      </div>
      <dl className="wt-facts">
        <dt>Planned action</dt>
        <dd>{actionLabel(plan.action)}</dd>
        <dt>Rationale</dt>
        <dd>{plan.rationale}</dd>
        <dt>Transaction</dt>
        <dd className="aw-mono">{plan.txHash ?? <span className="aw-missing">not broadcast</span>}</dd>
        <dt>Broadcast</dt>
        <dd className="cf-num">{utcStamp(plan.broadcastAt) ?? <span className="aw-missing">not yet</span>}</dd>
        <dt>Confirmed</dt>
        <dd className="cf-num">{utcStamp(plan.confirmedAt) ?? <span className="aw-missing">not yet</span>}</dd>
        <dt>Attempts</dt>
        <dd className="cf-num">{plan.attempts}</dd>
      </dl>
      {plan.lastError && (
        <p className="aw-note aw-note--warn">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          Last error: {plan.lastError}
        </p>
      )}
    </section>
  )
}

/* ══════════════════════════════ the actions ══════════════════════════════ */

function Lifecycle({
  market,
  pool,
  onChanged,
}: {
  market: Market
  pool: MarketDetail['pool']
  onChanged: () => void
}) {
  // Minted once per mount, per market. A key generated inside the click handler would make every
  // retry a fresh operation, which is the opposite of what the header is for.
  //
  // `idempotencyKeyFor` is this console's own minter (lib/gate.ts) rather than the `deployKeyFor`
  // that came with these screens. That function was deleted from lib/mutation.ts before the fold,
  // as dead code AND as evidence: this console had no markets and never deployed a contract, yet
  // it carried the function and a doc block citing foresight's server.ts, because the whole file
  // had been copied from micro-foresight-admin-web. The screens that actually need it are here
  // now, so the need is real — but there is one minter, and it is the one this bundle already
  // proves the shape of in test/gate.test.ts.
  const [deployKey] = useState(() => idempotencyKeyFor('foresight-deploy', market.id, Date.now()))
  const [outcome, setOutcome] = useState<0 | 1>(OUTCOME_YES)

  const approve = useMutation(() => approveMarket(market.id), 'The market was not approved.')
  const deploy = useMutation(
    () => deployMarket(market.id, deployKey),
    'The deploy was not accepted.',
  )
  const open = useMutation(() => openMarket(market.id), 'The market was not opened.')
  const resolve = useMutation(
    (rationale: string) => resolveMarket(market.id, outcome, rationale),
    'The resolution was not accepted.',
  )
  const voidIt = useMutation(
    (reason: string) => voidMarket(market.id, reason),
    'The market was not voided.',
  )

  const resolveAction = actionById(market, 'resolve')
  const voidAction = actionById(market, 'void')

  return (
    <>
      <MarketAction
        action={actionById(market, 'approve')}
        runLabel="Approve this market"
        busy={approve.busy}
        onRun={() => void approve.run().then((ok) => ok && onChanged())}
      />
      <MutationError notice={approve.error} />

      <MarketAction
        action={actionById(market, 'deploy')}
        runLabel="Deploy the contract"
        busy={deploy.busy}
        onRun={() => void deploy.run().then((ok) => ok && onChanged())}
      />
      {deploy.result && (
        <p className="aw-note">
          <span className="aw-note__icon" aria-hidden="true">
            ◇
          </span>
          {deploy.result.replayed
            ? 'This deploy had already been accepted under the same idempotency key — the same one, not a second.'
            : 'Accepted. A leased job signs and broadcasts; the contract address appears here when it lands.'}
        </p>
      )}
      <MutationError notice={deploy.error} />

      <MarketAction
        action={actionById(market, 'open')}
        runLabel="Open for stakes"
        busy={open.busy}
        onRun={() => void open.run().then((ok) => ok && onChanged())}
      />
      <MutationError notice={open.error} />

      {/* ── the two that cannot be undone ────────────────────────────────────────────────── */}

      {resolveAction.blocked === null ? (
        <IrreversibleAction
          label={resolveAction.label}
          summary={resolveAction.summary}
          consequences={resolveAction.consequences}
          phrase={marketConfirmationPhrase('resolve', market.id, outcome)}
          rationaleLabel="What is this outcome based on?"
          rationaleHint="Required by the service, and read by anyone who disputes it. Name the source and what it said."
          runLabel={`Post ${outcomeLabel(outcome)} on chain`}
          busy={resolve.busy}
          onRun={(rationale) => void resolve.run(rationale).then((ok) => ok && onChanged())}
        >
          <OutcomeChoice market={market} pool={pool} outcome={outcome} onChoose={setOutcome} />
          <ForesightRecord records={resolveAction.records} />
          <p className="aw-note aw-note--warn">
            <span className="aw-note__icon" aria-hidden="true">
              ▲
            </span>
            Before posting, the service checks that{' '}
            <span className="aw-mono">{market.resolutionSourceRef}</span> still answers. If it does
            not, this becomes a <strong>void</strong> — a whole refund — whatever you choose here.
            That is the rule this market was opened under, not an override.
          </p>
        </IrreversibleAction>
      ) : (
        <BlockedAction title="Resolve" reason={resolveAction.blocked} />
      )}
      {resolve.result && (
        <p className="aw-note aw-note--warn" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          Accepted. The service planned: <strong>{actionLabel(resolve.result.resolution.action)}</strong>.
          {resolve.result.resolution.action === 2
            ? ' The named source did not answer, so this market voids and refunds whole rather than settling from a source it did not name.'
            : ' A leased job signs with the oracle key and broadcasts it.'}
        </p>
      )}
      <MutationError notice={resolve.error} />

      {voidAction.blocked === null ? (
        <IrreversibleAction
          label={voidAction.label}
          summary={voidAction.summary}
          consequences={voidAction.consequences}
          phrase={marketConfirmationPhrase('void', market.id)}
          rationaleLabel="Why is this market being voided?"
          rationaleHint="Recorded on the market and shown publicly. A void is not a failure to decide; it is a decision that the question cannot be settled honestly."
          runLabel="Void this market and refund every stake"
          busy={voidIt.busy}
          onRun={(reason) => void voidIt.run(reason).then((ok) => ok && onChanged())}
        >
          <ForesightRecord records={voidAction.records} />
        </IrreversibleAction>
      ) : (
        <BlockedAction title="Void" reason={voidAction.blocked} />
      )}
      <MutationError notice={voidIt.error} />
    </>
  )
}

/**
 * Which side is being paid, with what that side is holding.
 *
 * The pool figures are here rather than only further up the page because this is the moment they
 * matter: choosing YES on a market where the YES side holds most of the pool is a different act
 * from choosing it where they hold almost none of it, and an operator should not have to scroll
 * to know which one they are performing. The observation time comes with them, always.
 */
function OutcomeChoice({
  market,
  pool,
  outcome,
  onChoose,
}: {
  market: Market
  pool: MarketDetail['pool']
  outcome: 0 | 1
  onChoose: (value: 0 | 1) => void
}) {
  const sides = [
    { value: OUTCOME_YES as 0, label: 'YES', amount: pool.yes, bps: pool.yesBps },
    { value: OUTCOME_NO as 1, label: 'NO', amount: pool.no, bps: pool.noBps },
  ]

  return (
    <fieldset className="aw-choice">
      <legend className="aw-choice__legend">Which side is right? This decides who is paid.</legend>
      {sides.map((side) => {
        const amount = formatWei(side.amount)
        return (
          <label
            className={`aw-choice__option${outcome === side.value ? ' is-chosen' : ''}`}
            key={side.label}
          >
            <input
              type="radio"
              name={`outcome-${market.id}`}
              checked={outcome === side.value}
              onChange={() => onChoose(side.value)}
            />
            <span className="aw-choice__word">{side.label}</span>
            <span className="aw-choice__detail">
              {amount === null ? (
                <span className="aw-missing">stake not recorded</span>
              ) : (
                <>
                  {amount} EMBER staked{' '}
                  <span className="aw-unit">{formatBps(side.bps) ?? 'share unknown'}</span>
                </>
              )}
            </span>
          </label>
        )
      })}
      <p className="aw-choice__caveat">
        {pool.asOf === null
          ? 'These figures have never been synced from the chain. They are absent, not zero.'
          : `Mirrored from the chain as of ${utcStamp(pool.asOf)}${pool.stale ? ' — and the mirror is behind the tip' : ''}. The contract is what pays.`}
      </p>
    </fieldset>
  )
}

/**
 * An irreversible action that is not available, said out loud.
 *
 * Rendered rather than omitted. "Why can I not void this market" is a question an operator will
 * otherwise answer by trying something else, and the answer — that a deployed market is voided
 * through the oracle so that the chain and the registry cannot disagree — is the one piece of
 * this design they most need to have understood.
 */
function BlockedAction({ title, reason }: { title: string; reason: string }) {
  return (
    <section className="aw-action aw-action--blocked">
      <div className="aw-action__head">
        <h3 className="aw-action__title">{title}</h3>
        <span className="aw-action__blocked">{reason}</span>
      </div>
    </section>
  )
}

/**
 * A reversible market action, adapted onto this console's `ReversibleAction`.
 *
 * The two consoles described an action differently and the fold had to pick one. `lifecycle.ts`
 * carries a `LifecycleAction` OBJECT — id, label, summary, consequences, blocked, records — which
 * is the right shape for this screen, because `actionsFor()` computes all five at once from one
 * market and the blocked reasons are the interesting half. `ReversibleAction` takes flat props,
 * which is the right shape for the approvals and broadcasts screens, where each control is
 * assembled from a different source.
 *
 * Adapting here rather than changing either was deliberate: widening `ReversibleAction` to accept
 * an optional action object would give it two ways to say the same thing, and the estate's own
 * record is that a second way of expressing one fact is the one that goes stale. This is six lines
 * and it is the only place that knows both shapes.
 *
 * `records` is passed through as children so that what foresight writes appears where the audit
 * preview appears on every other action in this console — same position, different record, and the
 * component says which. See `ForesightRecord`.
 */
function MarketAction({
  action,
  runLabel,
  busy,
  onRun,
}: {
  action: LifecycleAction
  runLabel: string
  busy: boolean
  onRun: () => void
}) {
  return (
    <ReversibleAction
      label={action.label}
      summary={action.summary}
      consequences={action.consequences}
      blocked={action.blocked}
      runLabel={runLabel}
      busy={busy}
      onRun={onRun}
    >
      <ForesightRecord records={action.records} />
    </ReversibleAction>
  )
}

/**
 * One approval request, and the decision on it.
 *
 * `GET /v1/approvals/:id` — **admin-api/src/server.ts:637**.
 * `POST /v1/approvals/:id/decision` — **admin-api/src/server.ts:709**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE THREE THINGS THIS SCREEN HAS TO GET RIGHT.
 *
 * **1. The four-eyes refusal is explained, not merely obeyed.** `decisionGate` (lib/gate.ts)
 * decides what may be offered. When the signed-in operator raised the request, the controls are
 * replaced by a sentence naming that fact — not disabled, because a disabled control reads as
 * "not yet" and gets clicked at.
 *
 * **2. An APPROVED, UNEXECUTED request is rendered as what it is.** A grant decides in one
 * transaction and executes in a second, deliberately (server.ts:753-767), and a failed execution
 * is NOT rolled back: the row stands at `approved` with `execution_outcome = 'failed'`, which is
 * the honest state and the one an operator can act on. Rendering that as "nothing happened" is
 * how a third operator comes to authorise something two operators already authorised. So the
 * screen says "authorised, and the run failed", with the upstream's reason, and offers a retry
 * that does not need another signature.
 *
 * **3. The deadline is computed, not read off `state`.** A request past its deadline still reads
 * `pending` until the leased expiry job sweeps it, and `decide()` answers 409 in the gap
 * (approvals.ts:263-265). See `decisionGate`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { decideApproval, loadApproval, type Approval, type DecisionResult } from '../lib/admin.ts'
import {
  confirmationPhrase,
  decisionGate,
  idempotencyKeyFor,
  previewDecision,
} from '../lib/gate.ts'
import { approvalTone, deadline, outcomeTone, principal, shortId, timestamp } from '../lib/format.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { useSession } from '../lib/auth.tsx'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { Facts, StatusWord } from '../components/tone.tsx'
import { IrreversibleAction } from '../components/irreversible.tsx'

export function ApprovalPage() {
  const { id = '' } = useParams()
  const { operator } = useSession()
  const load = useCallback(
    async (signal: AbortSignal) => (await loadApproval(id, { signal })).approval,
    [id],
  )
  const request = useResource<Approval>(load, () => 1, 'That request could not be loaded.')

  return (
    <>
      <nav className="aw-crumbs" aria-label="Breadcrumb">
        <Link className="aw-link" to="/approvals">
          Approvals
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="cf-num">{shortId(id)}</span>
      </nav>

      {request.state === 'loading' && <Loading label="Reading the request" />}
      {request.state === 'forbidden' && <Forbidden notice={request.error ?? undefined} />}
      {request.state === 'failed' && request.error !== null && (
        <Failed
          notice={request.error}
          onRetry={request.reload}
          title={
            request.error.message.includes('no approval') || request.error.message.includes('no such item')
              ? 'There is no request with that id'
              : 'That request did not load'
          }
        />
      )}

      {request.data !== null && (
        <ApprovalDetail
          approval={request.data}
          operatorPrincipal={operator.principal}
          onReload={request.reload}
        />
      )}
    </>
  )
}

function ApprovalDetail({
  approval,
  operatorPrincipal,
  onReload,
}: {
  approval: Approval
  operatorPrincipal: string | null
  onReload: () => void
}) {
  const now = new Date()
  const gate = decisionGate(approval, operatorPrincipal, now)
  const raiser = principal(approval.requestedBy)
  const until = deadline(approval.expiresAt, now)

  // Minted once per page view per direction, never per click: a retry after a lost response has
  // to present THE SAME key or it is a new operation. See `idempotencyKeyFor` in lib/gate.ts.
  const mintedAt = useMemo(() => Date.now(), [])

  const decide = useMutation<[boolean, string], DecisionResult>(
    async (grant: boolean, note: string) =>
      decideApproval(
        approval.id,
        { grant, note },
        idempotencyKeyFor(grant ? 'grant' : 'reject', approval.id, mintedAt),
      ),
    'The decision could not be sent.',
  )

  const run = async (grant: boolean, note: string) => {
    const result = await decide.run(grant, note)
    // Reload either way. A failed EXECUTION still changed the row — the approval is granted and
    // recorded as failed — so leaving the old copy on screen would show an operator a request they
    // could still decide, after they had decided it.
    if (result !== null) onReload()
  }

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">
          <span className="cf-num">{approval.action}</span>
        </h1>
        <div className="aw-page-badges">
          <StatusWord tone={approvalTone(approval.state)} />
          {approval.executionOutcome !== null && (
            <StatusWord tone={outcomeTone(approval.executionOutcome === 'succeeded' ? 'allowed' : 'failed')} prefix="run" />
          )}
        </div>
        <p className="aw-page-lede">{approval.reason}</p>
      </header>

      <section className="aw-panel" aria-label="The request">
        <h2 className="aw-panel__title">The request</h2>
        <Facts
          rows={[
            { label: 'Request id', value: <code className="cf-num">{approval.id}</code> },
            { label: 'Action', value: <code className="cf-num">{approval.action}</code> },
            {
              label: 'Subject',
              value: (
                <code className="cf-num">
                  {approval.subjectKind} · {approval.subjectId}
                </code>
              ),
            },
            { label: 'Parameters', value: <ParamList params={approval.params} /> },
            { label: 'Reason code', value: <code className="cf-num">{approval.reasonCode}</code> },
            { label: 'Reason', value: approval.reason },
            {
              label: 'Raised by',
              value: (
                <code className="cf-num" title={raiser.raw}>
                  {raiser.raw}
                </code>
              ),
            },
            { label: 'Raised at', value: <span className="cf-num">{timestamp(approval.requestedAt)}</span> },
            {
              label: 'Deadline',
              value: (
                <span className={until.passed ? 'aw-deadline aw-deadline--passed' : 'aw-deadline'}>
                  <span className="cf-num">{timestamp(approval.expiresAt)}</span> — {until.label}
                </span>
              ),
            },
            {
              label: 'Correlation id',
              value:
                approval.correlationId === null ? (
                  '—'
                ) : (
                  <Link className="aw-link cf-num" to={`/audit?correlationId=${encodeURIComponent(approval.correlationId)}`}>
                    {approval.correlationId}
                  </Link>
                ),
            },
          ]}
        />
      </section>

      {approval.decidedBy !== null && (
        <section className="aw-panel" aria-label="The decision">
          <h2 className="aw-panel__title">The decision</h2>
          <Facts
            rows={[
              { label: 'Decided by', value: <code className="cf-num">{approval.decidedBy}</code> },
              { label: 'Decided at', value: <span className="cf-num">{timestamp(approval.decidedAt)}</span> },
              { label: 'Note', value: approval.decisionNote ?? '—' },
            ]}
          />
        </section>
      )}

      <ExecutionState approval={approval} />

      {gate.decidable ? (
        <div className="aw-decisions">
          <IrreversibleAction
            label="Approve and run"
            summary={`Authorise ${approval.action} and run it immediately against its upstream.`}
            consequences={[
              'Your approval and the request are then a matching pair in the audit, naming both operators. Neither can be withdrawn.',
              'The action runs straight after the decision commits, in a separate transaction. If it fails, the approval still stands and the failure is recorded — the request does not go back to pending, and it does not need a third signature to retry.',
              'Every executor is idempotent at its upstream, so a retry after a lost answer replays rather than acting twice.',
            ]}
            previews={previewDecision(approval, true, operatorPrincipal)}
            phrase={confirmationPhrase(true, approval.id, approval.action)}
            rationaleLabel="Why are you approving this?"
            rationaleHint="Stored as the decision note on the row, and it is what anyone reading this in six months will have."
            runLabel={`Approve and run ${approval.action}`}
            busy={decide.busy}
            onRun={(rationale) => void run(true, rationale)}
          >
            <SubjectRecap approval={approval} />
          </IrreversibleAction>

          <IrreversibleAction
            label="Reject"
            summary="Refuse the request. Nothing runs, and the request is closed."
            consequences={[
              'Nothing is executed. No upstream is called.',
              'The request is closed for good: a decision is made once, and a rejected request cannot be decided again.',
              'If the action is still needed afterwards, somebody has to raise it again — which is a new request, with a new pair of operators.',
            ]}
            previews={previewDecision(approval, false, operatorPrincipal)}
            phrase={confirmationPhrase(false, approval.id, approval.action)}
            rationaleLabel="Why are you rejecting this?"
            rationaleHint="This is the only record of why the request was refused. Write it for the person who raised it."
            runLabel="Reject this request"
            busy={decide.busy}
            onRun={(rationale) => void run(false, rationale)}
          />
        </div>
      ) : (
        <section className="aw-panel aw-panel--refusal" aria-label="Why you cannot decide this">
          <h2 className="aw-panel__title">
            <span aria-hidden="true">⊘</span> No decision is available to you here
          </h2>
          <p>{gate.reason}</p>
          {gate.selfRaised && (
            <p className="aw-panel__aside">
              Send this address to another operator — it is the whole request, including what it
              will record.
            </p>
          )}
        </section>
      )}

      {decide.error !== null && (
        <Failed
          notice={decide.error}
          title={
            decide.error.forbidden
              ? 'admin-api refused that decision'
              : 'The decision did not complete'
          }
        />
      )}
    </>
  )
}

/**
 * What happened when the action ran — or the fact that it has not.
 *
 * The three states are deliberately three, not two. "Approved and not yet run" and "approved and
 * the run failed" are the same row to a careless reading and are entirely different to an
 * operator: one is waiting, the other needs a retry.
 */
function ExecutionState({ approval }: { approval: Approval }) {
  if (approval.state !== 'approved') return null

  if (approval.executedAt === null) {
    return (
      <p className="aw-note aw-note--warn" role="status">
        <span className="aw-note__icon" aria-hidden="true">
          ▲
        </span>
        Two operators authorised this and it has not run. That is the state a failed execution or a
        lost response leaves behind, and it is safe to retry — the executors are idempotent at
        their upstreams and no further signature is required.
      </p>
    )
  }

  const failed = approval.executionOutcome === 'failed'
  return (
    <section className={`aw-panel ${failed ? 'aw-panel--refusal' : ''}`} aria-label="What happened when it ran">
      <h2 className="aw-panel__title">
        {failed ? 'Authorised, and the run failed' : 'Authorised, and it ran'}
      </h2>
      <Facts
        rows={[
          { label: 'Ran at', value: <span className="cf-num">{timestamp(approval.executedAt)}</span> },
          {
            label: 'Outcome',
            value: (
              <StatusWord tone={outcomeTone(approval.executionOutcome === 'succeeded' ? 'allowed' : 'failed')} />
            ),
          },
          {
            label: 'Detail',
            value:
              approval.executionDetail === null ? (
                '—'
              ) : (
                <pre className="aw-code">{JSON.stringify(approval.executionDetail, null, 2)}</pre>
              ),
          },
        ]}
      />
      {failed && (
        <p className="aw-panel__aside">
          The approval stands. Nothing about this request needs deciding again — the upstream is
          what refused, and the same approval can be retried once whatever it named is fixed.
        </p>
      )}
    </section>
  )
}

/** The facts the decision turns on, restated immediately above the control that acts on them. */
function SubjectRecap({ approval }: { approval: Approval }) {
  return (
    <div className="aw-recap">
      <p className="aw-recap__line">
        <span className="aw-recap__label">You are about to run</span>{' '}
        <code className="cf-num">{approval.action}</code>
      </p>
      <p className="aw-recap__line">
        <span className="aw-recap__label">on</span>{' '}
        <code className="cf-num">
          {approval.subjectKind} {approval.subjectId}
        </code>
      </p>
      <p className="aw-recap__line">
        <span className="aw-recap__label">with</span> <ParamList params={approval.params} />
      </p>
    </div>
  )
}

function ParamList({ params }: { params: Record<string, unknown> }) {
  const entries = Object.entries(params)
  if (entries.length === 0) return <span className="aw-absent__word">no parameters</span>
  return (
    <ul className="aw-params">
      {entries.map(([key, value]) => (
        <li key={key}>
          <code className="cf-num">{key}</code>{' '}
          <span className="aw-params__value">
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </span>
        </li>
      ))}
    </ul>
  )
}

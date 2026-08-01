/**
 * The approval queue.
 *
 * `GET /v1/approvals` — **admin-api/src/server.ts:623**, with `state`, `action`, `requestedBy` and
 * `limit` read at server.ts:627-632.
 *
 * ── Why the default filter is `pending` ───────────────────────────────────────────────────────
 *
 * A queue is the list of things that need somebody. Opening on "everything" would put four
 * decided rows in front of every one that is waiting, and the whole point of the screen is that a
 * request nobody answers EXPIRES: `expirePending` sweeps them (approvals.ts:404) and the audit
 * records "no second operator answered before the deadline". A queue that buries its own work is
 * how that happens.
 *
 * ── Why "you raised this" is marked in the LIST and not only on the detail page ───────────────
 *
 * `admin-api` enforces four eyes three times over, and a console that only revealed the refusal
 * after an operator had opened a request, read it and pressed a button has made them do the work
 * twice. The mark is a word, not a colour.
 */
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadApprovals, type Approval, type ApprovalState } from '../lib/admin.ts'
import { approvalTone, asOfLabel, deadline, principal, shortId, timestamp } from '../lib/format.ts'
import { useResource } from '../lib/resource.ts'
import { useSession } from '../lib/auth.tsx'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { AsOf, StatusWord } from '../components/tone.tsx'

/** The four states `admin-api` will accept, plus the "no filter" option. server.ts:1055. */
const STATES: ReadonlyArray<{ value: ApprovalState | ''; label: string }> = [
  { value: 'pending', label: 'Waiting for a decision' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired unanswered' },
  { value: '', label: 'Every state' },
]

export function ApprovalsPage() {
  const [state, setState] = useState<ApprovalState | ''>('pending')
  const [readAt, setReadAt] = useState<Date | null>(null)
  const { operator } = useSession()

  const load = useCallback(
    async (signal: AbortSignal) => {
      const page = await loadApprovals(state === '' ? {} : { state }, { signal })
      setReadAt(new Date())
      return page.approvals
    },
    [state],
  )

  const queue = useResource<readonly Approval[]>(
    load,
    (rows) => rows.length,
    'The approval queue could not be loaded.',
    // The filter is part of the question. Without it here the console would show the previous
    // answer under the new filter — a list of pending requests with "Approved" selected above it,
    // and nothing on screen to say why.
    [state],
  )
  const now = new Date()

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Approvals</h1>
        <p className="aw-page-lede">
          Two operators, or nothing happens. The operator who raised a request may not decide it —
          admin-api refuses that at the route, in the UPDATE and at a database constraint.
        </p>
      </header>

      <div className="aw-toolbar">
        <label className="aw-field aw-field--inline">
          <span className="aw-field__label">Show</span>
          <select
            className="aw-field__input"
            value={state}
            onChange={(e) => setState(e.target.value as ApprovalState | '')}
          >
            {STATES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {readAt !== null && <AsOf label={asOfLabel(readAt, now)} />}
        <button type="button" className="cf-btn cf-btn--quiet" onClick={queue.reload}>
          Read again
        </button>
      </div>

      {queue.state === 'loading' && <Loading label="Reading the queue" />}
      {queue.state === 'forbidden' && <Forbidden notice={queue.error ?? undefined} />}
      {queue.state === 'failed' && queue.error !== null && (
        <Failed notice={queue.error} onRetry={queue.reload} title="The queue did not load" />
      )}
      {queue.state === 'empty' && (
        <Empty
          title={
            state === 'pending'
              ? 'Nothing is waiting for a second operator'
              : 'No requests in that state'
          }
          hint={
            state === 'pending'
              ? 'A request appears here the moment an operator raises one. It expires if nobody answers before its deadline, and the expiry is recorded in the audit.'
              : 'Change the filter above to see the rest of the queue.'
          }
          action={
            <Link className="cf-btn" to="/actions">
              Raise a request
            </Link>
          }
        />
      )}

      {queue.state === 'ok' && queue.data !== null && (
        <table className="aw-table aw-table--queue">
          <caption className="aw-table__caption">
            {queue.data.length} request{queue.data.length === 1 ? '' : 's'}, newest first.
          </caption>
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col">Action</th>
              <th scope="col">Raised by</th>
              <th scope="col">State</th>
              <th scope="col">Deadline</th>
            </tr>
          </thead>
          <tbody>
            {queue.data.map((approval) => {
              const raiser = principal(approval.requestedBy)
              const mine =
                operator.principal !== null && approval.requestedBy === operator.principal
              const until = deadline(approval.expiresAt, now)
              return (
                <tr key={approval.id}>
                  <th scope="row">
                    <Link className="aw-link cf-num" to={`/approvals/${approval.id}`}>
                      {shortId(approval.id)}
                    </Link>
                    <span className="aw-row-sub">{approval.reasonCode}</span>
                  </th>
                  <td>
                    <span className="cf-num">{approval.action}</span>
                    <span className="aw-row-sub">
                      {approval.subjectKind} · {shortId(approval.subjectId)}
                    </span>
                  </td>
                  <td>
                    <span className="cf-num" title={raiser.raw}>
                      {raiser.kind === 'service' ? raiser.short : `${raiser.short}…`}
                    </span>
                    {/* A WORD, not a colour. This is the fact that decides whether the operator
                        reading the queue can do anything about the row. */}
                    {mine && <span className="aw-row-sub aw-you">you raised this</span>}
                  </td>
                  <td>
                    <StatusWord tone={approvalTone(approval.state)} />
                  </td>
                  <td>
                    <span className={until.passed ? 'aw-deadline aw-deadline--passed' : 'aw-deadline'}>
                      {until.label}
                    </span>
                    {/* The absolute deadline beside the relative one: the browser's clock may be
                        wrong, and an operator with a skewed clock can see the disagreement. */}
                    <span className="aw-row-sub cf-num">{timestamp(approval.expiresAt)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

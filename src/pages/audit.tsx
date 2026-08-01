/**
 * The audit log, and the verification of the chain it lives in.
 *
 * `GET /v1/audit` — **admin-api/src/server.ts:557**, filters read at server.ts:563-570.
 * `GET /v1/audit/verify` — **admin-api/src/server.ts:579**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT "TAMPER-EVIDENT" MEANS HERE, SAID ON THE PAGE RATHER THAN ASSUMED.
 *
 * Each row commits to its predecessor, so an EDIT and an INTERIOR DELETION are both detected
 * twice over. A TRUNCATION is not: removing the last N rows leaves a shorter chain that verifies
 * perfectly, and that is the attack somebody covering their tracks would actually run, because it
 * needs no forgery. `audit_chain_checkpoints` is the answer — the verifier records "the chain
 * reached seq S with head H and N events", so a truncation below a checkpoint names a row that is
 * no longer there.
 *
 * This screen therefore reports the checkpoint findings SEPARATELY from the link findings, with
 * the words that distinguish them, because an operator who reads "chain OK" after a truncation
 * has been told something the chain alone cannot know. A chain that has NEVER been verified is a
 * third answer, not a green one: SD-16 verifies nightly and calls a break a P0, so a verification
 * that has never run is a control that is not running.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── One search box, and no free text ──────────────────────────────────────────────────────────
 *
 * 13 §16 names the workflow: "one search box accepts a `cf.request_id` … and fans out". Here that
 * is a correlation id, and it is an equality match on an indexed column. There is deliberately no
 * text search over the payload — `admin-api` offers none, and for a stated reason: a console that
 * offers a LIKE over `payload` is a console that table-scans the estate's audit of record during
 * an incident. Offering a box that could not be served would be inventing a surface.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  loadAudit,
  verifyChain,
  type AuditEvent,
  type AuditPage,
  type ChainVerification,
} from '../lib/admin.ts'
import { asOfLabel, chainTone, outcomeTone, principal, shortHash, timestamp } from '../lib/format.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { AsOf, Facts, StatusWord } from '../components/tone.tsx'

export function AuditPage() {
  const [search, setSearch] = useSearchParams()
  // Seeded from the address so a link out of an approval lands on that request's rows. The URL is
  // the state, not a mirror of it: an operator pastes this address to a colleague.
  const correlationId = search.get('correlationId') ?? ''
  const actor = search.get('actor') ?? ''
  const action = search.get('action') ?? ''
  const [draft, setDraft] = useState(correlationId)
  const [readAt, setReadAt] = useState<Date | null>(null)

  useEffect(() => setDraft(correlationId), [correlationId])

  const load = useCallback(
    async (signal: AbortSignal) => {
      const page = await loadAudit(
        {
          ...(correlationId ? { correlationId } : {}),
          ...(actor ? { actor } : {}),
          ...(action ? { action } : {}),
          limit: 50,
        },
        { signal },
      )
      setReadAt(new Date())
      return page
    },
    [correlationId, actor, action],
  )

  const audit = useResource<AuditPage>(load, (page) => page.events.length, 'The audit could not be read.')
  const now = new Date()

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Audit</h1>
        <p className="aw-page-lede">
          Every privileged action in the estate, hash-chained in the order it was recorded. This is
          the record a dispute is settled against.
        </p>
      </header>

      <ChainPanel />

      <form
        className="aw-toolbar aw-toolbar--form"
        onSubmit={(e) => {
          e.preventDefault()
          const next = new URLSearchParams(search)
          if (draft.trim().length > 0) next.set('correlationId', draft.trim())
          else next.delete('correlationId')
          setSearch(next)
        }}
      >
        <label className="aw-field aw-field--inline aw-field--grow">
          <span className="aw-field__label">Correlation id</span>
          <input
            className="aw-field__input"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="the cf.request_id quoted on an error page"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button type="submit" className="cf-btn">
          Find
        </button>
        {(correlationId || actor || action) && (
          <button
            type="button"
            className="cf-btn cf-btn--quiet"
            onClick={() => setSearch(new URLSearchParams())}
          >
            Clear filters
          </button>
        )}
        {readAt !== null && <AsOf label={asOfLabel(readAt, now)} />}
      </form>

      {(actor || action) && (
        <p className="aw-filters" role="status">
          Filtered to{' '}
          {actor && (
            <>
              actor <code className="cf-num">{actor}</code>{' '}
            </>
          )}
          {action && (
            <>
              action <code className="cf-num">{action}</code>
            </>
          )}
        </p>
      )}

      {audit.state === 'loading' && <Loading label="Reading the audit" />}
      {audit.state === 'forbidden' && <Forbidden notice={audit.error ?? undefined} />}
      {audit.state === 'failed' && audit.error !== null && (
        <Failed notice={audit.error} onRetry={audit.reload} title="The audit did not load" />
      )}
      {audit.state === 'empty' && (
        <Empty
          title={
            correlationId
              ? 'No audit rows carry that correlation id'
              : 'The audit has no rows yet'
          }
          hint={
            correlationId
              ? 'The id is matched exactly, on an indexed column — there is no partial match, deliberately. Check it against the one on the error page or the approval.'
              : 'Every privileged action in the estate writes one, in the same transaction as the change. An empty log means nothing privileged has happened yet.'
          }
        />
      )}

      {audit.state === 'ok' && audit.data !== null && (
        <AuditTable page={audit.data} onFilter={(key, value) => {
          const next = new URLSearchParams(search)
          next.set(key, value)
          setSearch(next)
        }} />
      )}
    </>
  )
}

function AuditTable({
  page,
  onFilter,
}: {
  page: AuditPage
  onFilter: (key: 'actor' | 'action', value: string) => void
}) {
  return (
    <>
      <table className="aw-table aw-table--audit">
        <caption className="aw-table__caption">
          {page.events.length} row{page.events.length === 1 ? '' : 's'}, newest first.
          {page.nextCursor !== null && ' There are older rows beyond this page.'}
        </caption>
        <thead>
          <tr>
            <th scope="col">Seq</th>
            <th scope="col">Recorded</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Subject</th>
            <th scope="col">Outcome</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {page.events.map((event) => (
            <AuditRow key={event.id} event={event} onFilter={onFilter} />
          ))}
        </tbody>
      </table>
      {page.nextCursor !== null && (
        <p className="aw-note" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            ⋯
          </span>
          Older rows exist beyond sequence <code className="cf-num">{page.nextCursor}</code>. Narrow
          by correlation id, actor or action rather than paging through the estate’s whole record.
        </p>
      )}
    </>
  )
}

function AuditRow({
  event,
  onFilter,
}: {
  event: AuditEvent
  onFilter: (key: 'actor' | 'action', value: string) => void
}) {
  const who = principal(event.actor)
  return (
    <tr>
      <th scope="row" className="cf-num" title={`hash ${event.hash}`}>
        {event.seq}
      </th>
      <td>
        <span className="cf-num">{timestamp(event.recordedAt)}</span>
        {/* The two clocks are different facts: `occurredAt` is the SOURCE's clock for a mirrored
            row, `recordedAt` is this service's. Showing only one would hide a mirror that is hours
            behind. */}
        {event.occurredAt !== event.recordedAt && (
          <span className="aw-row-sub cf-num">occurred {timestamp(event.occurredAt)}</span>
        )}
      </td>
      <td>
        <button
          type="button"
          className="aw-link aw-link--button cf-num"
          title={who.raw}
          onClick={() => onFilter('actor', event.actor)}
        >
          {who.kind === 'service' ? `service:${who.short}` : `${who.short}…`}
        </button>
      </td>
      <td>
        <button
          type="button"
          className="aw-link aw-link--button cf-num"
          onClick={() => onFilter('action', event.action)}
        >
          {event.action}
        </button>
        {event.reasonCode !== null && <span className="aw-row-sub">{event.reasonCode}</span>}
      </td>
      <td className="cf-num">
        {event.subjectKind}
        <span className="aw-row-sub cf-num">{event.subjectId}</span>
      </td>
      <td>
        <StatusWord tone={outcomeTone(event.outcome)} />
      </td>
      <td className="cf-num">
        {event.source}
        <span className="aw-row-sub cf-num" title={`prev ${event.prevHash}`}>
          {shortHash(event.hash)}
        </span>
      </td>
    </tr>
  )
}

/**
 * The chain verification.
 *
 * Two buttons, labelled by what they MEAN rather than by the parameter they set: the nightly job
 * resumes from the last checkpoint, and an operator investigating a suspected tamper asks for
 * everything (`from=0` re-walks the whole chain, server.ts:582-584 — a parameter rather than the
 * default because of cost, not doubt).
 *
 * `GET /v1/audit/verify` answers **200 whether or not the chain verifies** (server.ts:591-592):
 * the caller asked a question and this is the answer, and a 500 would deny a monitoring system
 * the fact it exists to read. So `ok: false` renders as a FINDING, never as a failed request.
 */
function ChainPanel() {
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const verify = useMutation<[boolean], ChainVerification>(
    async (full: boolean) => {
      const result = await verifyChain(full ? { from: '0' } : {})
      setCheckedAt(new Date())
      return result
    },
    'The chain could not be verified.',
  )
  const result = verify.result
  const now = new Date()

  return (
    <section className="aw-panel" aria-label="Chain verification">
      <h2 className="aw-panel__title">Chain verification</h2>
      <p className="aw-panel__lede">
        A hash chain catches an edit and an interior deletion. It cannot catch a truncation
        followed by a re-hash — the remainder verifies perfectly. Checkpoints catch that, and the
        two findings are reported separately below because they mean different things.
      </p>
      <div className="aw-toolbar">
        <button
          type="button"
          className="cf-btn"
          disabled={verify.busy}
          onClick={() => void verify.run(false)}
        >
          {verify.busy ? 'Walking…' : 'Verify from the last checkpoint'}
        </button>
        <button
          type="button"
          className="cf-btn cf-btn--quiet"
          disabled={verify.busy}
          onClick={() => void verify.run(true)}
        >
          Re-walk the whole chain
        </button>
        {checkedAt !== null && <AsOf label={asOfLabel(checkedAt, now)} />}
      </div>

      {verify.error !== null && (
        <Failed notice={verify.error} title="The verification request did not complete" />
      )}

      {result !== null && (
        <>
          <div className="aw-page-badges">
            <StatusWord
              tone={chainTone({
                ok: result.ok,
                breaks: result.breaks.length,
                // The service does not report whether a checkpoint exists; what it reports is
                // whether one was USED, which shows as a `from` above zero on a resume pass. This
                // console does not guess beyond that: `everVerified` is claimed only when the pass
                // actually resumed from somewhere.
                everVerified: result.from !== '0',
              })}
            />
          </div>
          <Facts
            rows={[
              { label: 'Rows walked', value: <span className="cf-num">{result.checked.toLocaleString()}</span> },
              { label: 'From sequence', value: <span className="cf-num">{result.from}</span> },
              { label: 'To sequence', value: <span className="cf-num">{result.to}</span> },
              { label: 'Rows in the log', value: <span className="cf-num">{result.totalEvents.toLocaleString()}</span> },
              {
                label: 'Head hash',
                value: (
                  <code className="cf-num" title={result.headHash}>
                    {shortHash(result.headHash)}
                  </code>
                ),
              },
            ]}
          />
          {result.breaks.length === 0 ? (
            <p className="aw-note aw-note--good" role="status">
              <span className="aw-note__icon" aria-hidden="true">
                ✓
              </span>
              Every row walked hashes to what it stores and names the row before it as its
              predecessor, and no checkpoint disagrees with the log. That is not proof the log is
              complete — nothing stored beside the data it attests can be — but altering it now
              means recomputing every row after the changed one, in one transaction, before the
              nightly verifier runs.
            </p>
          ) : (
            <Breaks result={result} />
          )}
        </>
      )}
    </section>
  )
}

/**
 * Findings, split by what a chain can and cannot see on its own.
 *
 * `verifyChain` returns ALL breaks rather than the first: a tamper that touched three rows
 * produces three findings, and an operator answering "what was changed" needs the set.
 */
function Breaks({ result }: { result: ChainVerification }) {
  const checkpoint = result.breaks.filter((b) => b.kind.startsWith('checkpoint_'))
  const links = result.breaks.filter((b) => !b.kind.startsWith('checkpoint_'))

  return (
    <>
      <p className="aw-note aw-note--crit" role="alert">
        <span className="aw-note__icon" aria-hidden="true">
          ■
        </span>
        {result.breaks.length} finding{result.breaks.length === 1 ? '' : 's'}. SD-16 makes a break
        in the audit chain a P0. Every one is listed — a tamper that touched three rows produces
        three findings, and the set is what answers “what was changed”.
      </p>
      {checkpoint.length > 0 && (
        <>
          <h3 className="aw-panel__subtitle">
            The checkpoint disagrees with the log — this is the truncation case
          </h3>
          <p className="aw-panel__aside">
            A shorter chain verifies perfectly on its own. These findings come from comparing the
            log against a checkpoint recorded when it was longer, which is the only thing that can
            see rows being removed from the end.
          </p>
          <BreakList breaks={checkpoint} />
        </>
      )}
      {links.length > 0 && (
        <>
          <h3 className="aw-panel__subtitle">The chain itself does not hold</h3>
          <p className="aw-panel__aside">
            A row whose stored hash is not the hash of its own contents was edited. A row that
            names the wrong predecessor follows a gap.
          </p>
          <BreakList breaks={links} />
        </>
      )}
    </>
  )
}

function BreakList({ breaks }: { breaks: ChainVerification['breaks'] }) {
  return (
    <ul className="aw-breaks">
      {breaks.map((b) => (
        <li key={`${b.kind}-${b.seq}`} className="aw-breaks__item">
          <span className="aw-breaks__kind cf-num">{b.kind}</span>
          <span className="aw-breaks__seq cf-num">seq {b.seq}</span>
          <span className="aw-breaks__detail">{b.detail}</span>
        </li>
      ))}
    </ul>
  )
}

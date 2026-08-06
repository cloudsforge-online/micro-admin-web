/**
 * Support: "where did this user's money go", answered from one place.
 *
 * `GET /v1/audit` — **admin-api/src/server.ts**, filters read at server.ts. Twice, with
 * two different filters. That is the only route this screen calls, and it adds none: the pivot it
 * provides is a question nobody had asked of an existing route, not a surface that had to be
 * invented. See `lib/support.ts` for why the question is two queries and not one.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THIS SCREEN IS THE EVIDENCE FOR 17 §7 CLAIM 9, AND IT IS ALSO THE PLACE THAT SAYS HOW FAR
 * SHORT OF IT THE ESTATE STILL IS.**
 *
 * Claim 9 (`docs/ecosystem/17-definition-of-done.md`) is one of the eleven "one platform"
 * tests, and its stated evidence is: *an operator answers "where did this user's money go" from
 * `admin-web` alone, by correlation id, without a `docker logs`.* 05 journey 16 is the same thing
 * as a workflow, and its table names five questions.
 *
 * Of those five, this screen answers **none** on its own today, and it says so on the page rather
 * than leaving the operator to infer it from a short list. What it does answer is the question
 * that comes BEFORE all five and that no screen could answer at all: *which correlation ids does
 * this user's history hang off*. That is the thread the other five are pulled with, and the
 * coverage panel names, per service, which of them can currently put anything on it.
 *
 * The reason it is honest rather than pessimistic: **nothing in the estate mirrors its audit rows
 * yet**. `admin-api`'s intake exists and is properly guarded, but the topic it consumes,
 * `*.audit.recorded` (`admin-api/src/server.ts`), has no producer anywhere in the estate —
 * `admin-api/README.md` records the same finding. So the log this screen reads holds
 * `admin-api`'s own rows and no others, and a screen that rendered that as a complete history
 * would be the exact defect this estate keeps producing: a surface that cannot fail, because it
 * has nothing to be wrong about.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── Nothing on this screen acts ───────────────────────────────────────────────────────────────
 *
 * There is no button here that changes anything, and that is a decision rather than an omission.
 * Every remedy 05's operator journeys reach for — releasing a stuck withdrawal, a reconciliation
 * correction, a listing takedown — is a two-operator action in this estate, and two of the three
 * have no route on `admin-api` at all. The approval queue is where an operator acts, the action
 * catalogue is where they see what may be acted on, and a support screen that grew a shortcut
 * around either would be the console offering a button the backend refuses. See the README.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadAudit, type AuditEvent } from '../lib/admin.ts'
import { asOfLabel, outcomeTone, principal, shortId, timestamp } from '../lib/format.ts'
import { useResource } from '../lib/resource.ts'
import {
  amountOf,
  correlationSpine,
  coverageOf,
  mergeTimeline,
  parseSubject,
  type CorrelationGroup,
  type Relation,
  type TimelineRow,
} from '../lib/support.ts'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { AsOf, StatusWord } from '../components/tone.tsx'

/**
 * How many rows each of the two queries asks for.
 *
 * `admin-api` caps `limit` at 200 (`parseLimit`, admin-api/src/server.ts). This asks for the
 * cap on purpose: a support agent reading a disputed balance wants the whole history, and a
 * truncated one is the failure mode that matters here — so when the cap is reached the screen
 * SAYS the answer is partial rather than quietly ending.
 */
const PAGE = 200

interface Answer {
  readonly rows: readonly TimelineRow[]
  /** True when either query came back full, so the timeline may not reach far enough back. */
  readonly truncated: boolean
}

export function SupportPage() {
  const [search, setSearch] = useSearchParams()
  // The address is the state, not a mirror of it: an operator hands this URL to a colleague, and
  // the colleague must land on the same user rather than on an empty box.
  const userId = search.get('userId') ?? ''
  const [draft, setDraft] = useState(userId)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [readAt, setReadAt] = useState<Date | null>(null)

  useEffect(() => setDraft(userId), [userId])

  const load = useCallback(
    async (signal: AbortSignal): Promise<Answer> => {
      if (userId.length === 0) return { rows: [], truncated: false }
      // The two questions of lib/support.ts's header, in parallel. Both are equality matches on
      // indexed columns; neither is a scan.
      const [acted, done] = await Promise.all([
        loadAudit({ actor: `user:${userId}`, limit: PAGE }, { signal }),
        loadAudit({ subjectKind: 'user', subjectId: userId, limit: PAGE }, { signal }),
      ])
      setReadAt(new Date())
      return {
        rows: mergeTimeline(acted.events, done.events),
        // `nextCursor` is the service saying there are older rows. Either query having one means
        // this timeline does not reach the beginning of the account.
        truncated: acted.nextCursor !== null || done.nextCursor !== null,
      }
    },
    [userId],
  )

  const answer = useResource<Answer>(
    load,
    (a) => a.rows.length,
    'The user’s history could not be read.',
    // The user id IS the question. Without it in the dependencies a second lookup would render
    // the first user's history under the second user's id, which on a balance dispute is the
    // wrong person's money shown with the right name on it.
    [userId],
  )
  const now = new Date()

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Support</h1>
        <p className="aw-page-lede">
          Start from a user and find the correlation ids their history hangs off. Each one is the
          key that follows a single thread across every service that shares it — and the same id is
          the <code>traceparent</code>, so it is also the key into the traces and the logs.
        </p>
      </header>

      <form
        className="aw-toolbar aw-toolbar--form"
        onSubmit={(e) => {
          e.preventDefault()
          const parsed = parseSubject(draft)
          if (!parsed.ok) {
            // Said out loud. A search box that goes quiet on a malformed id teaches the operator
            // that this user has no history, which during a dispute is the wrong conclusion
            // delivered silently.
            setRefusal(parsed.message)
            return
          }
          setRefusal(null)
          const next = new URLSearchParams(search)
          next.set('userId', parsed.userId)
          setSearch(next)
        }}
      >
        <label className="aw-field aw-field--inline aw-field--grow">
          <span className="aw-field__label">User id</span>
          <input
            className="aw-field__input"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="the uuid on the account, not a correlation id"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button type="submit" className="cf-btn">
          Look up
        </button>
        {userId.length > 0 && (
          <button
            type="button"
            className="cf-btn cf-btn--quiet"
            onClick={() => {
              setRefusal(null)
              setSearch(new URLSearchParams())
            }}
          >
            Clear
          </button>
        )}
        {readAt !== null && <AsOf label={asOfLabel(readAt, now)} />}
      </form>

      {refusal !== null && (
        <p className="aw-note aw-note--warn" role="alert">
          <span className="aw-note__icon" aria-hidden="true">
            !
          </span>
          {refusal}
        </p>
      )}

      {userId.length === 0 && (
        <Empty
          title="Enter a user id to begin"
          hint="Two questions are asked of the audit: what the user did, and what was done to them. They are different filters on the same route, and both are needed — a balance dispute usually turns on something somebody else did."
        />
      )}

      {userId.length > 0 && (
        <>
          {answer.state === 'loading' && <Loading label="Reading the user’s history" />}
          {answer.state === 'forbidden' && <Forbidden notice={answer.error ?? undefined} />}
          {answer.state === 'failed' && answer.error !== null && (
            <Failed
              notice={answer.error}
              onRetry={answer.reload}
              title="The history did not load"
            />
          )}
          {answer.state === 'empty' && (
            <>
              <Empty
                title="The audit holds no rows naming this user"
                hint="The id is matched exactly, on an indexed column — there is no partial match, deliberately. Before concluding that nothing happened, read what this log does and does not contain, below."
              />
              {/* The coverage panel renders on the EMPTY result too, and that is the point of it:
                  an empty timeline here is far more likely to mean "the money services do not
                  mirror" than "this user did nothing". */}
              <CoveragePanel rows={[]} />
            </>
          )}
          {answer.state === 'ok' && answer.data !== null && (
            <Result answer={answer.data} userId={userId} />
          )}
        </>
      )}
    </>
  )
}

function Result({ answer, userId }: { answer: Answer; userId: string }) {
  const spine = correlationSpine(answer.rows)

  return (
    <>
      {answer.truncated && (
        <p className="aw-note aw-note--warn" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            ⋯
          </span>
          One of the two queries filled its page of {PAGE} rows, so this timeline does not reach the
          beginning of the account. Follow a correlation id into the audit to read a single thread
          in full rather than paging back through everything.
        </p>
      )}

      <SpinePanel spine={spine} />
      <CoveragePanel rows={answer.rows} />
      <Timeline rows={answer.rows} userId={userId} />
    </>
  )
}

/**
 * The correlation spine — the object claim 9 names.
 *
 * Each row is one thread, and the link carries the id into `/audit?correlationId=…`, which is the
 * screen that already answers "given a correlation id, show every row that carries it". The two
 * screens are halves of the same workflow: this one turns a person into threads, that one reads a
 * thread.
 */
function SpinePanel({ spine }: { spine: ReturnType<typeof correlationSpine> }) {
  return (
    <section className="aw-panel" aria-label="Correlation ids">
      <h2 className="aw-panel__title">Threads</h2>
      <p className="aw-panel__lede">
        Every distinct correlation id in this user’s history, most recent first. This is the key 17
        §7 claim 9 names: one id follows one thread of activity across every service that shares
        it, and it is the same value as the <code>traceparent</code>.
      </p>

      {spine.groups.length === 0 ? (
        <p className="aw-note" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            ◇
          </span>
          No row in this user’s history carries a correlation id, so there is no thread to follow
          into another service.
        </p>
      ) : (
        <table className="aw-table">
          <caption className="aw-table__caption">
            {spine.groups.length} thread{spine.groups.length === 1 ? '' : 's'}.
          </caption>
          <thead>
            <tr>
              <th scope="col">Correlation id</th>
              <th scope="col">Rows</th>
              <th scope="col">Services</th>
              <th scope="col">Not allowed</th>
              <th scope="col">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {spine.groups.map((group) => (
              <SpineRow key={group.correlationId} group={group} />
            ))}
          </tbody>
        </table>
      )}

      {spine.uncorrelated > 0 && (
        <p className="aw-note aw-note--warn" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            !
          </span>
          {spine.uncorrelated} row{spine.uncorrelated === 1 ? '' : 's'} in this history carry no
          correlation id at all, so {spine.uncorrelated === 1 ? 'it cannot' : 'they cannot'} be
          joined to anything in another service. They are counted here rather than dropped: a tidy
          list of threads with these quietly removed would read as complete coverage.
        </p>
      )}
    </section>
  )
}

function SpineRow({ group }: { group: CorrelationGroup }) {
  return (
    <tr>
      <th scope="row">
        {/* Into the screen that already reads a thread. The two are halves of one workflow. */}
        <Link
          className="aw-link cf-num"
          to={`/audit?correlationId=${encodeURIComponent(group.correlationId)}`}
          title={group.correlationId}
        >
          {group.correlationId}
        </Link>
      </th>
      <td className="cf-num">{group.events}</td>
      <td className="cf-num">{group.sources.join(', ')}</td>
      <td className="cf-num">
        {group.notAllowed === 0 ? (
          <span className="aw-row-sub">none</span>
        ) : (
          // Refused and failed rows are called out because "why was I blocked" is one of the five
          // questions 05 journey 16 lists, and a refusal is the answer more often than a movement.
          <strong>{group.notAllowed}</strong>
        )}
      </td>
      <td>
        <span className="cf-num">{timestamp(group.lastAt)}</span>
        <span className="aw-row-sub cf-num">
          seq {group.firstSeq}–{group.lastSeq}
        </span>
      </td>
    </tr>
  )
}

/**
 * What this answer does not contain, named service by service.
 *
 * See the header of `lib/support.ts` for the finding. This panel is not decoration and it is not
 * a disclaimer: it is the part that stops a short timeline from reading as a quiet account.
 */
function CoveragePanel({ rows }: { rows: readonly TimelineRow[] }) {
  const coverage = coverageOf(rows)

  return (
    <section className="aw-panel" aria-label="Coverage">
      <h2 className="aw-panel__title">What this history can and cannot contain</h2>

      {coverage.anyServiceMirrors ? (
        <p className="aw-note aw-note--good" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            ✓
          </span>
          Rows arrived from {coverage.present.join(', ')}. Services still absent from this answer:{' '}
          {coverage.absent.length === 0 ? 'none' : coverage.absent.join(', ')}.
        </p>
      ) : (
        <p className="aw-note aw-note--crit" role="alert">
          <span className="aw-note__icon" aria-hidden="true">
            ■
          </span>
          <strong>Every row here was written by admin-api itself.</strong> No other service mirrors
          its audit rows yet, so identity, ledger, wallet, settlement, custody, market, billing and
          activity contribute nothing to this timeline — including every deposit, every withdrawal
          and every ledger movement. A short history below is evidence about the mirror, not about
          the user.
        </p>
      )}

      <p className="aw-panel__aside">
        17 §2 requires every service to write an audit event for each privileged action{' '}
        <em>and mirror it to admin-api</em> (17-definition-of-done.md). The intake is built
        and properly guarded — <code>POST /v1/events</code> checks a signature over the exact bytes
        before parsing them — but the topic it consumes, <code>*.audit.recorded</code>, has no
        producer anywhere in the estate. Until each service emits it, the five questions 05 journey
        16 asks are answered by this console only in part.
      </p>

      <h3 className="aw-panel__subtitle">The five questions, and where each stands</h3>
      <table className="aw-table">
        <caption className="aw-table__caption">
          05-user-journeys.md, checked against the routes admin-api actually serves.
        </caption>
        <thead>
          <tr>
            <th scope="col">Question</th>
            <th scope="col">Answered here?</th>
            <th scope="col">What it needs</th>
          </tr>
        </thead>
        <tbody>
          {UNANSWERED.map((row) => (
            <tr key={row.question}>
              <th scope="row">{row.question}</th>
              <td>{row.answered}</td>
              <td className="cf-num">{row.needs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/**
 * The five questions of 05 journey 16, each with the route that would answer it.
 *
 * **Every route named here was read in the provider's source and is cited by path:line.** This
 * estate has repeatedly shipped clients against imagined surfaces, and a gap described in prose is
 * a gap that has not been checked. None of these is called by this console, because none is
 * exposed by `admin-api` — the missing route is the finding, and naming it precisely is what makes
 * it closeable.
 */
const UNANSWERED: ReadonlyArray<{ question: string; answered: string; needs: string }> = [
  {
    question: 'What does the user hold?',
    answered: 'No',
    needs:
      'ledger GET /accounts/:subject/balances (ledger/src/server.ts) — admin-api has the client (upstreams.ts) but exposes it only for engagement subjects',
  },
  {
    question: 'How did it get there?',
    answered: 'No',
    needs:
      'ledger GET /entries?correlationId= (ledger/src/server.ts) — real, and admin-api serves no route onto it',
  },
  {
    question: 'Which service caused each entry?',
    answered: 'Partly',
    needs:
      'the audit row’s source column, which is right — but only admin-api mirrors, so the column has one value',
  },
  {
    question: 'Did a deposit land?',
    answered: 'No',
    needs: 'indexer address_activity — no admin-api route, and no indexer client on admin-api',
  },
  {
    question: 'Was anything denied?',
    answered: 'Partly',
    needs:
      'refused audit rows are counted per thread above; policy_decision rows are in micro-policy and admin-api has no policy client',
  },
]

/**
 * The timeline, oldest first.
 *
 * The opposite order to `/audit`'s table, deliberately: that screen answers "what is in the log",
 * which is a question about the most recent thing, and this one answers "what happened to this
 * account", which is a sequence. A sequence printed backwards is one the reader has to reverse.
 */
function Timeline({ rows, userId }: { rows: readonly TimelineRow[]; userId: string }) {
  return (
    <section className="aw-panel" aria-label="Timeline">
      <h2 className="aw-panel__title">Timeline</h2>
      <p className="aw-panel__lede">
        Oldest first. Two questions were asked — what <code className="cf-num">{shortId(userId)}…</code>{' '}
        did, and what was done to them — and the relation column says which produced each row.
      </p>
      <table className="aw-table aw-table--audit">
        <caption className="aw-table__caption">
          {rows.length} row{rows.length === 1 ? '' : 's'}, oldest first.
        </caption>
        <thead>
          <tr>
            <th scope="col">Seq</th>
            <th scope="col">Occurred</th>
            <th scope="col">Relation</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Amount</th>
            <th scope="col">Outcome</th>
            <th scope="col">Thread</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TimelineRowView key={row.event.id} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** What each relation means, said in words rather than left to a code. */
const RELATION_LABEL: Readonly<Record<Relation, string>> = Object.freeze({
  acted: 'they acted',
  subject: 'done to them',
  both: 'both',
})

function TimelineRowView({ row }: { row: TimelineRow }) {
  const event: AuditEvent = row.event
  const who = principal(event.actor)
  const amount = amountOf(event.payload)

  return (
    <tr>
      <th scope="row" className="cf-num" title={`hash ${event.hash}`}>
        {event.seq}
      </th>
      <td>
        <span className="cf-num">{timestamp(event.occurredAt)}</span>
        {event.occurredAt !== event.recordedAt && (
          <span className="aw-row-sub cf-num">recorded {timestamp(event.recordedAt)}</span>
        )}
      </td>
      <td>{RELATION_LABEL[row.relation]}</td>
      <td className="cf-num" title={who.raw}>
        {who.kind === 'service' ? `service:${who.short}` : `${who.short}…`}
      </td>
      <td>
        <span className="cf-num">{event.action}</span>
        {event.reasonCode !== null && <span className="aw-row-sub">{event.reasonCode}</span>}
      </td>
      <td>
        {/* NEVER a zero standing in for an absence. `readAmount` refuses anything that is not a
            well-formed decimal integer precisely because `BigInt('')` is `0n` and would render a
            missing amount as a confident nothing — see lib/support.ts. */}
        {amount === null ? (
          <span className="aw-absent">
            <span className="aw-absent__word">no amount recorded</span>
          </span>
        ) : (
          <>
            <span className="cf-num aw-figure">{amount.value}</span>
            <span className="aw-row-sub cf-num">{amount.field}</span>
          </>
        )}
      </td>
      <td>
        <StatusWord tone={outcomeTone(event.outcome)} />
      </td>
      <td>
        {event.correlationId === null ? (
          <span className="aw-row-sub">none</span>
        ) : (
          <Link
            className="aw-link cf-num"
            to={`/audit?correlationId=${encodeURIComponent(event.correlationId)}`}
            title={event.correlationId}
          >
            {shortId(event.correlationId)}…
          </Link>
        )}
      </td>
    </tr>
  )
}

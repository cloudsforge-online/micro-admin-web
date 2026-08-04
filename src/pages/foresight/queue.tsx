/**
 * The idea queue: what the pipeline proposed, and what a person is going to do about it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * NOTHING A MODEL PRODUCES CAN OPEN A MARKET, AND THIS IS THE SCREEN WHERE THAT IS TRUE OR NOT.
 *
 * Approving a proposal here is not filing a ticket. It is an accountable person putting their
 * name to resolution criteria that will be a contract with strangers — people who will stake real
 * EMBER against the sentence in that box and have no recourse if it turns out to be unsettleable.
 *
 * So the sources are the loudest thing on each card, the approve control does not release until
 * they have been opened, and a model proposal with no sources cannot be approved at all. The
 * mechanism is `approvalGate` in lib/provenance.ts, which is a pure function precisely so it can
 * be proven to refuse rather than reviewed for whether it does.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── The route this page deliberately does not use ─────────────────────────────────────────────
 *
 * There is no `GET /ideas/:id`. Only the list. So a proposal has no address of its own and this
 * page holds all of them; inventing a per-idea path would be the same mistake `micro-market` made
 * against policy, which returned 403 on every listing for as long as it lived.
 */
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Failed, Forbidden, Loading } from '../../components/states.tsx'
import { ProvenanceFacts, Sources } from '../../components/provenance.tsx'
import {
  approveIdea,
  createMarket,
  discardIdea,
  editIdea,
  loadCategories,
  loadIdeas,
  type CategoryBoard,
  type Idea,
  type IdeaDraft,
  type IdeaStatus,
} from '../../lib/foresight.ts'
import { utcStamp } from '../../lib/format.ts'
import { useMutation } from '../../lib/mutation.ts'
import { approvalGate, provenanceGaps, provenanceRows } from '../../lib/provenance.ts'
import { useResource } from '../../lib/resource.ts'
import { foresightPath } from '../../lib/routes.ts'

const FILTERS: ReadonlyArray<{ status: IdeaStatus; label: string }> = [
  { status: 'proposed', label: 'Waiting on you' },
  { status: 'approved', label: 'Approved' },
  { status: 'discarded', label: 'Discarded' },
]

export function QueuePage() {
  const [status, setStatus] = useState<IdeaStatus>('proposed')

  const ideas = useResource(
    useCallback((signal) => loadIdeas(status, undefined, { signal }), [status]),
    (data) => data.ideas.length,
    'The idea queue could not be loaded.',
  )
  const board = useResource(
    useCallback((signal) => loadCategories({ signal }), []),
    (data) => data.categories.length,
    'The category allowlist could not be loaded.',
  )

  return (
    <>
      <div className="wt-page__head">
        <h1 className="wt-page__title">Idea queue</h1>
        <p className="wt-page__meta">
          A proposal is a draft question. It becomes a market only when a person approves it.
        </p>
      </div>

      <div className="aw-filters" role="group" aria-label="Which proposals">
        {FILTERS.map((filter) => (
          <button
            key={filter.status}
            type="button"
            className={`aw-filter${status === filter.status ? ' is-active' : ''}`}
            aria-pressed={status === filter.status}
            onClick={() => setStatus(filter.status)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {ideas.state === 'loading' && <Loading label="Loading the queue" />}
      {ideas.state === 'forbidden' && (
        <Forbidden
          notice={ideas.error ?? undefined}
          title="This console needs an operator role"
        />
      )}
      {ideas.state === 'failed' && ideas.error && (
        <Failed notice={ideas.error} onRetry={ideas.reload} title="The queue did not load" />
      )}
      {ideas.state === 'empty' && (
        <Empty
          title={
            status === 'proposed'
              ? 'No proposals are waiting'
              : `No ${status} proposals in the most recent 50`
          }
          hint={
            status === 'proposed'
              ? 'The pipeline runs on a schedule. Nothing here means nothing has been proposed since the last one was decided.'
              : undefined
          }
        />
      )}
      {ideas.state === 'ok' &&
        ideas.data?.ideas.map((idea) => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            board={board.data}
            onDecided={ideas.reload}
          />
        ))}
    </>
  )
}

/* ══════════════════════════════ one proposal ══════════════════════════════ */

function IdeaCard({
  idea,
  board,
  onDecided,
}: {
  idea: Idea
  board: CategoryBoard | null
  onDecided: () => void
}) {
  const navigate = useNavigate()
  const [sourcesReviewed, setSourcesReviewed] = useState(false)
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [refusalId, setRefusalId] = useState('')

  const approve = useMutation(
    (id: string, n: string | null) => approveIdea(id, n),
    'The approval did not go through.',
  )
  const discard = useMutation(
    (id: string, refusal: string, n: string | null) => discardIdea(id, refusal, n),
    'The proposal was not discarded.',
  )
  const draft = useMutation(
    (source: Idea) =>
      createMarket({
        ideaId: source.id,
        question: source.question,
        resolutionCriteria: source.resolutionCriteria,
        category: source.category,
        resolutionSourceKind: source.resolutionSourceKind,
        resolutionSourceRef: source.resolutionSourceRef,
        // The market's close time starts as the proposal's suggestion. It is the operator's from
        // here: the draft's own screen is where it is changed, and the service refuses a close
        // time in the past either way (markets.ts:257-259).
        closeTime: source.suggestedCloseTime,
      }),
    'The market draft was not created.',
  )

  const gate = approvalGate({ idea, sourcesReviewed, busy: approve.busy })
  const gaps = provenanceGaps(idea)
  const rows = useMemo(() => provenanceRows(idea), [idea])

  return (
    <article className="wt-panel aw-idea">
      <header className="aw-idea__head">
        <h2 className="aw-idea__question">{idea.question}</h2>
        <span className="wt-chip">{idea.category}</span>
      </header>

      <dl className="wt-facts aw-idea__facts">
        <dt>Resolution criteria</dt>
        <dd>{idea.resolutionCriteria}</dd>
        <dt>Settles from</dt>
        <dd>
          {idea.resolutionSourceKind} — <span className="aw-mono">{idea.resolutionSourceRef}</span>
        </dd>
        <dt>Suggested close</dt>
        <dd>{utcStamp(idea.suggestedCloseTime) ?? 'not recorded'}</dd>
        <dt>Allowlist version</dt>
        <dd>v{idea.categoryVersion}</dd>
      </dl>

      {/* Sources first and largest. See the header of components/provenance.tsx. */}
      <Sources sources={idea.sources} onOpen={() => setSourcesReviewed(true)} />

      {gaps.length > 0 && (
        <p className="aw-note aw-note--warn">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          The pipeline did not record {gaps.join(', ')}. The proposal can still be judged from its
          sources, but its audit trail is incomplete.
        </p>
      )}

      <details className="aw-details">
        <summary>Provenance</summary>
        <ProvenanceFacts rows={rows} />
      </details>

      {idea.status !== 'proposed' && (
        <p className="aw-note">
          <span className="aw-note__icon" aria-hidden="true">
            ◇
          </span>
          {idea.status} by {idea.decidedBy ?? 'someone unrecorded'}
          {idea.decidedAt ? ` on ${utcStamp(idea.decidedAt)}` : ''}
          {idea.refusalId ? ` — ${idea.refusalId}` : ''}
          {idea.decisionNote ? ` — “${idea.decisionNote}”` : ''}
        </p>
      )}

      {editing && (
        <EditForm
          idea={idea}
          board={board}
          onDone={() => {
            setEditing(false)
            onDecided()
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {idea.status === 'proposed' && !editing && (
        <div className="aw-idea__decide">
          <label className="aw-field" htmlFor={`note-${idea.id}`}>
            <span className="aw-field__label">Note (optional)</span>
            <span className="aw-field__hint">
              Recorded against your decision. Say what you checked, not that you checked.
            </span>
            <input
              id={`note-${idea.id}`}
              className="aw-field__input"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="aw-idea__buttons">
            <button
              type="button"
              className="cf-btn aw-btn--go"
              disabled={!gate.ready}
              onClick={() => {
                void approve.run(idea.id, note || null).then((ok) => {
                  if (ok) onDecided()
                })
              }}
            >
              {approve.busy ? 'Approving…' : 'Approve this question'}
            </button>
            <button type="button" className="cf-btn" onClick={() => setEditing(true)}>
              Edit before approving
            </button>
          </div>

          {gate.reason && (
            <p
              className={`aw-note ${gate.permanent ? 'aw-note--crit' : 'aw-note--warn'}`}
              aria-live="polite"
            >
              <span className="aw-note__icon" aria-hidden="true">
                {gate.permanent ? '■' : '▲'}
              </span>
              {gate.reason}
            </p>
          )}

          <DiscardControl
            idea={idea}
            board={board}
            refusalId={refusalId}
            onRefusal={setRefusalId}
            busy={discard.busy}
            onDiscard={() => {
              void discard.run(idea.id, refusalId, note || null).then((ok) => {
                if (ok) onDecided()
              })
            }}
          />
        </div>
      )}

      {idea.status === 'approved' && (
        <div className="aw-idea__buttons">
          <button
            type="button"
            className="cf-btn aw-btn--go"
            disabled={draft.busy}
            onClick={() => {
              void draft.run(idea).then((created) => {
                if (created) navigate(foresightPath.market(created.market.id))
              })
            }}
          >
            {draft.busy ? 'Creating…' : 'Create the market draft'}
          </button>
          <span className="aw-action__blocked">
            The draft still has to be approved and deployed before anyone can stake.
          </span>
        </div>
      )}

      <MutationError notice={approve.error} />
      <MutationError notice={discard.error} />
      <MutationError notice={draft.error} />
    </article>
  )
}

/* ══════════════════════════════ discard ══════════════════════════════ */

/**
 * Discarding takes one of the three named refusals, and free text is not accepted.
 *
 * That is foresight's rule, not this panel's (`requireString(body, 'refusalId')`,
 * server.ts:620; the ids come from `REFUSALS`, categories.ts:104-131) and the reason is stated
 * where they are defined: "so the reason a proposal was discarded can be recorded as one of them
 * rather than as free text nobody can count". A rising count of one refusal is how the estate
 * finds out the prompt has drifted.
 */
function DiscardControl({
  idea,
  board,
  refusalId,
  onRefusal,
  busy,
  onDiscard,
}: {
  idea: Idea
  board: CategoryBoard | null
  refusalId: string
  onRefusal: (id: string) => void
  busy: boolean
  onDiscard: () => void
}) {
  const selected = board?.refusals.find((r) => r.id === refusalId) ?? null

  return (
    <details className="aw-details aw-details--discard">
      <summary>Discard this proposal</summary>
      {board === null ? (
        <p className="aw-note aw-note--warn">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          The refusal list could not be loaded, so a proposal cannot be discarded against a named
          reason right now. Leave it in the queue rather than deciding without one.
        </p>
      ) : (
        <>
          <label className="aw-field" htmlFor={`refusal-${idea.id}`}>
            <span className="aw-field__label">Which refusal does this fall under?</span>
            <select
              id={`refusal-${idea.id}`}
              className="aw-field__input"
              value={refusalId}
              onChange={(e) => onRefusal(e.target.value)}
            >
              <option value="">Choose one…</option>
              {board.refusals.map((refusal) => (
                <option key={refusal.id} value={refusal.id}>
                  {refusal.id}
                </option>
              ))}
            </select>
          </label>
          {selected && <p className="aw-field__hint aw-field__hint--block">{selected.reason}</p>}
          <button
            type="button"
            className="cf-btn"
            disabled={busy || refusalId === ''}
            onClick={onDiscard}
          >
            {busy ? 'Discarding…' : 'Discard'}
          </button>
        </>
      )}
    </details>
  )
}

/* ══════════════════════════════ edit ══════════════════════════════ */

/**
 * Edit a proposal before approving it — the middle of "approves, edits or discards".
 *
 * Every field is sent on every save. `PATCH /ideas/:id` is named for a partial update and is not
 * one: all six fields are `requireString`/`requireDate` (server.ts:585-593), and a partial body
 * answers 400. Sending the whole draft is what the route actually accepts.
 */
function EditForm({
  idea,
  board,
  onDone,
  onCancel,
}: {
  idea: Idea
  board: CategoryBoard | null
  onDone: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<IdeaDraft>({
    question: idea.question,
    resolutionCriteria: idea.resolutionCriteria,
    category: idea.category,
    resolutionSourceKind: idea.resolutionSourceKind,
    resolutionSourceRef: idea.resolutionSourceRef,
    suggestedCloseTime: idea.suggestedCloseTime,
  })
  const save = useMutation(
    (id: string, next: IdeaDraft) => editIdea(id, next),
    'The edit was not saved.',
  )
  const spec = board?.categories.find((c) => c.id === draft.category) ?? null
  const set = <K extends keyof IdeaDraft>(key: K, value: IdeaDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  return (
    <div className="aw-edit">
      <label className="aw-field">
        <span className="aw-field__label">Question</span>
        <textarea
          className="aw-field__input"
          rows={2}
          value={draft.question}
          onChange={(e) => set('question', e.target.value)}
        />
      </label>
      <label className="aw-field">
        <span className="aw-field__label">Resolution criteria</span>
        <span className="aw-field__hint">
          This is the contract with whoever stakes. It has to say which source, at which instant,
          in which units — a criterion that cannot be settled is discovered by a bettor who has
          already paid.
        </span>
        <textarea
          className="aw-field__input"
          rows={4}
          value={draft.resolutionCriteria}
          onChange={(e) => set('resolutionCriteria', e.target.value)}
        />
      </label>
      <label className="aw-field">
        <span className="aw-field__label">Category</span>
        <select
          className="aw-field__input"
          value={draft.category}
          onChange={(e) => set('category', e.target.value)}
        >
          {(board?.categories ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.title}
            </option>
          ))}
          {board === null && <option value={draft.category}>{draft.category}</option>}
        </select>
      </label>
      <label className="aw-field">
        <span className="aw-field__label">Source kind</span>
        <span className="aw-field__hint">
          {spec
            ? `This category settles from: ${spec.sourceKinds.join(', ')}. Anything else is refused.`
            : 'The allowlist could not be loaded, so the permitted kinds are not shown.'}
        </span>
        <select
          className="aw-field__input"
          value={draft.resolutionSourceKind}
          onChange={(e) => set('resolutionSourceKind', e.target.value)}
        >
          {(spec?.sourceKinds ?? [draft.resolutionSourceKind]).map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>
      <label className="aw-field">
        <span className="aw-field__label">Named source</span>
        <span className="aw-field__hint">
          Named now, not at resolution. If it is gone when the market resolves, the market voids
          and refunds whole — it is never settled from a source it did not name.
        </span>
        <input
          className="aw-field__input"
          type="text"
          value={draft.resolutionSourceRef}
          onChange={(e) => set('resolutionSourceRef', e.target.value)}
        />
      </label>
      <label className="aw-field">
        <span className="aw-field__label">Suggested close time (ISO-8601, UTC)</span>
        <input
          className="aw-field__input aw-mono"
          type="text"
          value={draft.suggestedCloseTime}
          onChange={(e) => set('suggestedCloseTime', e.target.value)}
        />
      </label>

      <div className="aw-idea__buttons">
        <button
          type="button"
          className="cf-btn aw-btn--go"
          disabled={save.busy}
          onClick={() => {
            void save.run(idea.id, draft).then((ok) => {
              if (ok) onDone()
            })
          }}
        >
          {save.busy ? 'Saving…' : 'Save the edit'}
        </button>
        <button type="button" className="cf-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <MutationError notice={save.error} />
    </div>
  )
}

/** A failed write, beside the control that caused it, with the request id support needs. */
export function MutationError({
  notice,
}: {
  notice: import('../../lib/api.ts').ErrorNotice | null
}) {
  if (!notice) return null
  return (
    <p className="aw-note aw-note--crit" role="alert">
      <span className="aw-note__icon" aria-hidden="true">
        ■
      </span>
      {notice.message}
      {notice.requestId && (
        <>
          {' '}
          <code className="cf-num wt-reqid">{notice.requestId}</code>
        </>
      )}
    </p>
  )
}

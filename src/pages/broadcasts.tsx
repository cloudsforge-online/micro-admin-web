/**
 * Broadcasts — the estate-wide notice an operator writes during an incident.
 *
 * `GET /v1/broadcasts` — **admin-api/src/server.ts:811**, `live` read at server.ts:814.
 * `POST /v1/broadcasts` — **admin-api/src/server.ts:827**, `Idempotency-Key` required at
 * server.ts:832 — a retry must not publish a second notice.
 * `DELETE /v1/broadcasts/:id` — **admin-api/src/server.ts:864**.
 *
 * **No `Idempotency-Key` on the retraction, deliberately**, and for a different reason from the
 * flag route: it is a state transition claimed with `where retracted_at is null`, so a second
 * attempt matches no row and is refused rather than audited twice
 * (`admin-api/src/routeidempotency.test.ts:37-38`).
 *
 * ── This is the screen 13:358 points at ───────────────────────────────────────────────────────
 *
 * "Updates are written in `admin-web`, stored on the Beacon incident, and are the same record" the
 * public status page reads. So the composer says who will see it, and the retraction says plainly
 * that a retracted broadcast is not deleted — it stays in the record with the time it was pulled
 * and by whom, which is the property that makes an incident timeline reconstructable afterwards.
 */
import { useCallback, useMemo, useState } from 'react'
import {
  loadBroadcasts,
  publishBroadcast,
  retractBroadcast,
  SEVERITIES,
  type Broadcast,
  type Severity,
} from '../lib/admin.ts'
import { asOfLabel, severityTone, timestamp } from '../lib/format.ts'
import { idempotencyKeyFor, previewBroadcast } from '../lib/gate.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { useSession } from '../lib/auth.tsx'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { AsOf, StatusWord } from '../components/tone.tsx'
import { ReversibleAction } from '../components/irreversible.tsx'

export function BroadcastsPage() {
  const [readAt, setReadAt] = useState<Date | null>(null)
  const load = useCallback(async (signal: AbortSignal) => {
    const result = await loadBroadcasts({ limit: 50 }, { signal })
    setReadAt(new Date())
    return result.broadcasts
  }, [])
  const list = useResource<readonly Broadcast[]>(
    load,
    (rows) => rows.length,
    'The broadcasts could not be loaded.',
  )
  const now = new Date()

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Broadcasts</h1>
        <p className="aw-page-lede">
          What the estate tells everyone. A retracted broadcast is not deleted — it stays in the
          record with the time it was pulled and by whom.
        </p>
      </header>

      <Composer onPublished={list.reload} />

      <div className="aw-toolbar">
        {readAt !== null && <AsOf label={asOfLabel(readAt, now)} />}
        <button type="button" className="cf-btn cf-btn--quiet" onClick={list.reload}>
          Read again
        </button>
      </div>

      {list.state === 'loading' && <Loading label="Reading the broadcasts" />}
      {list.state === 'forbidden' && <Forbidden notice={list.error ?? undefined} />}
      {list.state === 'failed' && list.error !== null && (
        <Failed notice={list.error} onRetry={list.reload} title="The broadcasts did not load" />
      )}
      {list.state === 'empty' && (
        <Empty
          title="Nothing has been broadcast"
          hint="Compose one above when there is something the estate has to be told. It stays in the record afterwards."
        />
      )}
      {list.state === 'ok' &&
        list.data !== null &&
        list.data.map((broadcast) => (
          <BroadcastRow key={broadcast.id} broadcast={broadcast} onRetracted={list.reload} />
        ))}
    </>
  )
}

function Composer({ onPublished }: { onPublished: () => void }) {
  const { operator } = useSession()
  const [severity, setSeverity] = useState<Severity>('info')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const mintedAt = useMemo(() => Date.now(), [])

  const publish = useMutation<[], { broadcast: Broadcast }>(
    async () =>
      publishBroadcast(
        { severity, title: title.trim(), body: body.trim() },
        // Keyed on the TITLE rather than a counter: a retry of the same notice presents the same
        // key, and a genuinely different notice presents a different one. A per-click key would
        // make every retry a second broadcast, which is exactly what the header prevents.
        idempotencyKeyFor('broadcast', title.trim().slice(0, 60), mintedAt),
      ),
    'The broadcast could not be published.',
  )

  const incomplete = [
    ...(title.trim().length === 0 ? ['a title'] : []),
    ...(body.trim().length === 0 ? ['a body'] : []),
  ]

  const run = async () => {
    const result = await publish.run()
    if (result !== null) {
      setTitle('')
      setBody('')
      onPublished()
    }
  }

  return (
    <ReversibleAction
      label="Publish a broadcast"
      summary="An estate-wide notice, visible to everyone the estate shows broadcasts to."
      consequences={[
        'It is live from the moment it is published, unless a start time is set on the row afterwards.',
        'It carries your principal as the publisher, permanently.',
        'It can be retracted, and the retraction is recorded rather than erasing it.',
      ]}
      previews={[previewBroadcast({ actor: operator.principal, retract: false, id: null, severity })]}
      runLabel="Publish this broadcast"
      busy={publish.busy}
      disabledReason={incomplete.length === 0 ? null : `Still needed: ${incomplete.join(' and ')}.`}
      onRun={() => void run()}
    >
      <label className="aw-field aw-field--inline">
        <span className="aw-field__label">Severity</span>
        <select
          className="aw-field__input"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity)}
        >
          {SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="aw-field">
        <span className="aw-field__label">Title</span>
        <input
          className="aw-field__input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="aw-field">
        <span className="aw-field__label">Body</span>
        <span className="aw-field__hint">
          Write what somebody affected needs to do, not what the estate is doing about it.
        </span>
        <textarea
          className="aw-field__input"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {publish.error !== null && (
        <Failed notice={publish.error} title="The broadcast was not published" />
      )}
    </ReversibleAction>
  )
}

function BroadcastRow({
  broadcast,
  onRetracted,
}: {
  broadcast: Broadcast
  onRetracted: () => void
}) {
  const { operator } = useSession()
  const retract = useMutation<[], { broadcast: Broadcast }>(
    async () => retractBroadcast(broadcast.id),
    'The broadcast could not be retracted.',
  )

  const run = async () => {
    const result = await retract.run()
    if (result !== null) onRetracted()
  }

  const alreadyRetracted = broadcast.retractedAt !== null

  return (
    <ReversibleAction
      label={broadcast.title}
      summary={broadcast.body}
      consequences={[
        'It stops being shown immediately.',
        'It is not deleted. The row keeps the time it was retracted and who retracted it, which is what makes an incident timeline reconstructable afterwards.',
      ]}
      previews={[
        previewBroadcast({ actor: operator.principal, retract: true, id: broadcast.id }),
      ]}
      runLabel="Retract this broadcast"
      blocked={
        alreadyRetracted
          ? `Retracted ${timestamp(broadcast.retractedAt)} by ${broadcast.retractedBy ?? 'an operator'}. A second retraction claims no row and is refused.`
          : null
      }
      busy={retract.busy}
      onRun={() => void run()}
    >
      <div className="aw-page-badges">
        <StatusWord tone={severityTone(broadcast.severity)} />
      </div>
      <dl className="aw-facts aw-facts--tight">
        <div className="aw-facts__row">
          <dt className="aw-facts__label">published</dt>
          <dd className="aw-facts__value cf-num">
            {timestamp(broadcast.publishedAt)} by {broadcast.publishedBy}
          </dd>
        </div>
        <div className="aw-facts__row">
          <dt className="aw-facts__label">runs</dt>
          <dd className="aw-facts__value cf-num">
            {timestamp(broadcast.startsAt)} →{' '}
            {broadcast.endsAt === null ? 'no end set' : timestamp(broadcast.endsAt)}
          </dd>
        </div>
      </dl>
      {retract.error !== null && (
        <Failed notice={retract.error} title="The broadcast was not retracted" />
      )}
    </ReversibleAction>
  )
}

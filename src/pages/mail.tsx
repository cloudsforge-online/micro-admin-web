/**
 * Mail: "what did we send this person, and did it arrive", answered from one place.
 *
 * `GET /v1/mail` and `POST /v1/mail/:id/resend` — **admin-api/src/server.ts** — which forward the
 * operator's own bearer to notify. See `lib/mail.ts` for the seam and its reasons.
 *
 * ── THE PAGE ASKS FOR A PERSON BEFORE IT ASKS THE API ANYTHING ────────────────────────────────
 *
 * The API refuses an unscoped query (400): unscoped, notify's route is the estate-wide
 * dead-letter view, a different question. A page that could ask it would render that refusal as
 * an error, so the question is unaskable here too — `<Results>` only mounts once there is a
 * query, and the initial state is a prompt rather than a spinner that resolves to a mistake.
 *
 * The one input takes either identifier. A person contacting support quotes the ADDRESS they did
 * not get mail at; an operator arriving from the support page carries a user id. `@` decides
 * which it is, a uuid shape decides the other, and anything else is refused client-side with the
 * reason on screen — a typo'd uuid answered by the server would be a 400 read as an outage.
 *
 * ── "QUEUED", NEVER "SENT" ────────────────────────────────────────────────────────────────────
 *
 * Resend answers 202 and names a NEW delivery. Nothing has been sent when it resolves — notify's
 * dispatcher takes the row on its own schedule — so the confirmation says queued and offers
 * "Read again", which is when `sent` becomes a fact rather than a hope. The original row keeps
 * its failure on screen: `lastError` on the old delivery is the reason the operator is here, and
 * "did it fail the same way twice" is next question after a resend.
 */

import { useCallback, useState } from 'react'
import { loadMail, resendMail, type MailDelivery, type MailQuery } from '../lib/mail.ts'
import { timestamp } from '../lib/format.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function queryFor(raw: string): MailQuery | { refusal: string } {
  const value = raw.trim()
  if (value.includes('@')) return { address: value }
  if (UUID.test(value)) return { user: value }
  return {
    refusal:
      'Enter the email address the person says they did not get mail at, or their user id (a uuid).',
  }
}

export function MailPage() {
  const [input, setInput] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [query, setQuery] = useState<MailQuery | null>(null)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = queryFor(input)
    if ('refusal' in parsed) {
      setRefusal(parsed.refusal)
      return
    }
    setRefusal(null)
    setQuery(parsed)
  }

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Mail</h1>
        <p className="aw-page-lede">
          Everything sent to one person, including what arrived — an empty list here means no mail
          was sent, not that none failed.
        </p>
      </header>

      <form className="aw-toolbar" onSubmit={submit}>
        <input
          className="aw-input"
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="email address or user id"
          aria-label="Email address or user id"
        />
        <button className="aw-button" type="submit">
          Look up
        </button>
      </form>
      {refusal !== null && <p className="aw-field-error">{refusal}</p>}

      {query === null ? (
        <Empty
          title="Look somebody up to start"
          hint="The address they say they got nothing at, or their user id. The list shows every delivery, successes included — the question this page answers is what was sent, not what broke."
        />
      ) : (
        <Results key={query.user ?? query.address} query={query} />
      )}
    </>
  )
}

function Results({ query }: { query: MailQuery }) {
  const load = useCallback((signal: AbortSignal) => loadMail(query, { signal }), [query])
  const mail = useResource(
    load,
    (page) => page.deliveries.length,
    'The mail history could not be loaded.',
  )

  return (
    <>
      {mail.state === 'loading' && <Loading label="Reading the deliveries" />}
      {mail.state === 'forbidden' && <Forbidden notice={mail.error ?? undefined} />}
      {mail.state === 'failed' && mail.error !== null && (
        <Failed notice={mail.error} onRetry={mail.reload} title="The mail history did not load" />
      )}
      {mail.state === 'empty' && (
        <Empty
          title="Nothing was ever sent to them"
          hint="No deliveries exist for this person on any channel — which is an answer, not a failure. If they registered and expected a verification mail, that is worth a look at micro-org#447 territory: the send that never happened, not a send that bounced."
        />
      )}
      {mail.state === 'ok' && mail.data !== null && (
        <table className="aw-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Template</th>
              <th>Channel</th>
              <th>State</th>
              <th>Attempts</th>
              <th>Detail</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {mail.data.deliveries.map((row) => (
              <DeliveryRow key={row.id} row={row} onDone={mail.reload} />
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function DeliveryRow({ row, onDone }: { row: MailDelivery; onDone: () => void }) {
  // One key per page view: a double click inside this view replays, a deliberate second resend
  // after a reload is a new decision with a new key. Initialiser form so it is minted once.
  const [mintedAt] = useState(() => Date.now())
  const resend = useMutation<[], { deliveryId: string }>(
    () => resendMail(row.id, mintedAt),
    'The resend could not be queued.',
  )

  const run = async () => {
    const result = await resend.run()
    if (result !== null) onDone()
  }

  return (
    <tr>
      <td>{timestamp(row.createdAt)}</td>
      <td>
        <code>{row.templateId}</code>
      </td>
      <td>{row.channel}</td>
      <td>
        <span className={`aw-badge aw-badge--${row.state}`}>{row.state}</span>
        {row.sentAt !== null && <span className="aw-dim"> {timestamp(row.sentAt)}</span>}
      </td>
      <td>
        {row.attempts}/{row.maxAttempts}
      </td>
      <td className="aw-dim">
        {/* The failure stays on screen after a resend on purpose: "did it fail the same way
            twice" is the next question, and the NEW delivery keeps its own row. */}
        {row.lastError ?? row.reason ?? '—'}
      </td>
      <td>
        {row.state === 'pending' ? (
          <span className="aw-dim">queued</span>
        ) : (
          <button
            className="aw-button aw-button--small"
            disabled={resend.busy}
            onClick={() => void run()}
            title="Queues the same notification again as a new delivery. Nothing is sent until the dispatcher takes it."
          >
            {resend.busy ? 'Queueing…' : 'Send again'}
          </button>
        )}
        {resend.error !== null && <p className="aw-field-error">{resend.error.message}</p>}
        {resend.result !== null && <p className="aw-dim">queued — read again to watch it send</p>}
      </td>
    </tr>
  )
}

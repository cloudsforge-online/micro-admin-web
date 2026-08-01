/**
 * The action catalogue, and the one action that cannot be executed.
 *
 * `GET /v1/actions` — **admin-api/src/server.ts:609**. It returns every catalogue entry INCLUDING
 * the blocked one and its reason, precisely so a console can render the 501 before the operator
 * hits it (server.ts:612-613), plus the closed reason-code list (approvals.ts:53-61).
 * `POST /v1/approvals` — **admin-api/src/server.ts:645**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §3.3g IS THE HEADLINE ON THIS SCREEN, AND IT IS RENDERED AS A GAP RATHER THAN AS A BUTTON.
 *
 * Granting a platform role is a first-class catalogue action with **no executor**. `admin-api`
 * answers `POST /v1/approvals` for it with **501**, naming the route identity would need. So this
 * screen puts it in its own section, with no control that could send the request, the service's
 * own `blockedReason` verbatim, and the route that would unblock it — because the honest
 * rendering of an action that cannot be executed is not a disabled button. A disabled button
 * reads as "not yet, ask someone"; an operator clicks at it, and eventually concludes the console
 * is broken. The absence of a control with a paragraph in its place reads as "the estate has
 * decided this cannot be done from here, and here is what would have to exist".
 *
 * The rule underneath is `admin-api`'s: a queue that accepts work it cannot do lies to the
 * operator waiting on it, and leaves a row at `approved` for ever — which reads in the audit as
 * two operators having authorised something that never happened.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  loadActions,
  requestApproval,
  type ActionCatalogue,
  type ActionSpec,
  type Approval,
} from '../lib/admin.ts'
import { blockedActions, executableActions, missingParams } from '../lib/catalogue.ts'
import { idempotencyKeyFor, previewRequest } from '../lib/gate.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { useSession } from '../lib/auth.tsx'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { ReversibleAction } from '../components/irreversible.tsx'

export function ActionsPage() {
  const load = useCallback(async (signal: AbortSignal) => loadActions({ signal }), [])
  const catalogue = useResource<ActionCatalogue>(
    load,
    (c) => c.actions.length,
    'The action catalogue could not be loaded.',
  )

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Actions</h1>
        <p className="aw-page-lede">
          Everything an operator can ask two operators to authorise — and the one thing the estate
          has decided cannot be asked for at all.
        </p>
      </header>

      {catalogue.state === 'loading' && <Loading label="Reading the catalogue" />}
      {catalogue.state === 'forbidden' && <Forbidden notice={catalogue.error ?? undefined} />}
      {catalogue.state === 'failed' && catalogue.error !== null && (
        <Failed
          notice={catalogue.error}
          onRetry={catalogue.reload}
          title="The catalogue did not load"
        />
      )}
      {catalogue.data !== null && <Catalogue catalogue={catalogue.data} />}
    </>
  )
}

function Catalogue({ catalogue }: { catalogue: ActionCatalogue }) {
  const executable = executableActions(catalogue.actions)
  const blocked = blockedActions(catalogue.actions)

  return (
    <>
      <section className="aw-panel" aria-label="Actions that can be requested">
        <h2 className="aw-panel__title">Requestable</h2>
        <p className="aw-panel__lede">
          Each of these has an upstream that can perform it, cited by path and line. Raising a
          request runs nothing: it queues the action for a second operator.
        </p>
        {executable.map((spec) => (
          <RequestForm key={spec.name} spec={spec} reasonCodes={catalogue.reasonCodes} />
        ))}
      </section>

      {blocked.length > 0 && (
        <section className="aw-panel aw-panel--gap" aria-label="Actions with no executor">
          <h2 className="aw-panel__title">
            <span aria-hidden="true">⊘</span> Cannot be executed — no upstream route exists
          </h2>
          <p className="aw-panel__lede">
            These are real actions with real authorisation machinery behind them, and nothing to
            call. admin-api answers <code className="cf-num">501</code> for a request naming one,
            rather than accepting work its queue can never do — a request that sat at{' '}
            <code className="cf-num">approved</code> for ever would read in the audit as two
            operators having authorised something that never happened. There is deliberately no
            control here to send that request.
          </p>
          {blocked.map((spec) => (
            <BlockedAction key={spec.name} spec={spec} />
          ))}
        </section>
      )}
    </>
  )
}

/**
 * A catalogue entry with no executor.
 *
 * No form, no button, no disabled control. The reason is the service's own string, verbatim —
 * the SAME string the 501 carries — so the console and the service cannot drift into telling an
 * operator two different stories about why.
 */
function BlockedAction({ spec }: { spec: ActionSpec }) {
  return (
    <article className="aw-blocked" aria-label={spec.name}>
      <h3 className="aw-blocked__title cf-num">{spec.name}</h3>
      <p className="aw-blocked__summary">{spec.summary}</p>
      <p className="aw-blocked__verdict">
        <span className="aw-blocked__badge">NO EXECUTOR</span>
        <span>
          Requesting this returns <code className="cf-num">501 action_has_no_upstream</code>. The
          authorisation machinery exists here; the write does not exist anywhere.
        </span>
      </p>
      <div className="aw-blocked__reason">
        <h4 className="aw-blocked__reason-title">Why, in admin-api’s own words</h4>
        <p>{spec.blockedReason}</p>
      </div>
      <p className="aw-blocked__aside">
        The bootstrap stays outside every service on purpose: a service that can mint its own first
        administrator is a service whose compromise grants the estate, and this queue could not
        authorise the first grant anyway — approving requires an operator who already holds the
        role. The first admin is a documented{' '}
        <code className="cf-num">update users set roles = array[&apos;admin&apos;]</code> under the
        database owner’s credentials, which{' '}
        <code className="cf-num">scripts/slice-verify.sh</code> performs and asserts.
      </p>
    </article>
  )
}

/** One requestable action, with the parameters the service will demand. */
function RequestForm({ spec, reasonCodes }: { spec: ActionSpec; reasonCodes: readonly string[] }) {
  const navigate = useNavigate()
  const { operator } = useSession()
  const [subjectId, setSubjectId] = useState('')
  const [reasonCode, setReasonCode] = useState(reasonCodes[0] ?? '')
  const [reason, setReason] = useState('')
  const [params, setParams] = useState<Record<string, string>>({})
  const mintedAt = useMemo(() => Date.now(), [])

  const missing = missingParams(spec, params)
  const incomplete = [
    ...(subjectId.trim().length === 0 ? [`a ${spec.subjectKind} id`] : []),
    ...(reason.trim().length === 0 ? ['a reason'] : []),
    ...(reasonCode.length === 0 ? ['a reason code'] : []),
    ...missing.map((name) => `params.${name}`),
  ]

  const raise = useMutation<[], { approval: Approval }>(
    async () =>
      requestApproval(
        {
          action: spec.name,
          subjectId: subjectId.trim(),
          reasonCode,
          reason: reason.trim(),
          params,
        },
        idempotencyKeyFor('request', `${spec.name}-${subjectId.trim()}`, mintedAt),
      ),
    'The request could not be raised.',
  )

  const submit = async () => {
    const created = await raise.run()
    // Straight to the request, because the next thing that has to happen is that somebody else
    // reads it — and the address is what gets sent to them.
    if (created !== null) navigate(`/approvals/${created.approval.id}`)
  }

  return (
    <ReversibleAction
      label={spec.name}
      summary={spec.summary}
      consequences={[
        'Nothing runs. This queues the action for a second operator, who must be somebody other than you.',
        `It executes ${spec.route ?? 'its upstream route'} only once that second operator approves it.`,
        'If nobody answers before the deadline, it expires and the expiry is recorded in the audit.',
      ]}
      previews={[
        previewRequest({
          actor: operator.principal,
          action: spec.name,
          subjectKind: spec.subjectKind,
          subjectId: subjectId.trim().length > 0 ? subjectId.trim() : `the ${spec.subjectKind} you name above`,
          reasonCode,
        }),
      ]}
      runLabel="Raise this request"
      busy={raise.busy}
      disabledReason={incomplete.length === 0 ? null : `Still needed: ${incomplete.join(', ')}.`}
      onRun={() => void submit()}
    >
      <p className="aw-action__route">
        Executes <code className="cf-num">{spec.route}</code>
      </p>

      <label className="aw-field">
        <span className="aw-field__label">The {spec.subjectKind} this acts on</span>
        <span className="aw-field__hint">
          The id of the thing being acted on. It is a SUBJECT — this console has no way to act as
          somebody, and admin-api has no route that would.
        </span>
        <input
          className="aw-field__input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
        />
      </label>

      {spec.requiredParams.map((name) => (
        <label className="aw-field" key={name}>
          <span className="aw-field__label">
            <code className="cf-num">params.{name}</code>
          </span>
          <span className="aw-field__hint">Required by admin-api for this action.</span>
          <input
            className="aw-field__input"
            type="text"
            autoComplete="off"
            value={params[name] ?? ''}
            onChange={(e) => setParams((prev) => ({ ...prev, [name]: e.target.value }))}
          />
        </label>
      ))}

      <label className="aw-field">
        <span className="aw-field__label">Reason code</span>
        <span className="aw-field__hint">
          A closed list. The code is what a dashboard groups by; the sentence below is what a human
          reads six months later, and neither substitutes for the other.
        </span>
        <select
          className="aw-field__input"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
        >
          {reasonCodes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>

      <label className="aw-field">
        <span className="aw-field__label">Reason</span>
        <span className="aw-field__hint">
          Write it for the operator who has to decide this without you in the room.
        </span>
        <textarea
          className="aw-field__input"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      {raise.error !== null && (
        <Failed
          notice={raise.error}
          title={
            // A catalogue read a minute ago is a claim about the past: an action can be blocked
            // between the read and the write. The 501 is handled as well as pre-empted, and it
            // renders as the catalogue's sentence rather than as a server error worth retrying.
            raise.error.message.includes('cannot be executed')
              ? 'That action has no upstream, so it cannot be requested'
              : 'The request was not raised'
          }
        />
      )}
    </ReversibleAction>
  )
}

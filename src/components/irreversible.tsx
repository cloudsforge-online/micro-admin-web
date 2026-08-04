/**
 * The controls in front of an action that cannot be taken back.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS INTERFACE IS DELIBERATELY NOT FAST.
 *
 * Everything else in an operator console should get out of the way. These must not. Approving a
 * request runs a ledger reversal, a marketplace case resolution or an entitlement revocation
 * against a real upstream, and `admin-api` does not roll it back if the execution fails
 * (server.ts:753-767) — the approval stands and the failure is recorded, which is the honest
 * state and is not an undo. Rejecting a request is terminal: `decide()` refuses any transition
 * out of a decided state (approvals.ts:258-260).
 *
 * So the shape is: the consequences in SENTENCES first, then the audit rows the action will
 * write, then the facts the decision turns on, then a rationale, then a phrase the operator
 * writes out naming the request and the outcome. Not "Are you sure?" — that question has never
 * once been answered "no" by somebody who was about to make a mistake, because the person about
 * to make a mistake believes they are sure. Writing "approve 3f2a1b9c ledger.entry.reverse" is a
 * different act: it cannot be performed without reading which request and which way.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The gate itself is `confirmationGate` in lib/gate.ts — a pure function, so `test/gate.test.ts`
 * proves it refuses in every direction without rendering anything.
 */
import { useId, useState, type ReactNode } from 'react'
import { confirmationGate, type AuditPreview } from '../lib/gate.ts'
import { AuditRecordPreview } from './audit-preview.tsx'

export function IrreversibleAction({
  label,
  summary,
  consequences,
  previews = [],
  phrase,
  rationaleLabel,
  rationaleHint,
  runLabel,
  busy = false,
  onRun,
  children,
}: {
  label: string
  /** One line: what this is, before the consequences. */
  summary: string
  /** What it will do, in sentences, shown BEFORE the control. */
  consequences: readonly string[]
  /**
   * The audit rows this writes. The operator signs for a record they have read.
   *
   * Defaults to none, for the Foresight actions folded in at P13: those run against
   * `micro-foresight` and write no `admin-api` audit row at all, so they say what foresight
   * records in their own words instead. See the note in components/audit-preview.tsx.
   */
  previews?: readonly AuditPreview[]
  /** The exact words the operator must write. A `*ConfirmationPhrase()` builds it. */
  phrase: string
  rationaleLabel: string
  rationaleHint: string
  /** The button's own words, which state the CONSEQUENCE rather than the verb. */
  runLabel: string
  busy?: boolean
  onRun: (rationale: string) => void
  /** The facts this decision turns on — the request, its parameters, who raised it. */
  children?: ReactNode
}) {
  const [rationale, setRationale] = useState('')
  const [typed, setTyped] = useState('')
  const rationaleId = useId()
  const phraseId = useId()
  const gate = confirmationGate({ typed, required: phrase, rationale, busy })

  return (
    <section className="aw-danger" aria-label={label}>
      <h3 className="aw-danger__title">
        <span className="aw-danger__icon" aria-hidden="true">
          ■
        </span>
        {label} — this cannot be undone
      </h3>
      <p className="aw-danger__summary">{summary}</p>

      {/* A list, because these are separate facts and a paragraph is how three separate facts
          become one skimmed sentence. */}
      <ul className="aw-danger__consequences">
        {consequences.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {children}

      <AuditRecordPreview previews={previews} />

      <label className="aw-field" htmlFor={rationaleId}>
        <span className="aw-field__label">{rationaleLabel}</span>
        <span className="aw-field__hint">{rationaleHint}</span>
        <textarea
          id={rationaleId}
          className="aw-field__input"
          rows={3}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </label>

      <label className="aw-field" htmlFor={phraseId}>
        <span className="aw-field__label">
          To confirm, type <code className="cf-num aw-danger__phrase">{phrase}</code>
        </span>
        <span className="aw-field__hint">
          The phrase names this request and what you are about to do to it. It is not a formality:
          it is the last point at which the wrong request can be noticed.
        </span>
        <input
          id={phraseId}
          className="aw-field__input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>

      <div className="aw-danger__foot">
        <button
          type="button"
          className="cf-btn aw-btn--danger"
          disabled={!gate.ready}
          onClick={() => onRun(rationale.trim())}
        >
          {busy ? 'Working…' : runLabel}
        </button>
        {/*
          The reason the button is disabled is stated beside it, always. A disabled control with no
          explanation is a control the operator retries until they conclude the console is broken —
          and `aria-live` is what makes the reason reach somebody who is not looking at it, since
          it changes as they type.
        */}
        {gate.reason !== null && (
          <p className="aw-danger__why" aria-live="polite">
            {gate.reason}
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * The same idea, weaker, for an action that CAN be undone.
 *
 * Raising an approval request, flipping a feature flag and retracting a broadcast still say what
 * they will do and what they will record before they do it — an operator should never learn what
 * a button did by watching it happen — but they take a single confirming click, because making a
 * reversible action expensive spends the operator's attention where it is not needed and leaves
 * less of it for the places where it is.
 */
export function ReversibleAction({
  label,
  summary,
  consequences,
  previews = [],
  runLabel,
  blocked = null,
  busy = false,
  disabledReason = null,
  onRun,
  children,
}: {
  label: string
  summary: string
  consequences: readonly string[]
  /** See `IrreversibleAction`. Defaults to none for an action that writes no admin-api row. */
  previews?: readonly AuditPreview[]
  runLabel: string
  /** Set when the action is not available at all: the reason, in the operator's words. */
  blocked?: string | null
  busy?: boolean
  /** Set when the form is incomplete: what is still needed. Not the same as `blocked`. */
  disabledReason?: string | null
  onRun: () => void
  children?: ReactNode
}) {
  const [shown, setShown] = useState(false)

  return (
    <section className="aw-action" aria-label={label}>
      <div className="aw-action__head">
        <h3 className="aw-action__title">{label}</h3>
        {blocked === null ? (
          <button
            type="button"
            className="cf-btn"
            disabled={busy || (shown && disabledReason !== null)}
            onClick={() => (shown ? onRun() : setShown(true))}
          >
            {busy ? 'Working…' : shown ? runLabel : 'What will this do?'}
          </button>
        ) : (
          // NOT a disabled button. A disabled control reads as "not yet" and gets clicked at; the
          // reason takes its place instead. See lib/catalogue.ts.
          <span className="aw-action__blocked">{blocked}</span>
        )}
      </div>
      <p className="aw-action__summary">{summary}</p>
      {children}
      {shown && blocked === null && (
        <>
          <ul className="aw-action__consequences">
            {consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <AuditRecordPreview previews={previews} />
          {disabledReason !== null && (
            <p className="aw-action__why" aria-live="polite">
              {disabledReason}
            </p>
          )}
        </>
      )}
    </section>
  )
}

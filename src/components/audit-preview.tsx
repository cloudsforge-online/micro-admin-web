/**
 * What will be written to the audit, shown before the operator acts.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE AUDIT IS THE POINT OF THIS SURFACE, SO IT IS NOT A CONSEQUENCE — IT IS PART OF THE ACTION.
 *
 * Every privileged action in this estate writes an `audit_event` in the same transaction as the
 * change (SD-15), hash-chained so an edit or an interior deletion is detectable, with checkpoints
 * so a truncation is too. That record is what a dispute is settled against six months later, and
 * it names the operator.
 *
 * A console that only told an operator what an action DOES has told them half of it. The other
 * half is what the action SAYS ABOUT THEM, permanently, in a record they cannot edit — and an
 * operator should sign for a record they have read rather than one they will find later. So this
 * block appears above the confirmation control on every write in this console, not below it and
 * not behind a disclosure triangle.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The rows are reproduced from `admin-api`'s own `appendAudit` calls — see `lib/gate.ts`, where
 * each is cited against the line that writes it. Nothing here is invented, and the fields it
 * cannot know (the id of a row that does not exist yet) say so in words rather than showing a
 * plausible blank.
 */
import type { AuditPreview } from '../lib/gate.ts'

export function AuditRecordPreview({
  previews,
  title = 'What this writes to the audit',
}: {
  previews: readonly AuditPreview[]
  title?: string
}) {
  return (
    <section className="aw-audit-preview" aria-label={title}>
      <h4 className="aw-audit-preview__title">
        <span className="aw-audit-preview__icon" aria-hidden="true">
          ⛓
        </span>
        {title}
      </h4>
      <p className="aw-audit-preview__lede">
        {previews.length === 1
          ? 'One row, in the same transaction as the change. It cannot be edited or deleted afterwards without breaking the hash chain.'
          : `${previews.length} rows, hash-chained in order. They cannot be edited or deleted afterwards without breaking the chain.`}
      </p>
      <ol className="aw-audit-preview__list">
        {previews.map((preview) => (
          <li className="aw-audit-preview__row" key={`${preview.action}-${preview.subjectId}`}>
            <p className="aw-audit-preview__action cf-num">{preview.action}</p>
            <dl className="aw-facts aw-facts--tight">
              <div className="aw-facts__row">
                <dt className="aw-facts__label">actor</dt>
                <dd className="aw-facts__value cf-num">{preview.actor}</dd>
              </div>
              <div className="aw-facts__row">
                <dt className="aw-facts__label">subject</dt>
                <dd className="aw-facts__value cf-num">
                  {preview.subjectKind} · {preview.subjectId}
                </dd>
              </div>
              <div className="aw-facts__row">
                <dt className="aw-facts__label">outcome</dt>
                <dd className="aw-facts__value cf-num">{preview.outcome}</dd>
              </div>
              {preview.reasonCode !== null && (
                <div className="aw-facts__row">
                  <dt className="aw-facts__label">reason code</dt>
                  <dd className="aw-facts__value cf-num">{preview.reasonCode}</dd>
                </div>
              )}
            </dl>
            <ul className="aw-audit-preview__notes">
              {preview.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  )
}

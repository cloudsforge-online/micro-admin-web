/**
 * State, rendered as a word and a glyph before it is rendered as a colour.
 *
 * The estate's reserved status hues sit ΔE 4.6 apart under protanopia — measured in `micro-ui`,
 * and the reason `status-web` encodes each day of its uptime strip three times. So nothing in
 * this console may use colour as the channel that says whether the ledger balances, whether an
 * approval is still open, or whether the audit chain verifies.
 *
 * Every state in this bundle goes through this component, which is what makes that a property of
 * the console rather than a habit. `test/render.test.ts` asserts that the pages use it rather
 * than colouring a span by hand.
 */
import type { Tone } from '../lib/format.ts'

export function StatusWord({ tone, prefix }: { tone: Tone; prefix?: string }) {
  return (
    <span className={`aw-state aw-state--${tone.tone}`}>
      {/* Decorative: the WORD beside it is the accessible name, so a screen reader is not made to
          announce a geometric shape it cannot interpret. */}
      <span className="aw-state__glyph" aria-hidden="true">
        {tone.glyph}
      </span>
      <span className="aw-state__word">
        {prefix ? `${prefix} ` : ''}
        {tone.word}
      </span>
    </span>
  )
}

/**
 * A labelled fact with its value, for the detail lists that make up most of this console.
 *
 * `<dl>` rather than a table: these are name/value pairs and not rows of a relation, and a screen
 * reader reading a definition list announces the pairing that a div soup destroys.
 */
export function Facts({ rows }: { rows: ReadonlyArray<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="aw-facts">
      {rows.map((row) => (
        <div className="aw-facts__row" key={row.label}>
          <dt className="aw-facts__label">{row.label}</dt>
          <dd className="aw-facts__value">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * A figure that may be absent, rendered as the absence when it is.
 *
 * Never a zero standing in for a null. The `because` line is the tile's own reason, so an absence
 * names its cause rather than leaving a dash the reader has to interpret.
 */
export function Figure({
  value,
  because,
}: {
  value: string | null
  because?: string | null | undefined
}) {
  if (value === null) {
    return (
      <span className="aw-absent">
        <span className="aw-absent__word">not measured</span>
        {because ? <span className="aw-absent__why">{because}</span> : null}
      </span>
    )
  }
  return <span className="cf-num aw-figure">{value}</span>
}

/**
 * When a figure was read, always beside the figure.
 *
 * "read at", not "as at": the service stamps nothing — `GET /v1/estate` is composed live with no
 * cache, deliberately — so the only honest timestamp this bundle can attach is the moment the
 * response arrived here. See the header of lib/format.ts.
 */
export function AsOf({ label }: { label: string }) {
  return (
    <p className="aw-asof cf-num" title="the moment this browser received the answer, not the moment the fact was true">
      {label}
    </p>
  )
}

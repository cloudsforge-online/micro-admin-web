/**
 * Lifecycle state, said three ways at once.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * COLOUR IS NEVER THE CHANNEL HERE, AND THIS SURFACE HAS A SPECIFIC REASON BEYOND THE USUAL ONE.
 *
 * Forge Foresight's accent sits ΔE 7.1 from Forge Trade's teal and ΔE 8.1 from Forge Market's
 * purple under deuteranopia, because deuteranopia collapses the whole blue-teal-purple region
 * (@cloudsforge/ui surfaces.ts, "the one thing to know before using it elsewhere"). An operator
 * console that distinguished `open` from `resolved` by hue alone would be asking a reader to make
 * exactly the discrimination the palette's own note says not to rely on — about a market that is
 * either taking money or paying it out.
 *
 * So every state carries a GLYPH, a WORD and a colour, and the glyph and the word are sufficient
 * on their own.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import type { MarketStatus } from '../lib/foresight.ts'
import { LIFECYCLE_ORDER } from '../lib/lifecycle.ts'

interface StatusFace {
  readonly glyph: string
  /** One line: what this state means for money. */
  readonly meaning: string
  readonly tone: 'quiet' | 'live' | 'warn' | 'done'
}

const FACES: Readonly<Record<MarketStatus, StatusFace>> = {
  draft: { glyph: '○', meaning: 'written, nobody has approved it', tone: 'quiet' },
  approved: { glyph: '◑', meaning: 'a person has approved it; no contract yet', tone: 'quiet' },
  open: { glyph: '●', meaning: 'the contract is taking stakes', tone: 'live' },
  closed: { glyph: '◍', meaning: 'stakes are shut; the outcome is not posted', tone: 'warn' },
  resolved: { glyph: '◆', meaning: 'the outcome is on chain; the dispute window is running', tone: 'warn' },
  settled: { glyph: '◼', meaning: 'the fee is paid and winners are claiming', tone: 'done' },
  void: { glyph: '⊘', meaning: 'cancelled; every stake refunded whole, no fee', tone: 'done' },
}

export function StatusPill({ status }: { status: MarketStatus }) {
  const face = FACES[status]
  return (
    <span className={`aw-pill aw-pill--${face.tone}`}>
      <span className="aw-pill__glyph" aria-hidden="true">
        {face.glyph}
      </span>
      {status}
    </span>
  )
}

export function statusMeaning(status: MarketStatus): string {
  return FACES[status].meaning
}

/**
 * Where this market is on the line, and where it can still go.
 *
 * `void` is deliberately off the rail: it is reachable from five of the six states and drawing it
 * as a step would suggest a market passes through it on the way to somewhere. It appears as its
 * own terminal marker when it happens.
 */
export function LifecycleRail({ status }: { status: MarketStatus }) {
  if (status === 'void') {
    return (
      <p className="aw-rail aw-rail--void">
        <span className="aw-pill aw-pill--done">
          <span className="aw-pill__glyph" aria-hidden="true">
            ⊘
          </span>
          void
        </span>
        <span className="aw-rail__note">{FACES.void.meaning}</span>
      </p>
    )
  }

  const reached = LIFECYCLE_ORDER.indexOf(status)
  return (
    <ol className="aw-rail" aria-label="Lifecycle">
      {LIFECYCLE_ORDER.map((step, i) => {
        const state = i < reached ? 'past' : i === reached ? 'now' : 'ahead'
        return (
          <li className={`aw-rail__step aw-rail__step--${state}`} key={step}>
            {/* The current step is named by a word as well as by its position, because "which of
                these is highlighted" is not a question a screen reader can answer from CSS. */}
            <span className="aw-rail__mark" aria-hidden="true">
              {state === 'past' ? '✓' : state === 'now' ? FACES[step].glyph : '·'}
            </span>
            <span className="aw-rail__label">{step}</span>
            {state === 'now' && <span className="aw-sr-only"> — the market is here now</span>}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * What foresight writes down when an operator acts — the counterpart to `AuditRecordPreview`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * IT SAYS WHICH RECORD, BECAUSE AFTER THE FOLD THERE ARE TWO AND THEY ARE NOT THE SAME ONE.
 *
 * Everywhere else in this console, an action appends a hash-chained `audit_events` row through
 * `admin-api` and `AuditRecordPreview` shows it. The five market actions do not: they write
 * `market_transitions` and an outbox event inside `micro-foresight`
 * (`recordTransition`, foresight/src/markets.ts; topics at foresight/src/outbox.ts).
 *
 * An operator who has learnt that "the block above the button is the audit row" would otherwise
 * read the ABSENCE of that block as "this action is not recorded", which is false, or its presence
 * as "this is in the estate audit chain", which is also false. Naming the tables removes both
 * readings. The heading deliberately does not use the word "audit".
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function ForesightRecord({ records }: { records: readonly string[] }) {
  if (records.length === 0) return null
  return (
    <section className="aw-audit-preview" aria-label="What Foresight records">
      <h4 className="aw-audit-preview__title">
        <span className="aw-audit-preview__icon" aria-hidden="true">
          ▤
        </span>
        What Foresight records
      </h4>
      <p className="aw-audit-preview__lede">
        Written by <code className="cf-num">micro-foresight</code>, in the same transaction as the
        change. This is <strong>not</strong> the estate’s hash-chained admin audit — that chain
        covers what this console does through <code className="cf-num">admin-api</code>, and a
        market action does not go through it.
      </p>
      <ul className="aw-audit-preview__notes">
        {records.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}

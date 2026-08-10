/**
 * The engagement treasury — docs/ecosystem/21 §6's "manageable from the admin panel".
 *
 * Three reads and one write, and the write only goes DOWN:
 *
 *   `GET /v1/engagement/report`   — **admin-api/src/server.ts**. Balances read off the
 *                                   ledger, spend per service, and the transfer records. This is
 *                                   21 §6's third action, whose approval column reads "none
 *                                   (read)" — the approval queue REFUSES `engagement.report` and
 *                                   names this route, so a read never spends two signatures.
 *   `GET /v1/engagement/policies` — **admin-api/src/server.ts**. The caps and the schema
 *                                   ceilings they sit inside.
 *   `PUT /v1/engagement/policies/:service` — **admin-api/src/server.ts**. LOWER only. A raise
 *                                   answers 403 `raise_needs_approval` and names the action to
 *                                   use instead.
 *
 * ── Why this screen has no "raise" button, and says so rather than hiding it ──────────────────
 *
 * 21 §6 gives raising to `engagement.policy.set`, which is a two-operator approval. That is
 * `micro-devplatform`'s quota asymmetry (`devplatform/src/server.ts` — "the direction is the
 * authority"), and the `engagement_raise_needs_approval` trigger enforces it in the schema, so a
 * console that offered a raise button would be offering a request the estate refuses three ways.
 * An absent control that explains itself is honest; one that 403s is a bug report waiting to be
 * filed.
 *
 * ── Why the panel is a view of the LEDGER, not of a balance column ────────────────────────────
 *
 * 21 §4: "an auditor reconstructs the entire programme from the ledger alone". The balances here
 * come from `micro-ledger` through admin-api, and the transfer rows beside them say only WHICH
 * approval authorised each one. Nothing on this screen is a number this console computed.
 */
import { useCallback, useState } from 'react'
import {
  loadEngagementPolicies,
  loadEngagementReport,
  lowerEngagementPolicy,
  type EngagementPolicies,
  type EngagementReport,
} from '../lib/admin.ts'
import { asOfLabel, formatWei, groupDigits, timestamp } from '../lib/format.ts'
import { previewEngagementLower } from '../lib/gate.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { useSession } from '../lib/auth.tsx'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { AsOf } from '../components/tone.tsx'
import { ReversibleAction } from '../components/irreversible.tsx'

/**
 * Wei as EMBER, EXACTLY — every digit, with only the trailing zeros dropped.
 *
 * The wire carries decimal strings because these amounts are `bigint` in every service that
 * touches them (`docs/ecosystem/21 §2` — "bounded, disclosed, and denominated in EMBER"), and a
 * JSON number near an amount is the defect this estate does not have. `formatWei` is string and
 * bigint work throughout, so an amount too large for a double still renders exactly.
 *
 * `maxDecimals: 18` rather than the pool screens' 4: a pool is a magnitude an operator eyeballs,
 * while this screen is 21 §4's reconstruction of a programme — a treasury figure quietly cut
 * three decimals short is a figure that will not add up against the ledger it was read from.
 *
 * The unit was Shards until 2026-08-10 (micro-org#226); see `lib/admin.ts`.
 */
function ember(value: string): string {
  return formatWei(value, { maxDecimals: 18 }) ?? value
}

/** Basis points as a percentage, without floating point: 250 → "2.5%". */
export function bpsLabel(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const fraction = Math.abs(bps % 100)
  return fraction === 0 ? `${whole}%` : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}%`
}

export function EngagementPage() {
  const [readAt, setReadAt] = useState<Date | null>(null)

  const loadAll = useCallback(async (signal: AbortSignal) => {
    const [report, policies] = await Promise.all([
      loadEngagementReport({ signal }),
      loadEngagementPolicies({ signal }),
    ])
    setReadAt(new Date())
    return { report, policies }
  }, [])

  const view = useResource<{ report: EngagementReport; policies: EngagementPolicies }>(
    loadAll,
    (v) => v.policies.policies.length,
    'The engagement treasury could not be read.',
  )
  const now = new Date()

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Engagement treasury</h1>
        <p className="aw-page-lede">
          What the platform has set aside to make empty rooms work, what each service may draw,
          and what it has drawn. Every figure here is read off the ledger — nothing on this page
          is a number this console keeps.
        </p>
      </header>

      <div className="aw-toolbar">
        {readAt !== null && <AsOf label={asOfLabel(readAt, now)} />}
        <button type="button" className="cf-btn cf-btn--quiet" onClick={view.reload}>
          Read again
        </button>
      </div>

      {view.state === 'loading' && <Loading label="Reading the treasury" />}
      {view.state === 'forbidden' && <Forbidden notice={view.error ?? undefined} />}
      {view.state === 'failed' && view.error !== null && (
        <Failed notice={view.error} onRetry={view.reload} title="The treasury did not load" />
      )}
      {view.state === 'empty' && (
        <Empty
          title="No service has an engagement cap yet"
          hint="Nothing may move before the caps exist (21 §8). Raise the first one through engagement.policy.set in the approval queue — it needs two operators."
        />
      )}

      {view.state === 'ok' && view.data !== null && (
        <EngagementBody
          report={view.data.report}
          policies={view.data.policies}
          onDone={view.reload}
        />
      )}
    </>
  )
}

function EngagementBody({
  report,
  policies,
  onDone,
}: {
  report: EngagementReport
  policies: EngagementPolicies
  onDone: () => void
}) {
  // EMBER, and only EMBER: the ledger keys an account on (subject, asset_code, purpose), so a
  // balance in any other asset under this subject is a DIFFERENT account and adding it here would
  // report two treasuries as one. There has never been more than the one (micro-org#226).
  const emberOf = (balances: readonly { assetCode: string; amount: string }[]): string =>
    balances.find((b) => b.assetCode === 'EMBER')?.amount ?? '0'

  return (
    <>
      {/* ── The §4 tree: the treasury, then the per-service accounts it funds. ── */}
      <section className="aw-section">
        <h2 className="aw-section__title">The accounts</h2>
        <p className="aw-section__lede">
          Ordinary <code>micro-ledger</code> accounts — no service holds this money. Funded by
          published platform mining and, once volume exists, a share of fee revenue.
        </p>
        <dl className="aw-facts">
          <div className="aw-facts__row">
            <dt className="aw-facts__label">{report.treasury.subject}</dt>
            <dd className="aw-facts__value cf-num">
              <strong>{ember(emberOf(report.treasury.balances))}</strong> EMBER
            </dd>
          </div>
          {report.services.map((service) => (
            <div className="aw-facts__row" key={service.subject}>
              <dt className="aw-facts__label">└ {service.subject}</dt>
              <dd className="aw-facts__value cf-num">
                <strong>{ember(emberOf(service.balances))}</strong> EMBER
                {report.spendWeiByService[service.service] !== undefined && (
                  <> · {ember(report.spendWeiByService[service.service]!)} transferred in</>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── The caps, per service, with the one control this console owns. ── */}
      <section className="aw-section">
        <h2 className="aw-section__title">The caps</h2>
        <p className="aw-section__lede">
          The most one approved transfer may move into each service. Lowering takes one operator
          and happens here; <strong>raising takes two</strong> and happens through{' '}
          <code>engagement.policy.set</code> in the approval queue — the schema refuses a raise
          that arrives any other way.
        </p>
        {policies.policies.map((policy) => (
          <CapRow
            key={policy.service}
            service={policy.service}
            what="the transfer cap"
            currentLabel={`${ember(policy.transferCapWei)} EMBER`}
            current={policy.transferCapWei}
            ceilingLabel={`${ember(policies.ceilings.transferCapWei)} EMBER`}
            lastChangedBy={policy.updatedBy}
            lastChangedAt={policy.updatedAt}
            onDone={onDone}
            toBody={(next) => ({ transferCapWei: next })}
          />
        ))}
      </section>

      {/* ── The fee recycle: one platform-wide number, same asymmetry. ── */}
      <section className="aw-section">
        <h2 className="aw-section__title">The fee recycle</h2>
        <p className="aw-section__lede">
          The share of platform fee revenue that posts back to the treasury each period, so the
          programme eventually funds itself from the activity it seeded. It starts at nothing —
          pure mined funding until revenue exists.
        </p>
        <CapRow
          service="platform"
          what="the fee-recycle share"
          currentLabel={bpsLabel(policies.feeRecycle.recycleBps)}
          current={String(policies.feeRecycle.recycleBps)}
          ceilingLabel={bpsLabel(policies.ceilings.feeRecycleBps)}
          lastChangedBy={policies.feeRecycle.updatedBy}
          lastChangedAt={policies.feeRecycle.updatedAt}
          onDone={onDone}
          toBody={(next) => ({ recycleBps: next })}
          unit="basis points"
          inEmber={false}
        />
      </section>

      {/* ── What actually moved, and which approval authorised it. ── */}
      <section className="aw-section">
        <h2 className="aw-section__title">Transfers</h2>
        {report.transfers.length === 0 ? (
          <Empty
            title="Nothing has moved yet"
            hint="A transfer appears here once two operators approve an engagement.transfer."
          />
        ) : (
          <table className="aw-table">
            <thead>
              <tr>
                <th scope="col">service</th>
                <th scope="col">EMBER</th>
                <th scope="col">state</th>
                <th scope="col">ledger entry</th>
                <th scope="col">approval</th>
              </tr>
            </thead>
            <tbody>
              {report.transfers.map((t) => (
                <tr key={t.id}>
                  <td>{t.service}</td>
                  <td className="cf-num">{ember(t.amountWei)}</td>
                  <td>{t.state}</td>
                  {/* A posted transfer names the entry that moved it; the schema makes the pair
                      one fact, so a blank here can only mean "still in flight". */}
                  <td className="cf-num">{t.ledgerEntryId ?? '—'}</td>
                  <td className="cf-num">{t.approvalId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

/**
 * One cap, with a lowering control.
 *
 * The control refuses to submit a value that is not strictly lower, and says why rather than
 * letting the operator discover it from a 403. That is not a substitute for the server's refusal
 * — `admin-api` and the `engagement_raise_needs_approval` trigger both refuse a raise — it is so
 * the operator learns the rule before they act on it.
 */
function CapRow({
  service,
  what,
  currentLabel,
  current,
  ceilingLabel,
  lastChangedBy,
  lastChangedAt,
  onDone,
  toBody,
  unit = 'wei',
  inEmber = true,
}: {
  service: string
  what: string
  currentLabel: string
  current: string
  ceilingLabel: string
  lastChangedBy: string | null
  lastChangedAt: string | null
  onDone: () => void
  toBody: (next: string) => Record<string, string>
  unit?: string
  /** Does a typed figure mean wei? The fee-recycle share is basis points and does not. */
  inEmber?: boolean
}) {
  const { operator } = useSession()
  const [next, setNext] = useState('')

  const wellFormed = /^\d+$/.test(next)
  // Compared as BIGINT, never as a Number: a cap in wei is routinely past 2^53 — the ceiling
  // alone is 4e25 — and a comparison that has been through a double is a comparison against a
  // number nobody typed.
  const isLower = wellFormed && BigInt(next) < BigInt(current)
  const disabledReason = !wellFormed
    ? `Type the new ${unit} value.`
    : !isLower
      ? `That is not lower than ${currentLabel}. Raising takes two operators — use engagement.policy.set in the approval queue.`
      : null

  const lower = useMutation<[], unknown>(
    async () => lowerEngagementPolicy(service, toBody(next)),
    'The cap could not be lowered.',
  )

  const run = async () => {
    const result = await lower.run()
    if (result !== null) {
      setNext('')
      onDone()
    }
  }

  return (
    <ReversibleAction
      label={service}
      summary={`${what} is ${currentLabel}`}
      consequences={[
        `Every write path is bound by this immediately — the cap is a schema constraint, not a rule in this console.`,
        'Lowering takes one operator. Raising it back takes two, through engagement.policy.set.',
        'A transfer already approved but not yet executed will be refused by the cap if it now exceeds it.',
      ]}
      previews={[
        previewEngagementLower({
          actor: operator.principal,
          service,
          what,
          from: currentLabel,
          to: wellFormed ? `${groupDigits(next)} ${unit}${inEmber ? ` (${ember(next)} EMBER)` : ''}` : '(not set)',
        }),
      ]}
      runLabel="Lower"
      busy={lower.busy}
      {...(disabledReason !== null ? { disabledReason } : {})}
      onRun={() => void run()}
    >
      <dl className="aw-facts aw-facts--tight">
        <div className="aw-facts__row">
          <dt className="aw-facts__label">now</dt>
          <dd className="aw-facts__value cf-num">
            <strong>{currentLabel}</strong>
          </dd>
        </div>
        <div className="aw-facts__row">
          <dt className="aw-facts__label">schema ceiling</dt>
          <dd className="aw-facts__value cf-num">{ceilingLabel}</dd>
        </div>
        {lastChangedAt !== null && (
          <div className="aw-facts__row">
            <dt className="aw-facts__label">last changed</dt>
            <dd className="aw-facts__value cf-num">
              {timestamp(lastChangedAt)}
              {lastChangedBy !== null && <> by {lastChangedBy}</>}
            </dd>
          </div>
        )}
      </dl>
      <label className="aw-field">
        <span className="aw-field__label">new value ({unit})</span>
        <input
          className="aw-field__input cf-num"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          inputMode="numeric"
          placeholder={current}
        />
        {/* The field takes the WIRE unit, because that is what the schema stores and what the
            refusal messages quote. An operator who types the EMBER figure by mistake would be
            typing something 1e18 too small — which is a LOWER value, so nothing would refuse it.
            The echo is how they see that before they press the button, not after. */}
        {inEmber && wellFormed && (
          <span className="aw-field__hint cf-num">= {ember(next)} EMBER</span>
        )}
      </label>
    </ReversibleAction>
  )
}

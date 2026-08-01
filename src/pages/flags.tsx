/**
 * Feature flags.
 *
 * `GET /v1/flags` — **admin-api/src/server.ts:774**.
 * `PUT /v1/flags/:key` — **admin-api/src/server.ts:780**. `enabled` must be a boolean
 * (server.ts:785), and `description` and `owner` are required non-empty strings (server.ts:793-794
 * via `requireString`, and again in `setFlag` at flags.ts:99-104 with the reason: "a flag nobody
 * owns is a flag nobody switches on").
 *
 * **No `Idempotency-Key` on this route, deliberately.** It is an upsert keyed on the flag key, and
 * it is exempt in `admin-api/src/routeidempotency.test.ts:35-37` with the reason recorded there:
 * a retry writes the same row, and the audit records the value BEFORE and AFTER, so a replayed
 * no-op is visible as one rather than as a second change.
 *
 * ── Why a flag is a reversible action and gets the weaker gate ────────────────────────────────
 *
 * Flipping a flag back is a flip. It still says what it will do and what it will record before it
 * does either — an operator should never learn what a button did by watching it happen — but it
 * does not demand a typed phrase. Spending an operator's attention on a reversible action leaves
 * less of it for the two places in this console where an action cannot be taken back.
 */
import { useCallback, useState } from 'react'
import { loadFlags, setFlag, type FeatureFlag } from '../lib/admin.ts'
import { asOfLabel, timestamp } from '../lib/format.ts'
import { previewFlag } from '../lib/gate.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { useSession } from '../lib/auth.tsx'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { AsOf } from '../components/tone.tsx'
import { ReversibleAction } from '../components/irreversible.tsx'

export function FlagsPage() {
  const [readAt, setReadAt] = useState<Date | null>(null)
  const load = useCallback(async (signal: AbortSignal) => {
    const result = await loadFlags({ signal })
    setReadAt(new Date())
    return result.flags
  }, [])
  const flags = useResource<readonly FeatureFlag[]>(
    load,
    (rows) => rows.length,
    'The feature flags could not be loaded.',
  )
  const now = new Date()

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Feature flags</h1>
        <p className="aw-page-lede">
          Every change records the value before and after, so the record says what it was until
          now — not only what it is.
        </p>
      </header>

      <div className="aw-toolbar">
        {readAt !== null && <AsOf label={asOfLabel(readAt, now)} />}
        <button type="button" className="cf-btn cf-btn--quiet" onClick={flags.reload}>
          Read again
        </button>
      </div>

      {flags.state === 'loading' && <Loading label="Reading the flags" />}
      {flags.state === 'forbidden' && <Forbidden notice={flags.error ?? undefined} />}
      {flags.state === 'failed' && flags.error !== null && (
        <Failed notice={flags.error} onRetry={flags.reload} title="The flags did not load" />
      )}
      {flags.state === 'empty' && (
        <Empty
          title="No feature flags are declared"
          hint="A flag appears here the first time one is written. Every flag needs an owner and a description — a flag nobody owns is a flag nobody switches on."
        />
      )}

      {flags.state === 'ok' &&
        flags.data !== null &&
        flags.data.map((flag) => <FlagRow key={flag.key} flag={flag} onDone={flags.reload} />)}
    </>
  )
}

function FlagRow({ flag, onDone }: { flag: FeatureFlag; onDone: () => void }) {
  const { operator } = useSession()
  const next = !flag.enabled

  const flip = useMutation<[], { flag: FeatureFlag; changed: boolean }>(
    async () =>
      setFlag(flag.key, {
        enabled: next,
        // Carried forward unchanged: this control flips a boolean, and silently rewriting a
        // description or an owner as a side effect of that would be a second change the operator
        // did not ask for and the audit would attribute to them.
        description: flag.description,
        owner: flag.owner,
      }),
    'The flag could not be changed.',
  )

  const run = async () => {
    const result = await flip.run()
    if (result !== null) onDone()
  }

  return (
    <ReversibleAction
      label={flag.key}
      summary={flag.description}
      consequences={[
        `It becomes ${next ? 'ON' : 'OFF'} for everything that reads it, immediately.`,
        'An admin.flag.changed event is emitted whether or not the boolean moved, so anything downstream sees the change.',
        'This can be flipped back. The record of both flips stays.',
      ]}
      previews={[
        previewFlag({ actor: operator.principal, key: flag.key, exists: true, enabled: flag.enabled }),
      ]}
      runLabel={`Turn ${next ? 'on' : 'off'}`}
      busy={flip.busy}
      onRun={() => void run()}
    >
      <dl className="aw-facts aw-facts--tight">
        <div className="aw-facts__row">
          <dt className="aw-facts__label">now</dt>
          <dd className="aw-facts__value">
            {/* A word, never a colour or a bare switch: "on" and "off" is the fact, and a toggle
                that shows only its own position tells a colour-blind reader nothing. */}
            <strong className={flag.enabled ? 'aw-on' : 'aw-off'}>
              {flag.enabled ? 'ON' : 'OFF'}
            </strong>
          </dd>
        </div>
        <div className="aw-facts__row">
          <dt className="aw-facts__label">owner</dt>
          <dd className="aw-facts__value cf-num">{flag.owner}</dd>
        </div>
        <div className="aw-facts__row">
          <dt className="aw-facts__label">last changed</dt>
          <dd className="aw-facts__value cf-num">
            {timestamp(flag.updatedAt)} by {flag.updatedBy}
          </dd>
        </div>
      </dl>
      {flip.error !== null && <Failed notice={flip.error} title="The flag was not changed" />}
    </ReversibleAction>
  )
}

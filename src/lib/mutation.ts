/**
 * Running one write, and being honest about the three ways it can end.
 *
 * `useResource` covers reads. A write needs different answers: it is not running until somebody
 * asks, only one may be in flight at a time, and its failure belongs beside the control that
 * caused it rather than in place of the page.
 *
 * ── Why `busy` is not merely cosmetic here ────────────────────────────────────────────────────
 *
 * Two of the writes this app makes are irreversible and one of them — `POST /markets/:id/deploy`
 * — creates a contract. A double click that fires two requests is exactly the shape the service's
 * idempotency key exists to survive, and surviving it is not a reason to cause it. So the hook
 * refuses to start a second run while one is in flight, and `confirmationGate` reads the same
 * flag so the confirm button is disabled rather than merely ignored.
 */
import { useCallback, useState } from 'react'
import { noticeFor, type ErrorNotice } from './api.ts'

export interface Mutation<A extends unknown[], T> {
  readonly busy: boolean
  readonly error: ErrorNotice | null
  /** The last successful result, kept so a 202 acceptance can be rendered after the fact. */
  readonly result: T | null
  readonly run: (...args: A) => Promise<T | null>
  readonly reset: () => void
}

export function useMutation<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
  fallbackMessage: string,
): Mutation<A, T> {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorNotice | null>(null)
  const [result, setResult] = useState<T | null>(null)

  const run = useCallback(
    async (...args: A): Promise<T | null> => {
      // Read from state rather than a ref on purpose: React batches the `setBusy(true)` below
      // before the next click can be processed, and a ref here would make this hook's behaviour
      // depend on scheduling rather than on state anybody can see.
      if (busy) return null
      setBusy(true)
      setError(null)
      try {
        const value = await fn(...args)
        setResult(value)
        return value
      } catch (err) {
        setError(noticeFor(err, fallbackMessage))
        return null
      } finally {
        setBusy(false)
      }
    },
    [busy, fn, fallbackMessage],
  )

  const reset = useCallback(() => {
    setError(null)
    setResult(null)
  }, [])

  return { busy, error, result, run, reset }
}

/**
 * A fresh idempotency key for one deploy attempt.
 *
 * ── It is minted per MARKET, not per click ────────────────────────────────────────────────────
 *
 * `POST /markets/:id/deploy` requires an `Idempotency-Key` of 8 to 200 characters
 * (foresight/src/server.ts:832-838), and its whole purpose is that a retry after a lost response
 * presents THE SAME key and gets the same answer instead of a second contract. A key generated
 * inside the click handler would make every retry a fresh operation — which is the failure the
 * header exists to prevent, implemented by the client that was supposed to prevent it.
 *
 * So the key is derived from the market id and held for the life of the page. Reloading the page
 * mints a new one, which is correct: a reload is a new intention, and the service's own
 * `not_approved` check refuses a second deploy for a market that already has a contract anyway
 * (server.ts:684-686).
 */
export function deployKeyFor(marketId: string, mintedAt: number): string {
  return `deploy-${marketId}-${mintedAt.toString(36)}`
}

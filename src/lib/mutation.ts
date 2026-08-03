/**
 * Running one write, and being honest about the three ways it can end.
 *
 * `useResource` covers reads. A write needs different answers: it is not running until somebody
 * asks, only one may be in flight at a time, and its failure belongs beside the control that
 * caused it rather than in place of the page.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ── THE GUARD IS A REF, AND WAS ONCE A PIECE OF STATE ─────────────────────────────────────────
 *
 * This file used to read `if (busy) return null` out of the render closure, under a comment
 * asserting that "React batches the `setBusy(true)` below before the next click can be
 * processed." **It does not.** `setBusy(true)` only SCHEDULES a render; two clicks dispatched in
 * one tick both read `busy === false` from their own closures and both start a run.
 * `disabled={busy}` has the identical hole from the other end — the attribute is not on the DOM
 * node until the render commits, and the second event was dispatched before that.
 *
 * The same comment, and the same defect, was copy-pasted across this estate's frontends. The
 * previous sweep found all sixteen spending actions in five money-moving apps going out twice.
 *
 * ── WHAT THE SECOND REQUEST COSTS ON AN OPERATOR CONSOLE ──────────────────────────────────────
 *
 * Not a duplicate artefact, on the three routes that carry an `Idempotency-Key`: admin-api's
 * `withIdempotency` (`admin-api/src/idempotency.ts:9-17`) makes a concurrent duplicate BLOCK on
 * the first transaction's uncommitted row and then replay its stored response. That half is
 * already right and this hook must not break it.
 *
 * What it costs is a LIE ABOUT THE OUTCOME on the routes that carry no key, and the sharpest is
 * `DELETE /v1/broadcasts/:id`. The service's own comment (`admin-api/src/broadcasts.ts:178-180`)
 * says a second retraction "is not an error the operator needs to see as a failure — the
 * broadcast is retracted either way" — and then throws `broadcast <id> is already retracted`,
 * because it must not write a second audit row. A same-tick double click therefore lands one
 * success and one refusal, and whichever resolves last wins the hook's state. The operator is
 * told **"The broadcast could not be retracted."** about a broadcast that IS retracted, during
 * the incident that made them retract it. An operator acting on that false negative is the
 * damage; the only way not to be that client is not to send the second request.
 *
 * So: the latch is taken SYNCHRONOUSLY, before the first `await`, and released in `finally` so a
 * throw cannot wedge the control. `busy` survives as affordance only — a label and a `disabled`
 * attribute — and is never the guard.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useRef, useState } from 'react'
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
  // Not `useState`: the whole point is a value written and read in the same tick.
  //
  // Under `<StrictMode>` (src/main.tsx:29) React double-invokes the component function on mount,
  // so this initialiser runs twice and one of the two refs is discarded. That is harmless — both
  // start `false`, and from the first commit onwards there is exactly one ref, which is the one
  // both clicks of a double click read. `test/double-submit.test.ts` proves every scenario in
  // both modes, because a guard that has only ever run outside StrictMode is a guard that has
  // never run the way this app runs it.
  const latch = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorNotice | null>(null)
  const [result, setResult] = useState<T | null>(null)

  const run = useCallback(
    async (...args: A): Promise<T | null> => {
      // Synchronous, and before the first `await`. `busy` is affordance, never the guard.
      if (latch.current) return null
      latch.current = true
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
        // The ref first, and both in the `finally`. Releasing after the `try` instead would leave
        // the control permanently dead the first time the work threw — the failure mode that gets
        // a latch deleted rather than fixed.
        latch.current = false
        setBusy(false)
      }
    },
    [fn, fallbackMessage],
  )

  const reset = useCallback(() => {
    setError(null)
    setResult(null)
  }, [])

  return { busy, error, result, run, reset }
}

/*
 * `deployKeyFor` used to live here. It was dead code and it was evidence: this console talks to
 * admin-api, has no markets and never deployed a contract, yet the function and its doc block
 * cited `foresight/src/server.ts:832-838` — because this whole file was copied from
 * micro-foresight-admin-web, false comment and all. The key minting this app really does is
 * `idempotencyKeyFor` in `lib/gate.ts`, which is per page view rather than per click.
 */

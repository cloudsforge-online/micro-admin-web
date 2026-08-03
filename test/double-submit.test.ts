/**
 * Two events in one tick, on every control in this console that writes.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE EXISTS FOR
 *
 *   A GUARD WRITTEN AS COMPONENT STATE CANNOT SEE A SECOND EVENT IN THE SAME TICK.
 *
 * `src/lib/mutation.ts` used to read `if (busy) return null` out of the render closure, under a
 * comment that actively defended it — "React batches the `setBusy(true)` below before the next
 * click can be processed." It does not. `setBusy(true)` SCHEDULES a render; two clicks dispatched
 * before React commits both read `busy === false` from their own closures and both start a run.
 * `disabled={busy}` has the same hole from the other end: the attribute is not on the DOM node
 * until the render commits, and the second event was already dispatched.
 *
 * The comment, and the defect, were copy-pasted across this estate's frontends — including into
 * THIS repository, which inherited a `deployKeyFor` helper citing `foresight/src/server.ts` for a
 * console that has no markets and never deployed a contract.
 *
 * ── WHY THIS IS THE CLIENT'S BUSINESS AND NOT THE SERVICE'S ───────────────────────────────────
 *
 * Doc 22 §3 forbids a browser scenario from asserting a business rule, and collapsing duplicates
 * IS a service's rule. HOW MANY TIMES A BROWSER SENDS is not: it is the one thing about a
 * duplicate that is squarely the client's own, which is why it belongs here and not in admin-api.
 *
 * ── WHAT THE SECOND REQUEST ACTUALLY COSTS ON THIS SURFACE ────────────────────────────────────
 *
 * Three of this console's writes carry an `Idempotency-Key` minted per PAGE VIEW rather than per
 * click (`idempotencyKeyFor`, src/lib/gate.ts:376), so both same-tick attempts present the same
 * key and `admin-api`'s wrapper collapses them: it "blocks rather than races" and the duplicate
 * replays the stored response (`admin-api/src/idempotency.ts:9-17`). That half was already right
 * and these scenarios must not break it.
 *
 * The damage is on the two writes that carry NO key, and the sharpest is retraction.
 * `admin-api/src/broadcasts.ts:169-184` claims the row `where retracted_at is null`, and its own
 * comment says a second attempt "is not an error the operator needs to see as a failure — the
 * broadcast is retracted either way" — and then throws, because it must not write a second audit
 * row. It is right to throw. The client is what turns that into a sentence.
 *
 * So a same-tick double click lands one success and one refusal, and the refusal reaches
 * `retract.error`, which `BroadcastRow` renders as "The broadcast was not retracted" — a failure
 * reported over a success, on an operator console, during the incident that made them retract it.
 *
 * **On this page that sentence is then masked**, and by accident rather than by design: the
 * winner's reload unmounts the row and takes the error with it. That is checked rather than
 * assumed, and written up at the point where the scenario for it would otherwise be — see "WHY
 * THERE IS NO 'THE OPERATOR IS TOLD A FAILURE' SCENARIO" below. The provable defect here is
 * therefore the request count, and this file asserts only what it can actually fail on.
 *
 * ── AND BOTH WAYS ROUND ───────────────────────────────────────────────────────────────────────
 *
 * `src/main.tsx:29` renders under `<StrictMode>`; this harness mounted without it until this file
 * added `strict`. A ref latch is CREATED TWICE on a StrictMode mount, so a guard proven only in
 * the plain mode has never been run the way the app runs it. Every proof below runs twice.
 *
 * **And `strict` is itself proven**, by the meta-test at the top. Three repos in the previous
 * sweep shipped a mutation that made `strict: true` a no-op and survived it, which means their
 * paired tests had been silent duplicates all along. A meta-test is the only thing that stops
 * this file becoming the same test written twice.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, useRef, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { useMutation } from '../src/lib/mutation.ts'
import { BroadcastsPage } from '../src/pages/broadcasts.tsx'
import { FlagsPage } from '../src/pages/flags.tsx'

const ORIGIN = 'https://admin.cloudsforge.online'

/** A signed-in operator: both tokens present, and `/auth/me` answered. */
const SIGNED_IN = { 'cf.accessToken': 'a-test-access-token', 'cf.refreshToken': 'a-test-refresh-token' }

const ME: Routes = {
  'GET /auth/me': {
    body: {
      user: { id: 'op-1', handle: 'avery', principal: 'operator:avery', roles: ['admin:operator'] },
    },
  },
}

/** The message an assertion prints when a control sent twice. */
const once = (what: string, n: number, cost: string): string =>
  `${what} left the browser ${n} times for ONE double click. ` +
  `A guard read from component state cannot see the second event in the same tick — take the ` +
  `latch in a ref before the first await. ${cost}`

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   THE META-TEST. Without this, everything below is one test written twice.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('the `strict` option really is StrictMode', () => {
  /**
   * A probe that counts its own render passes into a box the test owns.
   *
   * StrictMode double-invokes the component function on mount. So the count MUST differ between
   * the two modes — and asserting "differs" rather than an exact number keeps this honest across
   * React versions without pinning it to an implementation detail.
   */
  const Probe = ({ box }: { box: { passes: number } }): ReactElement => {
    box.passes += 1
    return h('p', null, 'A probe with enough text to clear the forty-character floor this harness enforces.')
  }

  it('double-invokes the component function under strict, and does not without it', async () => {
    const plain = { passes: 0 }
    const strict = { passes: 0 }

    await withScreen(h(Probe, { box: plain }), { url: ORIGIN }, async () => undefined)
    await withScreen(h(Probe, { box: strict }), { url: ORIGIN, strict: true }, async () => undefined)

    assert.ok(plain.passes > 0, 'the plain probe never rendered at all')
    assert.ok(
      strict.passes > plain.passes,
      `\`strict: true\` did not change how the tree was rendered: ${plain.passes} render pass(es) ` +
        `plain and ${strict.passes} under strict. The option is a no-op, which means every ` +
        `"under StrictMode" scenario in this file is a silent duplicate of its plain twin and ` +
        `proves nothing. This is the exact failure three repos shipped in the previous sweep.`,
    )
  })

  it('a ref survives the StrictMode double-invocation, which is why the latch may be one', async () => {
    // Both initialisers run on a StrictMode mount and one ref is discarded. From the first commit
    // there is exactly one, and it is the one both clicks of a double click read. This scenario
    // states that in code so the claim in `mutation.ts` is not merely a comment.
    const seen: unknown[] = []
    const Probe = (): ReactElement => {
      const ref = useRef({})
      seen.push(ref.current)
      return h('p', null, 'A probe with enough text to clear the forty-character floor this harness enforces.')
    }
    await withScreen(h(Probe), { url: ORIGIN, strict: true }, async () => undefined)
    assert.ok(seen.length >= 2, 'the probe did not render twice, so this proves nothing about strict')
    assert.equal(
      new Set(seen).size,
      1,
      'the committed tree kept more than one ref identity, so a latch in a ref would not be shared ' +
        'between two clicks of a double click',
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   THE HOOK ITSELF, at its narrowest — one button, one counter, nothing else in the way.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

for (const strict of [false, true]) {
  const mode = strict ? 'under StrictMode' : 'plain'

  describe(`useMutation runs once per double click — ${mode}`, () => {
    it(`starts one run, not two (${mode})`, async () => {
      const box = { runs: 0 }
      const Probe = (): ReactElement => {
        const m = useMutation(async () => {
          box.runs += 1
          await new Promise((r) => setTimeout(r, 30))
          return 'done'
        }, 'It did not work.')
        return h(
          'div',
          null,
          h('button', { type: 'button', onClick: () => void m.run() }, 'Do the thing'),
          h('p', null, m.busy ? 'Working…' : 'Idle, and long enough to clear the floor.'),
        )
      }

      await withScreen(h(Probe), { url: ORIGIN, strict }, async (s) => {
        const button = s.byRole('button', 'Do the thing')
        s.clickNoFlush(button)
        s.clickNoFlush(button)
        await s.settle(5)
        // Mid-flight the affordance HAS committed — `busy` is still worth setting, it is just not
        // the guard. Asserting it here is what stops a "fix" that deletes `busy` altogether.
        assert.match(s.text(), /Working…/, 'the busy affordance never rendered')
        await s.settle(60)
        assert.equal(box.runs, 1, once('the work', box.runs, 'One press is one run.'))
      })
    })

    it(`releases the latch when the work throws, so the control is not wedged (${mode})`, async () => {
      // The failure mode that gets a latch deleted rather than fixed: released after the `try`
      // instead of in `finally`, the first throw kills the button for the life of the page.
      const box = { runs: 0 }
      const Probe = (): ReactElement => {
        const m = useMutation(async () => {
          box.runs += 1
          await new Promise((r) => setTimeout(r, 5))
          throw new Error('the upstream is unreachable')
        }, 'It did not work.')
        return h(
          'div',
          null,
          h('button', { type: 'button', onClick: () => void m.run() }, 'Do the thing'),
          h('p', null, 'Idle, and long enough to clear the forty-character floor.'),
        )
      }

      await withScreen(h(Probe), { url: ORIGIN, strict }, async (s) => {
        const button = s.byRole('button', 'Do the thing')
        await s.click(button)
        await s.settle(20)
        await s.click(button)
        await s.settle(20)
        assert.equal(
          box.runs,
          2,
          `the second press did not run: the latch was not released after a throw, so one failed ` +
            `attempt wedges this control for the life of the page (${box.runs} run(s))`,
        )
      })
    })
  })
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   THE REAL SCREENS.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

const broadcast = (over: Record<string, unknown> = {}) => ({
  id: 'bc-1',
  severity: 'warn',
  title: 'Settlement is degraded',
  body: 'Withdrawals are queued and will drain when the indexer catches up.',
  startsAt: '2026-08-03T09:00:00.000Z',
  endsAt: null,
  publishedBy: 'operator:avery',
  publishedAt: '2026-08-03T09:00:00.000Z',
  retractedAt: null,
  retractedBy: null,
  ...over,
})

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, element))

/**
 * Reveal one `ReversibleAction`'s real control: the first press only explains it.
 *
 * Scoped to the `<section aria-label={label}>` that `ReversibleAction` renders, because a page
 * carries several of these — `/broadcasts` has the composer and one per row — and an unscoped
 * `byRole('button', 'What will this do?')` would be ambiguous on exactly the pages that matter.
 */
async function reveal(s: Screen, actionLabel: string): Promise<Element> {
  const sections = s.allByRole('region').filter((el) => el.getAttribute('aria-label') === actionLabel)
  assert.equal(sections.length, 1, `expected one action labelled "${actionLabel}", found ${sections.length}`)
  const section = sections[0] as Element
  const control = (): Element => {
    const buttons = Array.from(section.querySelectorAll('button'))
    assert.equal(buttons.length, 1, `"${actionLabel}" has ${buttons.length} buttons, expected its one control`)
    return buttons[0] as Element
  }
  await s.click(control())
  // The same node, now labelled with the run label rather than the explainer.
  return control()
}

for (const strict of [false, true]) {
  const mode = strict ? 'under StrictMode' : 'plain'

  describe(`one press is one write — ${mode}`, () => {
    /* ── the un-keyed state transition, which is where the lie was ──────────────────────────── */

    it(`retracting a broadcast sends one DELETE, not two (${mode})`, async () => {
      const path = 'DELETE /v1/broadcasts/bc-1'
      await withScreen(
        page(h(BroadcastsPage), '/broadcasts'),
        {
          url: `${ORIGIN}/broadcasts`,
          strict,
          storage: SIGNED_IN,
          routes: {
            ...ME,
            'GET /v1/broadcasts': { body: { broadcasts: [broadcast()] } },
            // The service's real behaviour: the first claims the row, the second finds it already
            // claimed and is refused. A stub that answered both the same way would let this
            // scenario pass against the defect.
            [path]: (_w, n) =>
              n === 1
                ? { body: { broadcast: broadcast({ retractedAt: '2026-08-03T10:00:00.000Z' }) }, delayMs: 30 }
                : {
                    status: 409,
                    body: { error: { code: 'conflict', message: 'broadcast bc-1 is already retracted' } },
                    delayMs: 30,
                  },
          },
        },
        async (s) => {
          const button = await reveal(s, 'Settlement is degraded')
          s.clickNoFlush(button)
          s.clickNoFlush(button)
          await s.settle(90)

          const sent = s.api.matching(path)
          assert.equal(
            sent.length,
            1,
            once(
              'a retraction',
              sent.length,
              'The loser is refused with "already retracted" and resolves last, so the operator ' +
                'is told the retraction failed while the broadcast is down.',
            ),
          )
        },
      )
    })

    /*
     * ── WHY THERE IS NO "THE OPERATOR IS TOLD A FAILURE" SCENARIO FOR RETRACTION ─────────────
     *
     * There was one, and it could not fail, so it is not here. The reason is worth recording
     * because it is luck rather than design.
     *
     * Under the defect the loser's 409 DOES reach `retract.error`, and `BroadcastRow` renders
     * `<Failed title="The broadcast was not retracted">` for it (src/pages/broadcasts.tsx:240).
     * But the winner's success calls `onRetracted()` -> `list.reload()`, and `useResource`'s
     * reload sets `loading` (src/lib/resource.ts:81) — which drops `BroadcastsPage` out of its
     * `state === 'ok'` branch, UNMOUNTS every row, and takes the error state with it. The row
     * remounts fresh, so what an operator ends up looking at is the truth: "Retracted … A second
     * retraction claims no row and is refused."
     *
     * So on this console the lie is masked, by a reload that exists for an unrelated reason. An
     * assertion aimed at it would pass against the defect and prove nothing — the vacuous kind
     * of green this file's meta-test exists to refuse. The provable defect HERE is the request
     * count above; the visible-lie proof lives in `micro-devportal-web`, where a duplicate
     * destroys a credential and nothing masks it.
     */

    /* ── the keyed write: one key, and one request ──────────────────────────────────────────── */

    it(`publishing a broadcast sends one POST, not two (${mode})`, async () => {
      const path = 'POST /v1/broadcasts'
      await withScreen(
        page(h(BroadcastsPage), '/broadcasts'),
        {
          url: `${ORIGIN}/broadcasts`,
          strict,
          storage: SIGNED_IN,
          routes: {
            ...ME,
            'GET /v1/broadcasts': { body: { broadcasts: [] } },
            [path]: (_w, n) => ({
              status: n === 1 ? 201 : 200,
              body: { broadcast: broadcast({ id: 'bc-new' }) },
              delayMs: 30,
            }),
          },
        },
        async (s) => {
          await s.type(s.byRole('textbox', 'Title'), 'Settlement is degraded')
          await s.type(s.byRole('textbox', 'Body'), 'Withdrawals are queued and will drain shortly.')
          const button = await reveal(s, 'Publish a broadcast')
          s.clickNoFlush(button)
          s.clickNoFlush(button)
          await s.settle(90)

          const sent = s.api.matching(path)
          assert.equal(
            sent.length,
            1,
            once('a broadcast', sent.length, 'Every operator in the estate is notified once.'),
          )
          // And the key half stays right: whatever went out carried one.
          const key = sent[0]?.headers?.['idempotency-key']
          assert.ok(
            typeof key === 'string' && key.length >= 8,
            `the published broadcast carried no usable Idempotency-Key (${String(key)}), which is ` +
              `what admin-api/src/server.ts:1031 requires and what makes a genuine RETRY safe`,
          )
        },
      )
    })

    /* ── the upsert, which is harmless at the service and still wrong to send twice ─────────── */

    it(`flipping a flag sends one PUT, not two (${mode})`, async () => {
      const path = 'PUT /v1/flags/checkout.enabled'
      await withScreen(
        page(h(FlagsPage), '/flags'),
        {
          url: `${ORIGIN}/flags`,
          strict,
          storage: SIGNED_IN,
          routes: {
            ...ME,
            'GET /v1/flags': {
              body: {
                flags: [
                  {
                    key: 'checkout.enabled',
                    enabled: true,
                    description: 'Whether checkout accepts new orders.',
                    owner: 'team:payments',
                    updatedAt: '2026-08-01T09:00:00.000Z',
                    updatedBy: 'operator:avery',
                  },
                ],
              },
            },
            // `changed` is the service's own answer to "did the value actually move". The second
            // write of a pair moves nothing, and an audit that records two operator actions for
            // one intent is the cost here even though no artefact is duplicated.
            [path]: (_w, n) => ({
              body: {
                flag: {
                  key: 'checkout.enabled',
                  enabled: false,
                  description: 'Whether checkout accepts new orders.',
                  owner: 'team:payments',
                  updatedAt: '2026-08-03T10:00:00.000Z',
                  updatedBy: 'operator:avery',
                },
                changed: n === 1,
              },
              delayMs: 30,
            }),
          },
        },
        async (s) => {
          const button = await reveal(s, 'checkout.enabled')
          s.clickNoFlush(button)
          s.clickNoFlush(button)
          await s.settle(90)

          const sent = s.api.matching(path)
          assert.equal(
            sent.length,
            1,
            once(
              'a flag change',
              sent.length,
              'The upsert survives it; the audit records two operator actions for one intent.',
            ),
          )
        },
      )
    })
  })
}

/**
 * The two-operator approval gate, DRIVEN, inside the shell the design system rebuilt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A DESIGN-SYSTEM CHANGE HAD TO BE PROVEN AGAINST THIS SCREEN SPECIFICALLY
 *
 * The shell's `<main>` was replaced, the skip link was replaced, a component was appended after
 * the footer and a `useEffect` that writes to `document.head` was added to the frame every page
 * renders inside. None of that is supposed to reach the approval gate. "Supposed to" is the state
 * this repository's own comments say is not a mechanism.
 *
 * And what is at stake here is not layout. `admin-api` does not roll a failed execution back
 * (server.ts) and `decide()` refuses any transition out of a decided state
 * (approvals.ts), so an approval is a thing that happens once. The controls in front of it
 * are deliberately slow, and every one of them is a thing that could be silently loosened by an
 * edit somewhere else:
 *
 *   - the button is DISABLED until the operator has written a rationale AND typed a phrase naming
 *     this request and this outcome;
 *   - the reason it is disabled is stated beside it, in a live region, as they type;
 *   - an operator who RAISED the request is not offered the control at all, and is told why.
 *
 * `test/gate.test.ts` proves `confirmationGate` and `decisionGate` as functions, in every
 * direction, and it is the right layer for the rules. What it cannot prove is that the rules are
 * still WIRED to the button after the frame around them changed — which is exactly the class of
 * defect a shell edit produces. This file mounts the real page inside the real shell and presses
 * the real controls.
 *
 * Per doc 22 §3, nothing here asserts a business rule against the API. The gate is a CLIENT
 * control and the service enforces four-eyes independently three times over (the route, the
 * UPDATE's `and requested_by <> $operator`, and the `approvals_no_self_approval` CHECK). What is
 * asserted is what an operator can and cannot do with the keyboard in front of them.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { withScreen, type Routes as ApiRoutes, type Screen } from './dom.ts'
import { AppShell } from '../src/components/shell.tsx'
import { ApprovalPage } from '../src/pages/approval.tsx'
import { AuthProvider } from '../src/lib/auth.tsx'
import { confirmationPhrase } from '../src/lib/gate.ts'
import type { Approval } from '../src/lib/admin.ts'

const ORIGIN = 'https://admin.cloudsforge.online'
const APPROVAL_ID = '3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'
const ACTION = 'ledger.entry.reverse'
const RAISER = 'user:11111111-2222-3333-4444-555555555555'
const ME = 'user:99999999-8888-7777-6666-555555555555'

/** A pending request, far from its deadline, raised by somebody else. */
function pending(over: Partial<Approval> = {}): Approval {
  const hourFromNow = new Date(Date.now() + 3_600_000).toISOString()
  return {
    id: APPROVAL_ID,
    action: ACTION,
    subjectKind: 'ledger_entry',
    subjectId: 'entry-1',
    params: { amount: '10.00' },
    reasonCode: 'operator_error',
    reason: 'Duplicate posting reported by settlement.',
    requestedBy: RAISER,
    requestedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: hourFromNow,
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    executedAt: null,
    executionOutcome: null,
    executionDetail: null,
    correlationId: null,
    ...over,
  }
}

/**
 * The page at its own address, inside the REAL shell.
 *
 * The shell is what this file is here to keep honest, so it is mounted rather than skipped — a
 * scenario that rendered `ApprovalPage` alone would pass whatever the shell did to it.
 */
const consoleAt = (approval: Approval): ReactElement =>
  h(
    MemoryRouter,
    { initialEntries: [`/approvals/${approval.id}`] },
    h(
      AuthProvider,
      null,
      h(
        Routes,
        null,
        h(Route, {
          path: '/',
          element: h(AppShell, null),
          children: [
            h(Route, { key: 'a', path: 'approvals/:id', element: h(ApprovalPage, null) }),
          ],
        } as never),
      ),
    ),
  )

/** The console signed in as `who`, with the request and the identity call answered. */
function asOperator(who: string, approval: Approval): { routes: ApiRoutes; storage: Record<string, string> } {
  return {
    routes: {
      [`GET /v1/approvals/${approval.id}`]: () => ({ body: { approval } }),
      'GET /auth/me': () => ({ body: { user: { id: who.replace('user:', ''), roles: ['admin'] } } }),
    },
    storage: { 'cf.access': 'token', 'cf.refresh': 'token' },
  }
}

/** The Approve control's button, by its own words — which state the consequence, not the verb. */
function approveButton(s: Screen): Element {
  return s.byRole('button', new RegExp(`Approve and run ${ACTION}`))
}

/**
 * The phrase field belonging to ONE of the two gates.
 *
 * There are two `IrreversibleAction`s on this page — Approve and Reject — and each has a rationale
 * field and a phrase field, so "the confirmation field" is four controls rather than one. They are
 * told apart by the phrase each ASKS FOR, which is the only thing that distinguishes them and is
 * also the property under test: a field addressed by anything else could be the wrong gate's, and a
 * scenario that typed the approve phrase into the reject gate would pass while proving nothing.
 */
function phraseFieldFor(s: Screen, phrase: string): Element {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return s.byRole('textbox', new RegExp(`To confirm, type ${escaped}`))
}

describe('the typed confirmation phrase still gates the button', () => {
  it('refuses with nothing typed, and says what is missing', async () => {
    const approval = pending()
    await withScreen(consoleAt(approval), { url: `${ORIGIN}/approvals/${approval.id}`, ...asOperator(ME, approval) }, async (s) => {
      await s.settle()
      const button = approveButton(s)
      assert.equal(button.hasAttribute('disabled'), true, 'the approve button is live before anything was typed')
      // The reason is stated beside it rather than left to be guessed. A disabled control with no
      // explanation is a control an operator retries until they conclude the console is broken.
      assert.match(s.text(), /say what this decision is based on/)
    })
  })

  it('is still refused with a rationale but the WRONG phrase', async () => {
    const approval = pending()
    await withScreen(consoleAt(approval), { url: `${ORIGIN}/approvals/${approval.id}`, ...asOperator(ME, approval) }, async (s) => {
      await s.settle()
      await s.type(s.byRole('textbox', /Why are you approving this\?/), 'settlement confirmed the duplicate')
      await s.type(phraseFieldFor(s, confirmationPhrase(true, approval.id, approval.action)), 'approve')
      assert.equal(approveButton(s).hasAttribute('disabled'), true, 'a partial phrase unlocked the decision')
      // And the reason has CHANGED to the phrase, which is what makes the live region worth having.
      assert.match(s.text(), /type .?approve/)
    })
  })

  it('is refused by the phrase for the OTHER direction — the fact a misclick gets wrong', async () => {
    /*
     * The whole argument for a phrase over "Are you sure?". Typing the reject phrase into the
     * approve control must not approve anything: the phrase names the request AND the outcome, and
     * this is the assertion that the outcome half is load-bearing.
     */
    const approval = pending()
    await withScreen(consoleAt(approval), { url: `${ORIGIN}/approvals/${approval.id}`, ...asOperator(ME, approval) }, async (s) => {
      await s.settle()
      await s.type(s.byRole('textbox', /Why are you approving this\?/), 'settlement confirmed the duplicate')
      await s.type(
        phraseFieldFor(s, confirmationPhrase(true, approval.id, approval.action)),
        confirmationPhrase(false, approval.id, approval.action),
      )
      assert.equal(approveButton(s).hasAttribute('disabled'), true, 'the reject phrase unlocked the approve control')
    })
  })

  it('opens ONLY when the rationale and the exact phrase are both present', async () => {
    const approval = pending()
    await withScreen(consoleAt(approval), { url: `${ORIGIN}/approvals/${approval.id}`, ...asOperator(ME, approval) }, async (s) => {
      await s.settle()
      await s.type(s.byRole('textbox', /Why are you approving this\?/), 'settlement confirmed the duplicate')
      const phrase = confirmationPhrase(true, approval.id, approval.action)
      await s.type(phraseFieldFor(s, phrase), phrase)
      assert.equal(approveButton(s).hasAttribute('disabled'), false, 'the decision stayed locked with both halves supplied')
    })
  })

  it('shows the operator the phrase they have to write, naming this request and this outcome', async () => {
    const approval = pending()
    await withScreen(consoleAt(approval), { url: `${ORIGIN}/approvals/${approval.id}`, ...asOperator(ME, approval) }, async (s) => {
      await s.settle()
      const phrase = confirmationPhrase(true, approval.id, approval.action)
      assert.ok(s.text().includes(phrase), `the console never shows the phrase "${phrase}"`)
      // The short id, not the whole uuid: long enough that two rows in one queue cannot collide,
      // short enough to be typed without a mistake that reads as a refusal to confirm.
      assert.ok(phrase.includes(approval.id.slice(0, 8)))
      assert.ok(phrase.includes(approval.action))
    })
  })

/* ── the consequences are read before the control, not after it ──────────────────────────── */
  it('states what approving will do, in sentences, above the phrase field', async () => {
    const approval = pending()
    await withScreen(consoleAt(approval), { url: `${ORIGIN}/approvals/${approval.id}`, ...asOperator(ME, approval) }, async (s) => {
      await s.settle()
      // The one an operator most needs to have read: a failed execution is NOT an undo.
      assert.match(s.text(), /the approval still stands and the failure is recorded/)
      s.before('the approval still stands', 'To confirm, type', 'the consequences are below the confirmation field')
    })
  })

  it('names the action in the button itself, so the button states the consequence', async () => {
    const approval = pending()
    await withScreen(consoleAt(approval), { url: `${ORIGIN}/approvals/${approval.id}`, ...asOperator(ME, approval) }, async (s) => {
      await s.settle()
      assert.match(s.textOf(approveButton(s)), new RegExp(ACTION))
    })
  })

  it('keeps the whole gate inside the skip link’s target region', async () => {
    /*
     * The shell change, checked where it could have gone wrong. `MainRegion` replaced a
     * hand-written `<main>`; if the outlet had ended up beside it rather than inside it, the skip
     * link would land an operator on an empty landmark and every screen in this console would sit
     * outside the page's main region — invisible to this suite and obvious to a screen reader.
     */
    const approval = pending()
    await withScreen(consoleAt(approval), { url: `${ORIGIN}/approvals/${approval.id}`, ...asOperator(ME, approval) }, async (s) => {
      await s.settle()
      const main = s.document.querySelector('main')
      assert.ok(main)
      assert.match(s.textOf(main), /To confirm, type/)
    })
  })
})

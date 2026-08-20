/**
 * The folded Foresight screens, DRIVEN — mounted in a DOM, against a stubbed foresight.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A RENDERING TEST AND NOT A SOURCE-TEXT ONE, FOR THESE FOUR SCREENS SPECIFICALLY.
 *
 * `render.test.ts` states the house position: there is no DOM in most of this suite, because a
 * test that renders a component in happy-dom proves the component renders in happy-dom. That
 * position is right for a screen whose requirement is "is this wired to the right data".
 *
 * It is not sufficient for a FOLD. Everything asserted elsewhere in this repository was written
 * against these screens as they existed in another bundle, with another stylesheet, another
 * `format.ts`, another `mutation.ts` and another confirmation gate. The risk of this change is not
 * that a page asks for the wrong field — the ported client and its own suite cover that — it is
 * that a page does not MOUNT AT ALL here: an import that resolved in the old tree and not this
 * one, a hook that came from a module that no longer exports it, a CSS class whose absence hides a
 * control, a `LifecycleAction` handed to a component that now wants flat props.
 *
 * Every one of those is a runtime failure and every one of them typechecks. So these four scenarios
 * do the one thing a source-text test cannot: they run the screen.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── Doc 22 §3, which applies here too: a browser scenario may never assert a business rule ────
 *
 * Nothing below asserts that foresight refuses anything, that an operator lacks a role, or that a
 * transition is illegal. Those are the SERVICE's rules — `requireAdmin` at foresight/src/server.ts
 * :649, 660, 681, 704, 714, 732, 772, 859, 899, 927, 957, 976 — and a stub that answered 200 to a
 * request the real service would refuse would make such an assertion pass against the defect. What
 * is asserted here is presentation relative to what the stub returned IN THE SAME RUN, and the
 * absence of the two things a fold breaks: a blank page, and a console error.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h } from 'react'
import { MemoryRouter, Route, Routes as RouterRoutes } from 'react-router-dom'

import { withScreen, type Routes } from './dom.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { ForesightSection } from '../src/components/foresight-section.tsx'
import { CategoriesPage } from '../src/pages/foresight/categories.tsx'
import { MarketPage } from '../src/pages/foresight/market.tsx'
import { MarketsPage } from '../src/pages/foresight/markets.tsx'
import { QueuePage } from '../src/pages/foresight/queue.tsx'

/** This console's own origin. The Foresight API is therefore CROSS-origin, as in production. */
const ORIGIN = 'https://admin.cloudsforge.online'
/** Where `cloudsforgeHosts()` resolves foresight from that origin. Never written by hand below. */
const FORESIGHT = 'https://cloudsforge.online/foresight'

const MARKET_ID = '3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'
const IDEA_ID = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a'

const SIGNED_IN = { 'cf.accessToken': 'a1', 'cf.refreshToken': 'r1' }

/** `/auth/me`, in the NESTED shape identity really sends (identity/src/server.ts). */
const me = {
  status: 200,
  body: { user: { id: 'operator-uuid', handle: 'sam', roles: ['admin'] } },
}

const IDEA = {
  id: IDEA_ID,
  status: 'proposed',
  question: 'Will block 9,000,000 be mined before 2027-01-01?',
  resolutionCriteria: 'YES if the Hearth explorer shows height >= 9000000 at the close time.',
  category: 'protocol_network',
  categoryVersion: 3,
  resolutionSourceKind: 'block_explorer',
  resolutionSourceRef: 'https://explorer.example/height',
  suggestedCloseTime: '2027-01-01T00:00:00.000Z',
  origin: 'model',
  searchQuery: 'hearth block height forecast',
  sources: [
    { url: 'https://explorer.example/height', title: 'Hearth explorer', retrievedAt: '2026-07-31T14:22:00.000Z' },
  ],
  modelId: 'a-model',
  promptSha256: 'abc123',
  proposedAt: '2026-07-31T14:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  refusalId: null,
}

const MARKET = {
  id: MARKET_ID,
  status: 'closed',
  question: 'Will block 9,000,000 be mined before 2027-01-01?',
  resolutionCriteria: 'YES if the explorer shows height >= 9000000 at the close time.',
  category: 'protocol_network',
  categoryVersion: 3,
  resolutionSourceKind: 'block_explorer',
  resolutionSourceRef: 'https://explorer.example/height',
  questionHash: '0xfeed',
  closeTime: '2026-12-31T00:00:00.000Z',
  disputeWindowSeconds: 172_800,
  feeBps: 250,
  chain: 'hearth',
  network: 'testnet',
  contractAddress: '0x00000000000000000000000000000000000000ab',
  outcome: null,
  voidReason: null,
  openedAt: '2026-07-01T00:00:00.000Z',
  closedAt: '2026-12-31T00:00:00.000Z',
  resolvedAt: null,
  settledAt: null,
  voidedAt: null,
}

/**
 * A pool with real wei amounts.
 *
 * `yes` is deliberately larger than 2^53, which is the whole reason `formatWei` is string
 * arithmetic: a pool that went through a double would render a different number here, and this
 * scenario would see it.
 */
const POOL = {
  yes: '1234567890123456789012',
  no: '500000000000000000000',
  total: '1734567890123456789012',
  yesBps: 7117,
  noBps: 2883,
  stakerCount: 12,
  asOf: '2026-12-31T01:00:00.000Z',
  lastBlock: 900,
  tipBlock: 902,
  behindBlocks: 2,
  stale: false,
}

const CATEGORIES = {
  status: 200,
  body: {
    version: 3,
    categories: [
      {
        id: 'protocol_network',
        title: 'Protocols and networks',
        description: 'Facts about public systems with public records.',
        sourceKinds: ['block_explorer', 'chain_rpc'],
      },
    ],
    refusals: [{ id: 'unverifiable_resolution', reason: 'no public record could settle it' }],
  },
}

/**
 * The tree under test: one Foresight screen, at a real address, with a real session provider.
 *
 * ── The route PATTERN is declared, not just the address ──────────────────────────────────────
 *
 * `MarketPage` reads its market id with `useParams()`, which is populated by the matched route's
 * pattern rather than by the URL alone. Mounting the component directly under a `MemoryRouter` —
 * the obvious shape — gives it an EMPTY id, so it requests `/markets/` and renders the failure
 * state, and a scenario that only checked "something rendered" would pass against that. So the
 * pattern is declared here exactly as `app.tsx` declares it, and the id arrives the same way it
 * does in the browser.
 *
 * `AuthProvider` is included rather than stubbed because it is what issues `/auth/me`; a fold that
 * broke the session wiring would otherwise render a signed-out shell and still look fine.
 */
function screenFor(page: ReturnType<typeof h>, pattern: string, at: string) {
  return h(
    MemoryRouter,
    { initialEntries: [at] },
    h(
      AuthProvider,
      null,
      h(RouterRoutes, null, h(Route, { path: pattern, element: page })),
    ),
  )
}

/**
 * The same, wrapped in the section layout, so the second-level nav is part of the tree.
 *
 * No `pattern` parameter: the section's own path is fixed at `/foresight` and the page mounts as
 * its INDEX, which is exactly how `app.tsx` nests it. A parameter here would be a knob with one
 * possible value.
 */
function section(page: ReturnType<typeof h>, at: string) {
  return h(
    MemoryRouter,
    { initialEntries: [at] },
    h(
      AuthProvider,
      null,
      h(
        RouterRoutes,
        null,
        h(Route, { path: '/foresight', element: h(ForesightSection) }, h(Route, { index: true, element: page })),
      ),
    ),
  )
}

describe('the idea queue renders against a stubbed foresight', () => {
  it('mounts, asks foresight cross-origin, and shows the proposal it was given', async () => {
    const routes: Routes = {
      'GET /auth/me': me,
      'GET /ideas': { status: 200, body: { ideas: [IDEA] } },
      'GET /categories': CATEGORIES,
    }
    await withScreen(
      screenFor(h(QueuePage), '/foresight', '/foresight'),
      { url: `${ORIGIN}/foresight`, routes, storage: SIGNED_IN },
      async (s) => {
        // Presentation relative to what the stub returned in THIS run.
        assert.ok(s.text().includes(IDEA.question), 'the proposal question is not on the page')
        assert.ok(s.text().includes(IDEA.category), 'the category is not shown')

        // THE FOLD'S OWN PROPERTY: the request left for foresight's origin, not this console's.
        // Asserted against `cloudsforgeHosts()`'s answer rather than a literal, so a registry
        // change moves both together.
        const asked = s.api.matching('GET /ideas')
        assert.equal(asked.length, 1, `asked for the queue ${asked.length} times`)
        // ── THE BASE, NOT THE ORIGIN — WAVE 3i ──────────────────────────────────────────────
        //
        // `FORESIGHT` is `<apex>/foresight` now, and an origin never carries a path. Comparing
        // the origin alone would ALSO pass for the thirteen other surfaces on that apex, and for
        // this console itself if it ever moved there — which is precisely what this assertion
        // exists to rule out.
        const called = new URL(asked[0]!.url, ORIGIN)
        assert.ok(
          `${called.origin}${called.pathname}`.startsWith(FORESIGHT),
          `the queue was requested from ${called.origin}${called.pathname}, not from ${FORESIGHT}`,
        )
        s.clean('the idea queue')
      },
    )
  })

  it('offers the cited source as a link, because that is what the approval gate turns on', async () => {
    const routes: Routes = {
      'GET /auth/me': me,
      'GET /ideas': { status: 200, body: { ideas: [IDEA] } },
      'GET /categories': CATEGORIES,
    }
    await withScreen(
      screenFor(h(QueuePage), '/foresight', '/foresight'),
      { url: `${ORIGIN}/foresight`, routes, storage: SIGNED_IN },
      async (s) => {
        // Not a business-rule assertion: it does not claim the gate refuses. It claims the control
        // the gate depends on is on the page at all, which is a fold question — `Sources` reaches
        // `safeHref`, which moved into this console's format.ts.
        assert.ok(
          s.queryByRole('button', /cited source/i),
          'the sources control is missing, so the approval gate can never be released',
        )
        s.clean('the idea queue sources')
      },
    )
  })
})

describe('the markets list renders', () => {
  it('mounts and shows the market it was given, with its contract', async () => {
    const routes: Routes = {
      'GET /auth/me': me,
      'GET /markets': { status: 200, body: { markets: [MARKET] } },
    }
    await withScreen(
      screenFor(h(MarketsPage), '/foresight/markets', '/foresight/markets'),
      { url: `${ORIGIN}/foresight/markets`, routes, storage: SIGNED_IN },
      async (s) => {
        assert.ok(s.text().includes(MARKET.question), 'the market is not listed')
        assert.ok(s.text().includes(MARKET.contractAddress), 'the contract address is not shown')
        // The link into the detail page is what makes the section a section rather than a screen.
        const link = s.queryByRole('link', MARKET.question)
        assert.ok(link, 'the market is not followable')
        assert.equal(
          link.getAttribute('href'),
          `/foresight/markets/${MARKET_ID}`,
          'the detail link does not point inside the folded section',
        )
        s.clean('the markets list')
      },
    )
  })
})

describe('the market detail renders, including the two irreversible controls', () => {
  it('mounts the whole page — the screen with the most moving parts in the fold', async () => {
    const routes: Routes = {
      'GET /auth/me': me,
      [`GET /markets/${MARKET_ID}/resolution`]: { status: 404, body: { error: { code: 'not_found', message: 'none planned' } } },
      [`GET /markets/${MARKET_ID}`]: {
        status: 200,
        body: {
          market: MARKET,
          pool: POOL,
          document: { canonical: 'question: ...', hash: '0xfeed' },
          provenance: {
            origin: 'model',
            searchQuery: 'hearth block height forecast',
            sources: IDEA.sources,
            modelId: 'a-model',
            promptSha256: 'abc123',
            proposedAt: '2026-07-31T14:00:00.000Z',
          },
        },
      },
    }
    await withScreen(
      screenFor(h(MarketPage), '/foresight/markets/:id', `/foresight/markets/${MARKET_ID}`),
      { url: `${ORIGIN}/foresight/markets/${MARKET_ID}`, routes, storage: SIGNED_IN },
      async (s) => {
        assert.ok(s.text().includes(MARKET.question), 'the market question is not on the page')

        // The pool figure, formatted by string arithmetic. 1234567890123456789012 wei is
        // 1,234.5678 EMBER; a double would not produce those digits. This is the one assertion in
        // the file that would catch `formatWei` having been wired to the wrong helper in the move.
        assert.ok(
          s.text().includes('1,234.5678'),
          `the YES pool did not render as exact EMBER — got: ${s.text().slice(0, 400)}`,
        )

        // Both irreversible controls exist and are DISTINCT. The market is `closed`, so resolve is
        // available and void is blocked (it has a contract) — but this asserts only that the page
        // rendered two different blocks, not that foresight would accept either.
        assert.ok(s.text().includes('cannot be undone'), 'no irreversible control rendered')

        // The record block that replaced the admin audit preview on these screens.
        assert.ok(
          s.text().includes('What Foresight records'),
          'the folded screens do not say where their record goes',
        )
        // And it must NOT claim the estate's admin audit chain.
        assert.ok(
          !s.text().includes('What this writes to the audit'),
          'a market action claims an admin-api audit row it does not write',
        )
        s.clean('the market detail')
      },
    )
  })
})

describe('the allowlist renders', () => {
  it('mounts and shows both the categories and the refusals', async () => {
    const routes: Routes = { 'GET /auth/me': me, 'GET /categories': CATEGORIES }
    await withScreen(
      screenFor(h(CategoriesPage), '/foresight/categories', '/foresight/categories'),
      { url: `${ORIGIN}/foresight/categories`, routes, storage: SIGNED_IN },
      async (s) => {
        assert.ok(s.text().includes('Protocols and networks'), 'the category is not shown')
        assert.ok(
          s.text().includes('no public record could settle it'),
          'the refusal list is not shown, and it is what an approver is agreeing they checked',
        )
        s.clean('the allowlist')
      },
    )
  })
})

describe('the section navigation', () => {
  it('renders all three screens as links inside /foresight', async () => {
    await withScreen(
      section(h(QueuePage), '/foresight'),
      {
        url: `${ORIGIN}/foresight`,
        routes: { 'GET /auth/me': me },
        storage: SIGNED_IN,
        mountedText: /Idea queue/,
      },
      async (s) => {
        for (const [label, href] of [
          ['Idea queue', '/foresight'],
          ['Markets', '/foresight/markets'],
          ['What we will run', '/foresight/categories'],
        ] as const) {
          const link = s.queryByRole('link', label)
          assert.ok(link, `the section nav has no ${label} link`)
          assert.equal(link.getAttribute('href'), href, `${label} points outside the section`)
        }
        s.clean('the foresight section nav')
      },
    )
  })
})

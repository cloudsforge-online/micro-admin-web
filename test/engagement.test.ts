/**
 * The engagement treasury screen, read the way an operator reads it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL, GIVEN `render.test.ts` ALREADY ASSERTS AGAINST THE SOURCE
 *
 * micro-org#226 changed the UNIT this screen renders, not its wiring. `admin-api` migration 13
 * moved the engagement programme off the retired `SHARD` and into EMBER wei, so
 * `transferCapShards`, `amountShards` and `spendShardsByService` became `transferCapWei`,
 * `amountWei` and `spendWeiByService`, and every figure on the wire is now 1e18 times larger for
 * the same money.
 *
 * TypeScript catches the renamed fields. It cannot catch the unit: a page that printed
 * `40000000000000000000` beside the word "EMBER" would compile, and would tell an operator the
 * treasury holds forty billion billion EMBER when it holds forty. That is a property of the
 * rendered text and of nothing else, which is what doc 22 §3.1 allows a DOM scenario to assert.
 *
 * The rule from `test/backups.test.ts` holds here too: **no scenario asserts a business rule.**
 * Whether a raise is refused is `admin-api`'s and the schema's; nothing below claims it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes as StubRoutes } from './dom.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { EngagementPage } from '../src/pages/engagement.tsx'
import type { EngagementPolicies, EngagementReport } from '../src/lib/admin.ts'

const ORIGIN = 'https://admin.cloudsforge.online'

const SIGNED_IN = {
  'cf.accessToken': 'a-test-access-token',
  'cf.refreshToken': 'a-test-refresh-token',
}

const ME: StubRoutes = {
  'GET /auth/me': {
    body: {
      user: { id: 'op-1', handle: 'avery', principal: 'operator:avery', roles: ['admin:operator'] },
    },
  },
}

/** One EMBER is 1e18 wei — the same constant `admin-api`'s migration 13 converts at. */
const wei = (whole: bigint): string => (whole * 1_000_000_000_000_000_000n).toString()

const TREASURY = 'platform:engagement-treasury'

const report = (over: Partial<EngagementReport> = {}): EngagementReport => ({
  treasury: {
    subject: TREASURY,
    balances: [
      {
        subject: TREASURY,
        assetCode: 'EMBER',
        purpose: 'treasury',
        type: 'equity',
        status: 'open',
        amount: wei(40n),
      },
    ],
  },
  services: [
    {
      service: 'foresight',
      subject: 'engagement:foresight',
      balances: [
        {
          subject: 'engagement:foresight',
          assetCode: 'EMBER',
          purpose: 'treasury',
          type: 'equity',
          status: 'open',
          amount: wei(24n),
        },
      ],
    },
  ],
  spendWeiByService: { foresight: wei(24n) },
  transfers: [
    {
      id: 'transfer-1',
      service: 'foresight',
      amountWei: wei(24n),
      approvalId: 'approval-1',
      ledgerEntryId: 'entry-1',
      state: 'posted',
      createdAt: '2026-08-10T09:00:00.000Z',
      postedAt: '2026-08-10T09:00:01.000Z',
    },
  ],
  policies: [],
  feeRecycle: { recycleBps: 0, lastChangeApprovalId: null, updatedAt: null, updatedBy: null },
  ...over,
})

const policies = (over: Partial<EngagementPolicies> = {}): EngagementPolicies => ({
  policies: [
    {
      service: 'foresight',
      transferCapWei: wei(1_000n),
      seedPerMarketWei: null,
      seedPerDayWei: null,
      lastChangeApprovalId: 'approval-0',
      updatedAt: '2026-08-10T08:00:00.000Z',
      updatedBy: 'user:avery',
    },
  ],
  feeRecycle: { recycleBps: 0, lastChangeApprovalId: null, updatedAt: null, updatedBy: null },
  ceilings: {
    // 4e25 wei = 40,000,000 EMBER — `engagement_policies_cap_within_ceiling`, migration 13.
    transferCapWei: '40000000000000000000000000',
    seedPerMarketWei: '1000000000000000000000',
    seedPerDayWei: '10000000000000000000000',
    feeRecycleBps: 2500,
  },
  ...over,
})

const routes = (over: { report?: EngagementReport; policies?: EngagementPolicies } = {}): StubRoutes => ({
  ...ME,
  'GET /v1/engagement/report': { body: over.report ?? report() },
  'GET /v1/engagement/policies': { body: over.policies ?? policies() },
})

const pageAt = (): ReactElement =>
  h(MemoryRouter, { initialEntries: ['/engagement'] }, h(AuthProvider, null, h(EngagementPage)))

describe('the engagement treasury is denominated in EMBER, and rendered in EMBER', () => {
  it('renders a wei balance as EMBER, not as its own wei figure', async () => {
    const r = report()
    const raw = r.treasury.balances[0]!.amount
    await withScreen(
      pageAt(),
      { url: `${ORIGIN}/engagement`, storage: SIGNED_IN, routes: routes({ report: r }) },
      async (s) => {
        const body = s.textOf(s.document.body)
        assert.match(body, /40 EMBER/)
        // The failure this scenario exists for: nineteen digits printed beside a unit name.
        assert.equal(body.includes(raw), false, 'the raw wei figure reached the page')
        assert.equal(body.includes('Shard'), false, 'a retired asset is still named on screen')
      },
    )
  })

  it('reads the balance by asset code, so another asset under the same subject is not counted', async () => {
    // The ledger keys an account on (subject, asset_code, purpose): a SHARD balance under this
    // subject is a DIFFERENT account, and adding it in would report two treasuries as one.
    const r = report()
    const withShard = report({
      treasury: {
        subject: TREASURY,
        balances: [
          {
            subject: TREASURY,
            assetCode: 'SHARD',
            purpose: 'treasury',
            type: 'equity',
            status: 'open',
            amount: '999',
          },
          ...r.treasury.balances,
        ],
      },
    })
    await withScreen(
      pageAt(),
      { url: `${ORIGIN}/engagement`, storage: SIGNED_IN, routes: routes({ report: withShard }) },
      async (s) => {
        const body = s.textOf(s.document.body)
        assert.match(body, /40 EMBER/)
        assert.equal(body.includes('999'), false, 'a balance in another asset was rendered')
      },
    )
  })

  it('renders the cap and the schema ceiling the service sent, in EMBER', async () => {
    const p = policies()
    await withScreen(
      pageAt(),
      { url: `${ORIGIN}/engagement`, storage: SIGNED_IN, routes: routes({ policies: p }) },
      async (s) => {
        const body = s.textOf(s.document.body)
        assert.match(body, /1,000 EMBER/)
        // 4e25 wei, read off the fixture rather than written out twice.
        assert.equal(BigInt(p.ceilings.transferCapWei), 40_000_000n * 10n ** 18n)
        assert.match(body, /40,000,000 EMBER/)
      },
    )
  })

  it('renders a transfer amount exactly, digit for digit, rather than to four places', async () => {
    // 21 §4: an auditor reconstructs the programme from the ledger. A figure quietly cut short on
    // the way to the screen is a figure that will not add up against the entry it came from.
    const odd = (24n * 10n ** 18n + 123_456_789n).toString()
    const r = report({
      transfers: [
        {
          id: 'transfer-1',
          service: 'foresight',
          amountWei: odd,
          approvalId: 'approval-1',
          ledgerEntryId: 'entry-1',
          state: 'posted',
          createdAt: '2026-08-10T09:00:00.000Z',
          postedAt: '2026-08-10T09:00:01.000Z',
        },
      ],
    })
    await withScreen(
      pageAt(),
      { url: `${ORIGIN}/engagement`, storage: SIGNED_IN, routes: routes({ report: r }) },
      async (s) => {
        assert.match(s.textOf(s.document.body), /24\.000000000123456789/)
      },
    )
  })
})

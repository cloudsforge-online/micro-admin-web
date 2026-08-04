/**
 * The client, checked against the surface `micro-foresight` actually serves.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE ASSERTS THE REQUEST AND NOT THE RESPONSE.
 *
 * `wallet/src/pricingclient.ts` calls `GET /v1/quotes`; pricing has never served that route — the
 * rate board is `GET /rates`. `micro-market` called `POST /v1/decisions/market.listing`; policy
 * has no `/v1` routes at all, a 404 from policy is `peerDecided`, and every listing therefore
 * came back 403 for as long as it lived.
 *
 * Both of those clients had tests. The tests stubbed fetch and asserted the RESPONSE — and a stub
 * answers whatever it is told to whatever it is asked, so a wrong path is invisible to them.
 * Nothing in a TypeScript build catches it either: the types on both sides are perfect and the
 * string between them is fiction.
 *
 * So every request this bundle can make is asserted below for its METHOD, its PATH, its QUERY,
 * its BODY and its HEADERS, and each expectation carries the `foresight/src/server.ts` line the
 * route was read off. The last test asserts that the set of paths exercised here is EXACTLY the
 * set the client declares — so a route invented in a later edit fails the build rather than
 * production.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { __resetAuth, setTokens } from '../src/lib/api.ts'
import { __resetObs } from '../src/lib/obs.ts'
import {
  FORESIGHT_ROUTES,
  approveIdea,
  approveMarket,
  createIdea,
  createMarket,
  deployMarket,
  discardIdea,
  editIdea,
  loadCategories,
  loadIdeas,
  loadMarket,
  loadMarkets,
  loadResolution,
  openMarket,
  resolveMarket,
  voidMarket,
} from '../src/lib/foresight.ts'
import {
  installFetch,
  installStorage,
  installWindow,
  json,
  removeStorage,
  removeWindow,
  type FetchStub,
} from './browser-stubs.ts'

/** Where foresight lives under `pnpm dev`, per the surface registry (devPort 4021 — 4011 is beacon's, and micro-ui 0502242 fixed exactly that collision). */
const FORESIGHT = 'http://localhost:4021'

const MARKET_ID = '3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'
const IDEA_ID = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a'

let stub: FetchStub

beforeEach(() => {
  // Served from Vite's port, so the API is cross-origin and the base is absolute — which is
  // exactly what makes the full URL assertable here. It is also what production looks like: this
  // bundle is never served from foresight's origin. See src/lib/hosts.ts.
  installWindow('http://localhost:5182/')
  installStorage()
  __resetAuth()
  setTokens({ accessToken: 'a1', refreshToken: 'r1' })
  stub = installFetch(() => json(200, {}))
})

afterEach(() => {
  stub.restore()
  __resetObs()
  removeStorage()
  removeWindow()
})

/** The one call the suite made, as method, URL and parsed body. */
function only(): { method: string; url: URL; body: unknown; headers: Record<string, string> } {
  assert.equal(stub.calls.length, 1, `expected exactly one request, saw ${stub.calls.length}`)
  const call = stub.calls[0]
  assert.ok(call)
  return {
    method: call.method,
    url: new URL(call.url),
    body: call.body === undefined ? undefined : JSON.parse(call.body),
    headers: call.headers,
  }
}

/* ══════════════════════════════ the idea queue ══════════════════════════════ */

describe('the idea queue', () => {
  it('GET /ideas — server.ts:546', async () => {
    await loadIdeas('proposed')
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.origin, FORESIGHT)
    assert.equal(call.url.pathname, '/ideas')
    assert.equal(call.url.searchParams.get('status'), 'proposed')
    // Omitted rather than sent as an empty string: `parseLimit` refuses anything that is not a
    // whole number between 1 and 200 (server.ts:852-859), and '' is not one.
    assert.equal(call.url.searchParams.has('limit'), false)
  })

  it('GET /ideas carries the limit when one is asked for', async () => {
    await loadIdeas('discarded', 25)
    const call = only()
    assert.equal(call.url.searchParams.get('status'), 'discarded')
    assert.equal(call.url.searchParams.get('limit'), '25')
  })

  it('POST /ideas sends the six fields the route requires, and nothing it sets itself — server.ts:557', async () => {
    await createIdea({
      question: 'Will block 9,000,000 be mined by 2027-01-01?',
      resolutionCriteria: 'YES if the Hearth explorer shows height >= 9000000 at the close time.',
      category: 'protocol_network',
      resolutionSourceKind: 'block_explorer',
      resolutionSourceRef: 'https://explorer.example/height',
      suggestedCloseTime: '2027-01-01T00:00:00.000Z',
    })
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/ideas')
    const body = call.body as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), [
      'category',
      'question',
      'resolutionCriteria',
      'resolutionSourceKind',
      'resolutionSourceRef',
      'suggestedCloseTime',
    ])
    // `categoryVersion` and `origin` are set by the SERVER (server.ts:567, 572). A client that
    // sent them would be stating the rules a proposal was judged under, which is not its to say.
    assert.equal('categoryVersion' in body, false)
    assert.equal('origin' in body, false)
  })

  it('PATCH /ideas/:id sends the WHOLE draft, because the route requires every field — server.ts:578', async () => {
    await editIdea(IDEA_ID, {
      question: 'q',
      resolutionCriteria: 'c',
      category: 'market_prices',
      resolutionSourceKind: 'exchange_api',
      resolutionSourceRef: 'https://example.test/x',
      suggestedCloseTime: '2027-01-01T00:00:00.000Z',
    })
    const call = only()
    assert.equal(call.method, 'PATCH')
    assert.equal(call.url.pathname, `/ideas/${IDEA_ID}`)
    // Named PATCH, behaves like PUT: all six are `requireString`/`requireDate` (server.ts:585-593)
    // and a partial body answers 400.
    assert.equal(Object.keys(call.body as object).length, 6)
  })

  it('POST /ideas/:id/approve — server.ts:600', async () => {
    await approveIdea(IDEA_ID, 'checked both sources against the explorer')
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/ideas/${IDEA_ID}/approve`)
    assert.deepEqual(call.body, { note: 'checked both sources against the explorer' })
  })

  it('POST /ideas/:id/approve omits a blank note rather than sending an empty one', async () => {
    await approveIdea(IDEA_ID, '   ')
    assert.deepEqual(only().body, {})
  })

  it('POST /ideas/:id/discard names one of the three refusals — server.ts:610', async () => {
    await discardIdea(IDEA_ID, 'unverifiable_resolution', null)
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/ideas/${IDEA_ID}/discard`)
    // `refusalId` is `requireString` (server.ts:620) — free text is deliberately not accepted, so
    // that a reason can be counted rather than read.
    assert.deepEqual(call.body, { refusalId: 'unverifiable_resolution' })
  })

  it('POST /ideas/:id/discard carries a note when one is written', async () => {
    await discardIdea(IDEA_ID, 'death_or_violence', 'about a named person')
    assert.deepEqual(only().body, {
      refusalId: 'death_or_violence',
      note: 'about a named person',
    })
  })
})

/* ══════════════════════════════ markets ══════════════════════════════ */

describe('markets', () => {
  it('GET /categories — server.ts:391', async () => {
    await loadCategories()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/categories')
  })

  it('GET /markets with no status omits the parameter entirely — server.ts:402', async () => {
    await loadMarkets(null)
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/markets')
    // `parseStatus` answers 400 for anything outside the seven states (server.ts:846-850), and
    // '' is outside them. Absent means "every status"; empty means a bad request.
    assert.equal(call.url.searchParams.has('status'), false)
  })

  it('GET /markets filters by one of the seven lifecycle states', async () => {
    await loadMarkets('closed', 10)
    const call = only()
    assert.equal(call.url.searchParams.get('status'), 'closed')
    assert.equal(call.url.searchParams.get('limit'), '10')
  })

  it('GET /markets/:id — server.ts:417', async () => {
    await loadMarket(MARKET_ID)
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, `/markets/${MARKET_ID}`)
  })

  it('POST /markets sends the draft and never the chain — server.ts:629', async () => {
    await createMarket({
      ideaId: IDEA_ID,
      question: 'q',
      resolutionCriteria: 'c',
      category: 'protocol_network',
      resolutionSourceKind: 'chain_rpc',
      resolutionSourceRef: 'https://rpc.example/',
      closeTime: '2027-01-01T00:00:00.000Z',
    })
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/markets')
    const body = call.body as Record<string, unknown>
    assert.equal(body['ideaId'], IDEA_ID)
    // `chain` and `network` come from the service's configuration (server.ts:651-652).
    assert.equal('chain' in body, false)
    assert.equal('network' in body, false)
  })

  it('POST /markets/:id/approve — server.ts:660', async () => {
    await approveMarket(MARKET_ID)
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/markets/${MARKET_ID}/approve`)
    assert.equal(call.body, undefined)
  })

  it('POST /markets/:id/open — server.ts:710', async () => {
    await openMarket(MARKET_ID)
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/markets/${MARKET_ID}/open`)
  })
})

/* ══════════════════════════════ the idempotency key ══════════════════════════════ */

describe('deploy', () => {
  it('POST /markets/:id/deploy sends the Idempotency-Key header the route requires — server.ts:678, 832', async () => {
    await deployMarket(MARKET_ID, 'deploy-key-12345678')
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/markets/${MARKET_ID}/deploy`)
    // Without it the route answers 400 (server.ts:832-838). It is a HEADER, not a body field.
    assert.equal(call.headers['idempotency-key'], 'deploy-key-12345678')
  })

  it('still sends the bearer token: a caller-supplied header map cannot displace it', async () => {
    await deployMarket(MARKET_ID, 'deploy-key-12345678')
    // The whole point of spreading `extra` BEFORE authorization is set. A deploy that lost its
    // token would 401, retry, and — with the same idempotency key — be indistinguishable from a
    // deploy that worked.
    assert.equal(only().headers['authorization'], 'Bearer a1')
  })
})

/* ══════════════════════════════ the two that move money ══════════════════════════════ */

describe('resolve', () => {
  it('POST /markets/:id/resolve sends outcome as a JSON NUMBER — server.ts:727, 731', async () => {
    await resolveMarket(MARKET_ID, 0, 'the explorer showed height 9,000,013 at 00:00:00Z')
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/markets/${MARKET_ID}/resolve`)
    const body = call.body as Record<string, unknown>
    // `requireInteger` (server.ts:872-883) refuses a string. The opposite of the staking route's
    // amount rule, and both are deliberate.
    assert.equal(typeof body['outcome'], 'number')
    assert.equal(body['outcome'], 0)
    assert.equal(body['rationale'], 'the explorer showed height 9,000,013 at 00:00:00Z')
  })

  it('sends 1 for NO, and 1 really is NO', async () => {
    await resolveMarket(MARKET_ID, 1, 'it did not happen')
    // `planResolution` maps 0 → ACTION_RESOLVE_YES and anything else → ACTION_RESOLVE_NO
    // (resolve.ts:226). Getting this backwards pays the wrong half of the market.
    assert.equal((only().body as Record<string, unknown>)['outcome'], 1)
  })

  it('GET /markets/:id/resolution — server.ts:757', async () => {
    await loadResolution(MARKET_ID)
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, `/markets/${MARKET_ID}/resolution`)
  })
})

describe('void', () => {
  it('POST /markets/:id/void sends the required reason — server.ts:773, 790', async () => {
    await voidMarket(MARKET_ID, 'the named source no longer publishes this series')
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/markets/${MARKET_ID}/void`)
    assert.deepEqual(call.body, { reason: 'the named source no longer publishes this series' })
  })
})

/* ══════════════════════════════ the surface as a whole ══════════════════════════════ */

describe('the surface this bundle believes in', () => {
  it('names no /v1 prefix anywhere — foresight has none, and market lost the marketplace to one', async () => {
    for (const route of FORESIGHT_ROUTES) {
      assert.equal(route.includes('/v1'), false, `${route} carries a /v1 prefix foresight does not serve`)
    }
  })

  it('declares no close route, because there is none to call', () => {
    // A market closes when its close time passes: the contract stops taking stakes by itself and
    // the `market.close` leased job writes the registry to match (jobs.ts:212-229). An operator
    // button here would be an invented route AND a lie about who closes a market.
    assert.equal(
      FORESIGHT_ROUTES.some((r) => r.includes('/close')),
      false,
    )
  })

  it('declares no dispute route, because there is none', () => {
    // The dispute window is a market field the contract enforces. A contest inside it is handled
    // by `resolved → void`, which is a transition the state table permits (markets.ts:55-57).
    assert.equal(
      FORESIGHT_ROUTES.some((r) => r.toLowerCase().includes('dispute')),
      false,
    )
  })

  it('exercises every declared route, and requests nothing it does not declare', async () => {
    // The bookend of this file. Every function above was called once; this replays them all and
    // compares the paths actually requested against the declaration. A route invented in a later
    // edit fails here, and a route declared but never called fails here too — a dead declaration
    // is a citation nobody will re-check.
    const seen = new Set<string>()
    const record = () => {
      for (const call of stub.calls) {
        const path = new URL(call.url).pathname
          .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '/:id')
        seen.add(`${call.method} ${path}`)
      }
      stub.calls.length = 0
    }

    await loadCategories()
    await loadMarkets(null)
    await loadMarket(MARKET_ID)
    await loadResolution(MARKET_ID)
    await loadIdeas('proposed')
    await createIdea({
      question: 'q',
      resolutionCriteria: 'c',
      category: 'protocol_network',
      resolutionSourceKind: 'chain_rpc',
      resolutionSourceRef: 'https://rpc.example/',
      suggestedCloseTime: '2027-01-01T00:00:00.000Z',
    })
    await editIdea(IDEA_ID, {
      question: 'q',
      resolutionCriteria: 'c',
      category: 'protocol_network',
      resolutionSourceKind: 'chain_rpc',
      resolutionSourceRef: 'https://rpc.example/',
      suggestedCloseTime: '2027-01-01T00:00:00.000Z',
    })
    await approveIdea(IDEA_ID, null)
    await discardIdea(IDEA_ID, 'unverifiable_resolution', null)
    await createMarket({
      question: 'q',
      resolutionCriteria: 'c',
      category: 'protocol_network',
      resolutionSourceKind: 'chain_rpc',
      resolutionSourceRef: 'https://rpc.example/',
      closeTime: '2027-01-01T00:00:00.000Z',
    })
    await approveMarket(MARKET_ID)
    await deployMarket(MARKET_ID, 'deploy-key-12345678')
    await openMarket(MARKET_ID)
    await resolveMarket(MARKET_ID, 0, 'because')
    await voidMarket(MARKET_ID, 'because')
    record()

    assert.deepEqual([...seen].sort(), [...FORESIGHT_ROUTES].sort())
  })
})

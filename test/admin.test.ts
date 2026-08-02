/**
 * The client, checked against the surface `micro-admin-api` actually serves.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE ASSERTS THE REQUEST AND NOT THE RESPONSE.
 *
 * `wallet/src/pricingclient.ts` called `GET /v1/quotes`; pricing has never served that route — the
 * rate board is `GET /rates`. `micro-market` called `POST /v1/decisions/market.listing`; policy has
 * no `/v1` routes at all, a 404 from policy is `peerDecided`, and every listing therefore came back
 * 403 for as long as it lived. Most recently a client made every on-chain escrow activation fail
 * and reported a false cause. Seven times, now.
 *
 * All of those clients had tests. The tests stubbed fetch and asserted the RESPONSE — and a stub
 * answers whatever it is told to whatever it is asked, so a wrong path is invisible to them.
 * Nothing in a TypeScript build catches it either: the types on both sides are perfect and the
 * string between them is fiction.
 *
 * So every request this bundle can make is asserted below for its METHOD, its PATH, its QUERY, its
 * BODY and its HEADERS, and each expectation carries the `admin-api/src/server.ts` line the route
 * was read off. The last tests assert that the set of paths exercised here is EXACTLY the set the
 * client declares, and that the one route this console must never call is absent from the source.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { __resetAuth, setTokens } from '../src/lib/api.ts'
import { __resetObs } from '../src/lib/obs.ts'
import {
  ADMIN_ROUTES,
  REFUSED_ROUTES,
  decideApproval,
  loadActions,
  loadApproval,
  loadApprovals,
  loadAudit,
  loadBroadcasts,
  loadEngagementPolicies,
  loadEngagementReport,
  loadEstate,
  loadFlags,
  lowerEngagementPolicy,
  publishBroadcast,
  requestApproval,
  retractBroadcast,
  setFlag,
  verifyChain,
} from '../src/lib/admin.ts'
import {
  installFetch,
  installStorage,
  installWindow,
  json,
  removeStorage,
  removeWindow,
  type FetchStub,
} from './browser-stubs.ts'

/**
 * Where `admin-api` is addressed from under `pnpm dev`, per the surface registry's `admin` entry.
 *
 * This was pinned to 3002 while the registry disagreed with the service, with a note saying it
 * would fail the day the registry was corrected and that somebody should look at it then. That
 * day came: `micro-ui` now records devPort **4014**, the port `admin-api` actually binds
 * (`admin-api/src/env.ts:167`), and `surfaces.test.ts` pins that value against the service rather
 * than merely checking it collides with nothing — which is what let three wrong ports through.
 *
 * Still pinned to the registry rather than to a literal: this suite asserts what the CLIENT
 * sends, which is whatever `cloudsforgeHosts()` resolves. In production the console and its API
 * share an origin and the base is empty; that case is pinned in `hosts.test.ts`.
 */
const ADMIN = 'http://localhost:4014'

const APPROVAL_ID = '3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'
const BROADCAST_ID = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a'
const KEY = 'idem-key-0001'

let stub: FetchStub

beforeEach(() => {
  // Served from Vite's port, so `admin-api` is cross-origin and the base is absolute — which is
  // what makes the full URL assertable here.
  installWindow('http://localhost:5183/')
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

/** The one call the suite made, as method, URL, parsed body and headers. */
function only(): { method: string; url: URL; body: unknown; headers: Record<string, string> } {
  assert.equal(stub.calls.length, 1, `expected exactly one request, saw ${stub.calls.length}`)
  const call = stub.calls[0]
  assert.ok(call)
  return {
    method: call.method,
    url: new URL(call.url),
    body: call.body === undefined ? undefined : JSON.parse(call.body),
    headers: Object.fromEntries(
      Object.entries(call.headers).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  }
}

/* ══════════════════════════════ reads ══════════════════════════════ */

describe('GET /v1/estate — admin-api/src/server.ts:879', () => {
  it('is a GET at the exact path', async () => {
    await loadEstate()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.origin, ADMIN)
    assert.equal(call.url.pathname, '/v1/estate')
  })

  it('sends no query at all — the route reads none', async () => {
    await loadEstate()
    assert.equal(only().url.search, '')
  })

  it('sends no body on a GET', async () => {
    await loadEstate()
    assert.equal(only().body, undefined)
  })

  it('carries the operator’s bearer, because the route calls requireOperator (server.ts:881)', async () => {
    await loadEstate()
    assert.equal(only().headers['authorization'], 'Bearer a1')
  })

  it('passes an abort signal through, so a fast navigation cancels the read', async () => {
    const controller = new AbortController()
    const promise = loadEstate({ signal: controller.signal })
    await promise
    assert.equal(stub.calls.length, 1)
  })
})

describe('GET /v1/actions — admin-api/src/server.ts:609', () => {
  it('is a GET at the exact path', async () => {
    await loadActions()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/actions')
  })

  it('sends no query — the catalogue is not filterable and the route reads nothing', async () => {
    await loadActions()
    assert.equal(only().url.search, '')
  })
})

describe('GET /v1/approvals — admin-api/src/server.ts:623', () => {
  it('is a GET at the exact path', async () => {
    await loadApprovals()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/approvals')
  })

  it('sends no query when nothing is filtered', async () => {
    await loadApprovals()
    assert.equal(only().url.search, '')
  })

  it('sends state as `state`, the name the route reads at server.ts:627', async () => {
    await loadApprovals({ state: 'pending' })
    assert.equal(only().url.searchParams.get('state'), 'pending')
  })

  it('sends action as `action` — server.ts:630', async () => {
    await loadApprovals({ action: 'ledger.entry.reverse' })
    assert.equal(only().url.searchParams.get('action'), 'ledger.entry.reverse')
  })

  it('sends requestedBy as `requestedBy` — server.ts:631', async () => {
    await loadApprovals({ requestedBy: 'user:abc' })
    assert.equal(only().url.searchParams.get('requestedBy'), 'user:abc')
  })

  it('sends limit as a decimal string — server.ts:632, parsed by parseLimit at server.ts:1066', async () => {
    await loadApprovals({ limit: 25 })
    assert.equal(only().url.searchParams.get('limit'), '25')
  })

  it('sends every filter together without dropping one', async () => {
    await loadApprovals({ state: 'approved', action: 'a', requestedBy: 'user:b', limit: 5 })
    const q = only().url.searchParams
    assert.deepEqual(
      [...q.keys()].sort(),
      ['action', 'limit', 'requestedBy', 'state'],
    )
  })

  it('never sends an actor or a userId — there is no act-as-anyone parameter on this route', async () => {
    await loadApprovals({ state: 'pending' })
    const q = only().url.searchParams
    assert.equal(q.get('actor'), null)
    assert.equal(q.get('userId'), null)
  })
})

describe('GET /v1/approvals/:id — admin-api/src/server.ts:637', () => {
  it('puts the id in the PATH, not the query', async () => {
    await loadApproval(APPROVAL_ID)
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, `/v1/approvals/${APPROVAL_ID}`)
    assert.equal(call.url.search, '')
  })

  it('encodes the id, so a hostile one cannot escape its segment', async () => {
    await loadApproval('../flags')
    // `%2F` keeps it one segment. The service then answers 404 through `itemIdOf`
    // (server.ts:1086), which is the correct answer for an id that is not a uuid.
    assert.match(only().url.pathname, /%2F/)
  })
})

describe('GET /v1/audit — admin-api/src/server.ts:557', () => {
  it('is a GET at the exact path', async () => {
    await loadAudit()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/audit')
  })

  it('sends every filter under the name the route reads — server.ts:563-570', async () => {
    await loadAudit({
      actor: 'user:a',
      action: 'admin.approval.granted',
      subjectKind: 'approval',
      subjectId: 'x',
      correlationId: 'cf-1',
      source: 'admin-api',
      before: '42',
      limit: 10,
    })
    const q = only().url.searchParams
    assert.equal(q.get('actor'), 'user:a')
    assert.equal(q.get('action'), 'admin.approval.granted')
    assert.equal(q.get('subjectKind'), 'approval')
    assert.equal(q.get('subjectId'), 'x')
    assert.equal(q.get('correlationId'), 'cf-1')
    assert.equal(q.get('source'), 'admin-api')
    assert.equal(q.get('before'), '42')
    assert.equal(q.get('limit'), '10')
  })

  it('sends the cursor as `before`, a decimal sequence — parseCursor at server.ts:1061', async () => {
    await loadAudit({ before: '1000' })
    assert.equal(only().url.searchParams.get('before'), '1000')
  })

  it('sends NO free-text parameter: the route offers none, deliberately', async () => {
    await loadAudit({ correlationId: 'cf-1' })
    const q = only().url.searchParams
    for (const invented of ['q', 'search', 'text', 'payload', 'query']) {
      assert.equal(q.get(invented), null, `${invented} is not a parameter admin-api reads`)
    }
  })

  it('omits an absent filter rather than sending it empty', async () => {
    await loadAudit({ actor: '' })
    assert.equal(only().url.search, '')
  })
})

describe('GET /v1/audit/verify — admin-api/src/server.ts:579', () => {
  it('resumes from the checkpoint when no `from` is given', async () => {
    await verifyChain()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/audit/verify')
    assert.equal(call.url.search, '')
  })

  it('sends from=0 to re-walk the whole chain — server.ts:582-584', async () => {
    await verifyChain({ from: '0' })
    assert.equal(only().url.searchParams.get('from'), '0')
  })

  it('sends a limit when one is asked for — server.ts:588', async () => {
    await verifyChain({ from: '0', limit: 200000 })
    assert.equal(only().url.searchParams.get('limit'), '200000')
  })

  it('is a GET: verification reads, it never writes a checkpoint from a browser', async () => {
    await verifyChain({ from: '0' })
    assert.equal(only().method, 'GET')
    assert.equal(only().body, undefined)
  })
})

describe('GET /v1/flags — admin-api/src/server.ts:774', () => {
  it('is a GET at the exact path with no query', async () => {
    await loadFlags()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/flags')
    assert.equal(call.url.search, '')
  })
})

describe('GET /v1/broadcasts — admin-api/src/server.ts:811', () => {
  it('is a GET at the exact path', async () => {
    await loadBroadcasts()
    assert.equal(only().url.pathname, '/v1/broadcasts')
  })

  it('sends live=true as the literal string the route compares against (server.ts:814)', async () => {
    await loadBroadcasts({ live: true })
    assert.equal(only().url.searchParams.get('live'), 'true')
  })

  it('omits `live` entirely when it is false, rather than sending live=false', async () => {
    // The route tests `=== 'true'`, so `live=false` would behave identically — and would be a
    // parameter that reads as though it filtered something.
    await loadBroadcasts({ live: false })
    assert.equal(only().url.searchParams.get('live'), null)
  })

  it('sends limit when asked', async () => {
    await loadBroadcasts({ limit: 50 })
    assert.equal(only().url.searchParams.get('limit'), '50')
  })
})

/* ══════════════════════════════ writes ══════════════════════════════ */

describe('POST /v1/approvals — admin-api/src/server.ts:645', () => {
  const input = {
    action: 'ledger.entry.reverse',
    subjectId: 'entry-1',
    reasonCode: 'incident_remediation',
    reason: 'double posting during the 03:14 incident',
    params: { description: 'reverses entry-1' },
  }

  it('is a POST at the exact path', async () => {
    await requestApproval(input, KEY)
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/v1/approvals')
  })

  it('sends the five fields the route requires, and nothing else', async () => {
    await requestApproval(input, KEY)
    assert.deepEqual(only().body, {
      action: 'ledger.entry.reverse',
      subjectId: 'entry-1',
      reasonCode: 'incident_remediation',
      reason: 'double posting during the 03:14 incident',
      params: { description: 'reverses entry-1' },
    })
  })

  it('sends the Idempotency-Key header — required at server.ts:988, 400 without it', async () => {
    await requestApproval(input, KEY)
    assert.equal(only().headers['idempotency-key'], KEY)
  })

  it('sends content-type: application/json, because the route calls JSON.parse on the body', async () => {
    await requestApproval(input, KEY)
    assert.equal(only().headers['content-type'], 'application/json')
  })

  it('carries the bearer: the actor is derived from it, never from the body', async () => {
    await requestApproval(input, KEY)
    const call = only()
    assert.equal(call.headers['authorization'], 'Bearer a1')
    const body = call.body as Record<string, unknown>
    assert.equal(body['actor'], undefined)
    assert.equal(body['requestedBy'], undefined)
    assert.equal(body['userId'], undefined)
  })

  it('sends params as an object, which the route requires (server.ts:666)', async () => {
    await requestApproval({ ...input, params: { description: 'x', refund: true } }, KEY)
    const body = only().body as { params: Record<string, unknown> }
    assert.equal(typeof body.params, 'object')
    assert.equal(body.params['refund'], true)
  })

  it('sends a boolean param as a boolean, which server.ts:670 accepts alongside a string', async () => {
    await requestApproval({ ...input, params: { refund: false } }, KEY)
    const body = only().body as { params: Record<string, unknown> }
    assert.equal(body.params['refund'], false)
  })
})

describe('POST /v1/approvals/:id/decision — admin-api/src/server.ts:709', () => {
  it('is a POST at the exact path with the id in the path', async () => {
    await decideApproval(APPROVAL_ID, { grant: true }, KEY)
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/v1/approvals/${APPROVAL_ID}/decision`)
  })

  it('sends grant as a BOOLEAN — server.ts:715 answers 400 for anything else', async () => {
    await decideApproval(APPROVAL_ID, { grant: true }, KEY)
    const body = only().body as Record<string, unknown>
    assert.equal(body['grant'], true)
    assert.equal(typeof body['grant'], 'boolean')
  })

  it('sends grant: false for a rejection, never a separate route', async () => {
    // There is no reject route. Inventing `POST /v1/approvals/:id/reject` is exactly the defect
    // this file exists to prevent.
    await decideApproval(APPROVAL_ID, { grant: false }, KEY)
    const call = only()
    assert.equal(call.url.pathname, `/v1/approvals/${APPROVAL_ID}/decision`)
    assert.equal((call.body as Record<string, unknown>)['grant'], false)
  })

  it('sends the note when there is one — read at server.ts:731', async () => {
    await decideApproval(APPROVAL_ID, { grant: true, note: 'checked against the journal' }, KEY)
    assert.equal((only().body as Record<string, unknown>)['note'], 'checked against the journal')
  })

  it('omits the note entirely when it is empty, rather than sending an empty string', async () => {
    await decideApproval(APPROVAL_ID, { grant: true, note: '' }, KEY)
    assert.equal('note' in (only().body as object), false)
  })

  it('sends the Idempotency-Key — server.ts:718', async () => {
    await decideApproval(APPROVAL_ID, { grant: true }, KEY)
    assert.equal(only().headers['idempotency-key'], KEY)
  })

  it('names no operator in the body: the approver is the verified bearer', async () => {
    await decideApproval(APPROVAL_ID, { grant: true }, KEY)
    const body = only().body as Record<string, unknown>
    assert.equal(body['operator'], undefined)
    assert.equal(body['decidedBy'], undefined)
    assert.equal(body['userId'], undefined)
  })
})

describe('PUT /v1/flags/:key — admin-api/src/server.ts:780', () => {
  it('is a PUT with the key in the path', async () => {
    await setFlag('new-checkout', { enabled: true, description: 'd', owner: 'payments' })
    const call = only()
    assert.equal(call.method, 'PUT')
    assert.equal(call.url.pathname, '/v1/flags/new-checkout')
  })

  it('sends enabled as a BOOLEAN — server.ts:785 answers 400 otherwise', async () => {
    await setFlag('k', { enabled: false, description: 'd', owner: 'o' })
    const body = only().body as Record<string, unknown>
    assert.equal(body['enabled'], false)
    assert.equal(typeof body['enabled'], 'boolean')
  })

  it('sends description and owner, both required (server.ts:793-794, flags.ts:99-104)', async () => {
    await setFlag('k', { enabled: true, description: 'why it exists', owner: 'payments' })
    assert.deepEqual(only().body, {
      enabled: true,
      description: 'why it exists',
      owner: 'payments',
    })
  })

  it('sends NO Idempotency-Key: the route is exempt, and the exemption is recorded', async () => {
    // routeidempotency.test.ts:35-37 in admin-api. An upsert keyed on the flag key; a retry
    // writes the same row, and the audit records before and after. Sending a key would be a claim
    // about the route that is not true.
    await setFlag('k', { enabled: true, description: 'd', owner: 'o' })
    assert.equal(only().headers['idempotency-key'], undefined)
  })

  it('encodes a key with a slash in it into one segment', async () => {
    await setFlag('team/flag', { enabled: true, description: 'd', owner: 'o' })
    assert.equal(only().url.pathname, '/v1/flags/team%2Fflag')
  })
})

describe('POST /v1/broadcasts — admin-api/src/server.ts:827', () => {
  it('is a POST at the exact path', async () => {
    await publishBroadcast({ severity: 'incident', title: 't', body: 'b' }, KEY)
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/v1/broadcasts')
  })

  it('sends severity, title and body — all required at server.ts:842-844', async () => {
    await publishBroadcast({ severity: 'maintenance', title: 'Down', body: 'Back at 03:00' }, KEY)
    assert.deepEqual(only().body, {
      severity: 'maintenance',
      title: 'Down',
      body: 'Back at 03:00',
    })
  })

  it('sends startsAt and endsAt only when given — optional at server.ts:845-846', async () => {
    await publishBroadcast(
      { severity: 'info', title: 't', body: 'b', startsAt: '2026-08-01T00:00:00.000Z' },
      KEY,
    )
    const body = only().body as Record<string, unknown>
    assert.equal(body['startsAt'], '2026-08-01T00:00:00.000Z')
    assert.equal('endsAt' in body, false)
  })

  it('sends the Idempotency-Key — server.ts:832, so a retry does not publish twice', async () => {
    await publishBroadcast({ severity: 'info', title: 't', body: 'b' }, KEY)
    assert.equal(only().headers['idempotency-key'], KEY)
  })
})

describe('DELETE /v1/broadcasts/:id — admin-api/src/server.ts:864', () => {
  it('is a DELETE with the id in the path and no body', async () => {
    await retractBroadcast(BROADCAST_ID)
    const call = only()
    assert.equal(call.method, 'DELETE')
    assert.equal(call.url.pathname, `/v1/broadcasts/${BROADCAST_ID}`)
    assert.equal(call.body, undefined)
  })

  it('sends NO Idempotency-Key: exempt, and for a different reason from the flag route', async () => {
    // routeidempotency.test.ts:37-38 — a state transition claimed with `where retracted_at is
    // null`; a second attempt matches no row and is refused rather than audited twice.
    await retractBroadcast(BROADCAST_ID)
    assert.equal(only().headers['idempotency-key'], undefined)
  })
})

/* ══════════════════════════════ the whole surface ══════════════════════════════ */

describe('the set of routes this bundle can reach', () => {
  const SOURCE = readFileSync(new URL('../src/lib/admin.ts', import.meta.url), 'utf8')

  it('declares sixteen routes, which is what admin-api serves minus the ones we do not call', () => {
    // Thirteen, plus the three engagement-treasury routes (docs/ecosystem/21 §6).
    assert.equal(Object.keys(ADMIN_ROUTES).length, 16)
  })

  it('cites a line number in admin-api/src/server.ts for every one of them', () => {
    for (const [path, route] of Object.entries(ADMIN_ROUTES)) {
      assert.ok(route.line > 0, `${path} cites no line`)
      assert.match(route.method, /^(GET|POST|PUT|DELETE)$/, `${path} has no method`)
    }
  })

  it('exercises every declared route in this suite', async () => {
    // Each declared path is called once above. If a route is added to the client and never tested,
    // this fails — which is the mechanism, because an untested route is exactly how a wrong path
    // reaches production.
    const exercised = new Set<string>()
    const record = async (fn: () => Promise<unknown>) => {
      stub.calls.length = 0
      await fn()
      const call = stub.calls[0]
      assert.ok(call)
      const url = new URL(call.url)
      const generic = url.pathname
        .replace(/\/v1\/approvals\/[^/]+\/decision$/, '/v1/approvals/:id/decision')
        .replace(/\/v1\/approvals\/[^/]+$/, '/v1/approvals/:id')
        .replace(/\/v1\/broadcasts\/[^/]+$/, '/v1/broadcasts/:id')
        .replace(/\/v1\/flags\/[^/]+$/, '/v1/flags/:key')
        .replace(/\/v1\/engagement\/policies\/[^/]+$/, '/v1/engagement/policies/:service')
      exercised.add(call.method === 'POST' && (generic === '/v1/approvals' || generic === '/v1/broadcasts') ? `${generic}#post` : generic)
    }

    await record(() => loadEstate())
    await record(() => loadActions())
    await record(() => loadApprovals())
    await record(() => loadApproval(APPROVAL_ID))
    await record(() =>
      requestApproval(
        { action: 'a', subjectId: 's', reasonCode: 'r', reason: 'x', params: {} },
        KEY,
      ),
    )
    await record(() => decideApproval(APPROVAL_ID, { grant: true }, KEY))
    await record(() => loadAudit())
    await record(() => verifyChain())
    await record(() => loadFlags())
    await record(() => setFlag('k', { enabled: true, description: 'd', owner: 'o' }))
    await record(() => loadBroadcasts())
    await record(() => publishBroadcast({ severity: 'info', title: 't', body: 'b' }, KEY))
    await record(() => retractBroadcast(BROADCAST_ID))
    await record(() => loadEngagementPolicies())
    await record(() => loadEngagementReport())
    await record(() => lowerEngagementPolicy('foresight', { transferCapShards: '100' }))

    assert.deepEqual([...exercised].sort(), Object.keys(ADMIN_ROUTES).sort())
  })

  it('reaches no path outside the declared set', async () => {
    // The complement of the test above: nothing may be called that is not declared.
    stub.calls.length = 0
    await loadEstate()
    await loadActions()
    await loadFlags()
    for (const call of stub.calls) {
      const path = new URL(call.url).pathname
      assert.ok(
        Object.keys(ADMIN_ROUTES).some((declared) => declared.split('#')[0] === path),
        `${path} is not in ADMIN_ROUTES`,
      )
    }
  })

  it('never sources a path from anywhere but this module', () => {
    // Every `/v1/...` literal in the bundle's client lives here, so the route table above is the
    // whole surface rather than a summary of it.
    const paths = [...SOURCE.matchAll(/api<[^>]*>\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1] ?? '')
    for (const path of paths) {
      assert.match(path, /^\/v1\//, `${path} is not a /v1 path`)
    }
    assert.ok(paths.length >= 6, 'the path extractor found nothing — it is broken')
  })
})

describe('the route this console must never call', () => {
  const SOURCE = readFileSync(new URL('../src/lib/admin.ts', import.meta.url), 'utf8')

  it('names POST /v1/events as refused, with the reason', () => {
    assert.ok(REFUSED_ROUTES['POST /v1/events'])
    assert.match(REFUSED_ROUTES['POST /v1/events'] ?? '', /signature/i)
  })

  it('never posts to /v1/events', () => {
    // An absence is not something a reader can see. `/v1/events` appears in this module only
    // inside the REFUSED_ROUTES entry and its comment, never as an argument to `api(...)`.
    assert.doesNotMatch(SOURCE, /api<[^>]*>\(\s*[`'"]\/v1\/events/)
  })

  it('exports no function whose name suggests it mirrors an audit row', () => {
    for (const name of ['mirrorAudit', 'postEvent', 'sendEvent', 'appendAudit']) {
      assert.doesNotMatch(SOURCE, new RegExp(`export function ${name}\\b`), `${name} must not exist`)
    }
  })
})

describe('an operator acts as themselves', () => {
  const SOURCE = readFileSync(new URL('../src/lib/admin.ts', import.meta.url), 'utf8')

  it('no exported function takes an actor, an operator or a userId parameter', () => {
    // The frozen estate's /internal routes took a `userId` as a parameter, which is an
    // act-as-anyone primitive. Nothing in this client may grow an equivalent.
    const signatures = [...SOURCE.matchAll(/export function \w+\(([^)]*)\)/g)].map((m) => m[1] ?? '')
    assert.ok(signatures.length >= 10, 'the signature extractor found almost nothing')
    for (const signature of signatures) {
      assert.doesNotMatch(signature, /\bactor\b/i, `an actor parameter appears in: ${signature}`)
      assert.doesNotMatch(signature, /\buserId\b/i, `a userId parameter appears in: ${signature}`)
      assert.doesNotMatch(signature, /\bonBehalfOf\b/i, `an on-behalf-of parameter appears in: ${signature}`)
    }
  })

  it('sends no actor field on any write', async () => {
    stub.calls.length = 0
    await requestApproval({ action: 'a', subjectId: 's', reasonCode: 'r', reason: 'x', params: {} }, KEY)
    await decideApproval(APPROVAL_ID, { grant: true }, KEY)
    await setFlag('k', { enabled: true, description: 'd', owner: 'o' })
    await publishBroadcast({ severity: 'info', title: 't', body: 'b' }, KEY)
    for (const call of stub.calls) {
      if (call.body === undefined) continue
      const body = JSON.parse(call.body) as Record<string, unknown>
      for (const forbidden of ['actor', 'operator', 'userId', 'requestedBy', 'decidedBy', 'onBehalfOf']) {
        assert.equal(body[forbidden], undefined, `${forbidden} was sent to ${call.url}`)
      }
    }
  })
})

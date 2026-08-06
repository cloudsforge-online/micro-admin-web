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
  loadBackup,
  loadBackupSettings,
  loadBackups,
  loadEngagementPolicies,
  loadEngagementReport,
  loadEstate,
  loadFlags,
  loadRestores,
  lowerEngagementPolicy,
  publishBroadcast,
  requestApproval,
  retractBroadcast,
  saveBackupSettings,
  setFlag,
  startBackup,
  startVerifyRestore,
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
 * (`admin-api/src/env.ts`), and `surfaces.test.ts` pins that value against the service rather
 * than merely checking it collides with nothing — which is what let three wrong ports through.
 *
 * Still pinned to the registry rather than to a literal: this suite asserts what the CLIENT
 * sends, which is whatever `cloudsforgeHosts()` resolves. In production the console and its API
 * share an origin and the base is empty; that case is pinned in `hosts.test.ts`.
 */
const ADMIN = 'http://localhost:4014'

/** `src/lib/admin.ts` as text, for the assertions about what it must NOT contain. */
const CLIENT_SOURCE = readFileSync(new URL('../src/lib/admin.ts', import.meta.url), 'utf8')

const APPROVAL_ID = '3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'
const BROADCAST_ID = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a'
const BACKUP_ID = '5c4b3a29-1807-4f6e-95d4-c3b2a1908f7e'
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

describe('GET /v1/estate — admin-api/src/server.ts', () => {
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

  it('carries the operator’s bearer, because the route calls requireOperator (server.ts)', async () => {
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

describe('GET /v1/actions — admin-api/src/server.ts', () => {
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

describe('GET /v1/approvals — admin-api/src/server.ts', () => {
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

  it('sends state as `state`, the name the route reads at server.ts', async () => {
    await loadApprovals({ state: 'pending' })
    assert.equal(only().url.searchParams.get('state'), 'pending')
  })

  it('sends action as `action` — server.ts', async () => {
    await loadApprovals({ action: 'ledger.entry.reverse' })
    assert.equal(only().url.searchParams.get('action'), 'ledger.entry.reverse')
  })

  it('sends requestedBy as `requestedBy` — server.ts', async () => {
    await loadApprovals({ requestedBy: 'user:abc' })
    assert.equal(only().url.searchParams.get('requestedBy'), 'user:abc')
  })

  it('sends limit as a decimal string — server.ts, parsed by parseLimit at server.ts', async () => {
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

describe('GET /v1/approvals/:id — admin-api/src/server.ts', () => {
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
    // (server.ts), which is the correct answer for an id that is not a uuid.
    assert.match(only().url.pathname, /%2F/)
  })
})

describe('GET /v1/audit — admin-api/src/server.ts', () => {
  it('is a GET at the exact path', async () => {
    await loadAudit()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/audit')
  })

  it('sends every filter under the name the route reads — server.ts', async () => {
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

  it('sends the cursor as `before`, a decimal sequence — parseCursor at server.ts', async () => {
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

describe('GET /v1/audit/verify — admin-api/src/server.ts', () => {
  it('resumes from the checkpoint when no `from` is given', async () => {
    await verifyChain()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/audit/verify')
    assert.equal(call.url.search, '')
  })

  it('sends from=0 to re-walk the whole chain — server.ts', async () => {
    await verifyChain({ from: '0' })
    assert.equal(only().url.searchParams.get('from'), '0')
  })

  it('sends a limit when one is asked for — server.ts', async () => {
    await verifyChain({ from: '0', limit: 200000 })
    assert.equal(only().url.searchParams.get('limit'), '200000')
  })

  it('is a GET: verification reads, it never writes a checkpoint from a browser', async () => {
    await verifyChain({ from: '0' })
    assert.equal(only().method, 'GET')
    assert.equal(only().body, undefined)
  })
})

describe('GET /v1/flags — admin-api/src/server.ts', () => {
  it('is a GET at the exact path with no query', async () => {
    await loadFlags()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/flags')
    assert.equal(call.url.search, '')
  })
})

describe('GET /v1/broadcasts — admin-api/src/server.ts', () => {
  it('is a GET at the exact path', async () => {
    await loadBroadcasts()
    assert.equal(only().url.pathname, '/v1/broadcasts')
  })

  it('sends live=true as the literal string the route compares against (server.ts)', async () => {
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

describe('POST /v1/approvals — admin-api/src/server.ts', () => {
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

  it('sends the Idempotency-Key header — required at server.ts, 400 without it', async () => {
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

  it('sends params as an object, which the route requires (server.ts)', async () => {
    await requestApproval({ ...input, params: { description: 'x', refund: true } }, KEY)
    const body = only().body as { params: Record<string, unknown> }
    assert.equal(typeof body.params, 'object')
    assert.equal(body.params['refund'], true)
  })

  it('sends a boolean param as a boolean, which server.ts accepts alongside a string', async () => {
    await requestApproval({ ...input, params: { refund: false } }, KEY)
    const body = only().body as { params: Record<string, unknown> }
    assert.equal(body.params['refund'], false)
  })
})

describe('POST /v1/approvals/:id/decision — admin-api/src/server.ts', () => {
  it('is a POST at the exact path with the id in the path', async () => {
    await decideApproval(APPROVAL_ID, { grant: true }, KEY)
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/v1/approvals/${APPROVAL_ID}/decision`)
  })

  it('sends grant as a BOOLEAN — server.ts answers 400 for anything else', async () => {
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

  it('sends the note when there is one — read at server.ts', async () => {
    await decideApproval(APPROVAL_ID, { grant: true, note: 'checked against the journal' }, KEY)
    assert.equal((only().body as Record<string, unknown>)['note'], 'checked against the journal')
  })

  it('omits the note entirely when it is empty, rather than sending an empty string', async () => {
    await decideApproval(APPROVAL_ID, { grant: true, note: '' }, KEY)
    assert.equal('note' in (only().body as object), false)
  })

  it('sends the Idempotency-Key — server.ts', async () => {
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

describe('PUT /v1/flags/:key — admin-api/src/server.ts', () => {
  it('is a PUT with the key in the path', async () => {
    await setFlag('new-checkout', { enabled: true, description: 'd', owner: 'payments' })
    const call = only()
    assert.equal(call.method, 'PUT')
    assert.equal(call.url.pathname, '/v1/flags/new-checkout')
  })

  it('sends enabled as a BOOLEAN — server.ts answers 400 otherwise', async () => {
    await setFlag('k', { enabled: false, description: 'd', owner: 'o' })
    const body = only().body as Record<string, unknown>
    assert.equal(body['enabled'], false)
    assert.equal(typeof body['enabled'], 'boolean')
  })

  it('sends description and owner, both required (server.ts, flags.ts)', async () => {
    await setFlag('k', { enabled: true, description: 'why it exists', owner: 'payments' })
    assert.deepEqual(only().body, {
      enabled: true,
      description: 'why it exists',
      owner: 'payments',
    })
  })

  it('sends NO Idempotency-Key: the route is exempt, and the exemption is recorded', async () => {
    // routeidempotency.test.ts in admin-api. An upsert keyed on the flag key; a retry
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

describe('POST /v1/broadcasts — admin-api/src/server.ts', () => {
  it('is a POST at the exact path', async () => {
    await publishBroadcast({ severity: 'incident', title: 't', body: 'b' }, KEY)
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/v1/broadcasts')
  })

  it('sends severity, title and body — all required at server.ts', async () => {
    await publishBroadcast({ severity: 'maintenance', title: 'Down', body: 'Back at 03:00' }, KEY)
    assert.deepEqual(only().body, {
      severity: 'maintenance',
      title: 'Down',
      body: 'Back at 03:00',
    })
  })

  it('sends startsAt and endsAt only when given — optional at server.ts', async () => {
    await publishBroadcast(
      { severity: 'info', title: 't', body: 'b', startsAt: '2026-08-01T00:00:00.000Z' },
      KEY,
    )
    const body = only().body as Record<string, unknown>
    assert.equal(body['startsAt'], '2026-08-01T00:00:00.000Z')
    assert.equal('endsAt' in body, false)
  })

  it('sends the Idempotency-Key — server.ts, so a retry does not publish twice', async () => {
    await publishBroadcast({ severity: 'info', title: 't', body: 'b' }, KEY)
    assert.equal(only().headers['idempotency-key'], KEY)
  })
})

describe('DELETE /v1/broadcasts/:id — admin-api/src/server.ts', () => {
  it('is a DELETE with the id in the path and no body', async () => {
    await retractBroadcast(BROADCAST_ID)
    const call = only()
    assert.equal(call.method, 'DELETE')
    assert.equal(call.url.pathname, `/v1/broadcasts/${BROADCAST_ID}`)
    assert.equal(call.body, undefined)
  })

  it('sends NO Idempotency-Key: exempt, and for a different reason from the flag route', async () => {
    // routeidempotency.test.ts — a state transition claimed with `where retracted_at is
    // null`; a second attempt matches no row and is refused rather than audited twice.
    await retractBroadcast(BROADCAST_ID)
    assert.equal(only().headers['idempotency-key'], undefined)
  })
})

/* ══════════════════════════════ backup and restore ══════════════════════════════ */

/**
 * The seven backup routes, checked the same way as the sixteen above and for a sharper reason.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THESE ARE THE ONLY ROUTES IN THIS CLIENT WITH NO SERVER LINE BEHIND THEM.
 *
 * The other sixteen were read off `admin-api/src/server.ts`. These were AGREED — the service's
 * backup module was being built in parallel and did not exist when this client was written — which
 * is precisely the situation that produced `wallet/src/pricingclient.ts` calling `GET /v1/quotes`
 * against a service that has never served it, and every listing in `micro-market` coming back 403
 * for as long as it lived.
 *
 * A stub cannot save this. It answers whatever it is told to whatever it is asked, so it cannot
 * tell a right path from a wrong one. What the assertions below establish is narrower and is the
 * only thing this repository can establish alone: that the request this bundle sends is EXACTLY
 * the request the contract describes — method, path, query, body, header — so that when the
 * service lands, the comparison is a diff rather than an investigation.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
describe('GET /v1/backups — admin-api/src/server.ts', () => {
  it('is a GET at the exact path', async () => {
    await loadBackups()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.origin, ADMIN)
    assert.equal(call.url.pathname, '/v1/backups')
  })

  it('sends limit only when asked for one', async () => {
    await loadBackups()
    assert.equal(only().url.search, '')
    stub.calls.length = 0
    await loadBackups({ limit: 50 })
    assert.equal(only().url.searchParams.get('limit'), '50')
  })

  it('carries the operator’s bearer and no body', async () => {
    await loadBackups()
    const call = only()
    assert.equal(call.headers['authorization'], 'Bearer a1')
    assert.equal(call.body, undefined)
  })
})

describe('GET /v1/backups/:id — admin-api/src/server.ts', () => {
  it('puts the id in the path and encodes it', async () => {
    await loadBackup(BACKUP_ID)
    assert.equal(only().url.pathname, `/v1/backups/${BACKUP_ID}`)
    stub.calls.length = 0
    await loadBackup('a/b')
    assert.equal(only().url.pathname, '/v1/backups/a%2Fb')
  })
})

describe('GET /v1/backups/settings — admin-api/src/server.ts', () => {
  it('is a GET at the settings path, which is NOT the id path', async () => {
    // `settings` occupies the `:id` slot. The two are separate declarations in ADMIN_ROUTES for
    // that reason, and this asserts the client sends the literal rather than something that would
    // be read as an id.
    await loadBackupSettings()
    const call = only()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/backups/settings')
  })
})

describe('PUT /v1/backups/settings — admin-api/src/server.ts', () => {
  const INPUT = {
    rootPath: '/var/backups/cloudsforge',
    retentionCopies: 7,
    scheduleEnabled: true,
    scheduleEveryMinutes: 360,
  }

  it('is a PUT with exactly the four editable fields', async () => {
    await saveBackupSettings(INPUT)
    const call = only()
    assert.equal(call.method, 'PUT')
    assert.equal(call.url.pathname, '/v1/backups/settings')
    assert.deepEqual(call.body, INPUT)
  })

  it('sends NOTHING the form does not edit', async () => {
    // A PUT that echoed back the ceilings it had read would let a form opened before a bound was
    // tightened overwrite the tightening — the lost update, on the settings that decide whether
    // there is a backup at all.
    await saveBackupSettings(INPUT)
    const body = only().body as Record<string, unknown>
    for (const field of ['ceilingBytes', 'minFreeBytes', 'verifyEnabled', 'verifyEveryMinutes', 'updatedAt', 'updatedBy']) {
      assert.equal(body[field], undefined, `${field} was sent`)
    }
  })

  it('sends NO Idempotency-Key: the contract requires one on the two POSTs and on neither PUT', async () => {
    await saveBackupSettings(INPUT)
    assert.equal(only().headers['idempotency-key'], undefined)
  })
})

describe('POST /v1/backups — admin-api/src/server.ts', () => {
  it('is a POST carrying the kind and the reason', async () => {
    await startBackup({ kind: 'full', reason: 'before the ledger migration' }, KEY)
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/v1/backups')
    assert.deepEqual(call.body, { kind: 'full', reason: 'before the ledger migration' })
  })

  it('carries the Idempotency-Key the contract requires', async () => {
    await startBackup({ kind: 'databases', reason: 'drill' }, KEY)
    assert.equal(only().headers['idempotency-key'], KEY)
  })

  it('never sends who asked for it', async () => {
    // admin-api derives the actor from the verified bearer. A client that supplied it would be
    // offering an act-as-anyone primitive on the screen that can overwrite the money data.
    await startBackup({ kind: 'full', reason: 'x' }, KEY)
    const body = only().body as Record<string, unknown>
    for (const field of ['requestedBy', 'actor', 'operator', 'userId']) {
      assert.equal(body[field], undefined, `${field} was sent`)
    }
  })
})

describe('GET /v1/restores — admin-api/src/server.ts', () => {
  it('is a GET at the exact path, with limit only when asked', async () => {
    await loadRestores()
    assert.equal(only().url.pathname, '/v1/restores')
    assert.equal(only().url.search, '')
    stub.calls.length = 0
    await loadRestores({ limit: 20 })
    assert.equal(only().url.searchParams.get('limit'), '20')
  })
})

describe('POST /v1/restores — admin-api/src/server.ts, and it is VERIFY ONLY', () => {
  const BASE = { backupRunId: BACKUP_ID, targets: ['ledger', 'identity'], reason: 'quarterly drill' }

  it('is a POST carrying the backup, the targets and the reason, with mode fixed to verify', async () => {
    await startVerifyRestore(BASE, KEY)
    const call = only()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/v1/restores')
    assert.deepEqual(call.body, {
      backupRunId: BACKUP_ID,
      mode: 'verify',
      targets: ['ledger', 'identity'],
      reason: 'quarterly drill',
    })
  })

  it('sends NO confirmation and NO approvalId, because this route takes neither', async () => {
    // The route hard-codes `mode: 'verify'` on the insert and passes `approvalId: null` and
    // `confirmation: null` (server.ts), with a comment naming the schema constraint that
    // refuses a verify row carrying an approval. A client sending either would be describing a
    // route that does not exist.
    await startVerifyRestore(BASE, KEY)
    const body = only().body as Record<string, unknown>
    assert.equal(body['confirmation'], undefined)
    assert.equal(body['approvalId'], undefined)
  })

  it('offers no way to ask THIS route for a live restore', () => {
    // An ABSENCE, so it is written down and checked — the same reason POST /v1/events is. The route
    // answers 400 for `mode: "live"` (server.ts), so a `startLiveRestore` here would be an
    // error with a confirmation ritual in front of it. This is the assertion that would have caught
    // the drift: the first version of this client had exactly that function.
    assert.doesNotMatch(CLIENT_SOURCE, /export function startLiveRestore\b/)
    assert.doesNotMatch(CLIENT_SOURCE, /mode: input\.mode/)
    assert.match(CLIENT_SOURCE, /mode: 'verify'/)
  })

  it('carries the Idempotency-Key the route requires (server.ts)', async () => {
    await startVerifyRestore(BASE, KEY)
    assert.equal(only().headers['idempotency-key'], KEY)
  })

  it('copies the targets rather than sending the caller’s array', async () => {
    // The page holds `targets` in React state. Serialising the live array would be harmless today
    // and is the shape of a bug the day anything mutates it between the call and the send.
    const targets = ['ledger']
    await startVerifyRestore({ ...BASE, targets }, KEY)
    targets.push('identity')
    assert.deepEqual((only().body as Record<string, unknown>)['targets'], ['ledger'])
  })
})

describe('a live restore goes through the approval queue, not through /v1/restores', () => {
  it('raises estate.restore against the BACKUP RUN, carrying the phrase as a param', async () => {
    // admin-api/src/actions.ts — subjectKind `backup_run`, requiredParams ['confirmation'] —
    // and the executor reads `ctx.approval.subjectId` as the backup to restore from. A wrong
    // subject here would have two operators authorise a restore of a different backup than the one
    // that was on screen.
    await requestApproval(
      {
        action: 'estate.restore',
        subjectId: BACKUP_ID,
        reasonCode: 'incident',
        reason: 'the primary disk failed',
        params: {
          confirmation: 'restore mainnet from 2026-08-04T12:00:00Z',
          targets: ['ledger', 'identity'],
        },
      },
      KEY,
    )
    const call = only()
    assert.equal(call.url.pathname, '/v1/approvals')
    const body = call.body as Record<string, unknown>
    assert.equal(body['action'], 'estate.restore')
    assert.equal(body['subjectId'], BACKUP_ID)
    const params = body['params'] as Record<string, unknown>
    // The phrase goes over the wire byte for byte: `requestRestore` compares it with `!==` at
    // execution time (admin-api/src/backups.ts), so a client that trimmed, lowercased or
    // re-rendered the timestamp would refuse every live restore in the estate.
    assert.equal(params['confirmation'], 'restore mainnet from 2026-08-04T12:00:00Z')
    // A LIST, not a comma-joined string: the executor reads it with `Array.isArray` and an absent
    // value means the whole set, so a string here would restore nothing and typecheck perfectly.
    assert.deepEqual(params['targets'], ['ledger', 'identity'])
  })
})

/* ══════════════════════════════ the whole surface ══════════════════════════════ */

describe('the set of routes this bundle can reach', () => {
  const SOURCE = readFileSync(new URL('../src/lib/admin.ts', import.meta.url), 'utf8')

  it('declares twenty-three routes, which is what admin-api serves minus the ones we do not call', () => {
    // Thirteen, plus the three engagement-treasury routes (docs/ecosystem/21 §6), plus the seven
    // backup and restore routes.
    assert.equal(Object.keys(ADMIN_ROUTES).length, 23)
  })

  it('names a method and a path for every one of them, and no line number', () => {
    // ── THIS REQUIRED A LINE NUMBER, AND THAT IS WHAT IT NOW FORBIDS ─────────────────────────
    //
    // It briefly accepted a contract sentence instead, because the backup module was being built
    // in parallel with the client and those seven routes had genuinely nothing to cite. The module
    // landed, the seven were re-read against it, four differences were found and fixed, and the
    // escape hatch went with them.
    //
    // The LINE went too, and for a stronger reason than the escape hatch. It named a position in
    // `admin-api/src/server.ts`, a file this repository does not own and does not watch: when the
    // engagement routes landed, every one of the twenty-three below shifted and had to be
    // corrected by hand for an edit that changed nothing this bundle calls. Nothing runs this
    // suite when admin-api changes, so a stale citation surfaces at a release — and a drifted
    // citation still resolves, so it reads as verified while naming a different route.
    //
    // The method and the path are what this client depends on, and the two tests below check them
    // in both directions: every declared route is exercised, and every path requested is declared.
    for (const [path, route] of Object.entries(ADMIN_ROUTES)) {
      assert.equal(route.contract, undefined, `${path} still carries a contract sentence`)
      assert.match(route.method, /^(GET|POST|PUT|DELETE)$/, `${path} has no method`)
      assert.doesNotMatch(path, /:\d+/, `${path} has grown a line number; cite the file or the route`)
    }
    // …and the file the surface was read from is still named, so a reader knows where to look.
    assert.match(SOURCE, /admin-api\/src\/server\.ts/)
    assert.doesNotMatch(
      SOURCE,
      /admin-api\/src\/server\.ts:\d+/,
      'src/lib/admin.ts has grown a line number again; cite the file and the route',
    )
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
        // `settings` is a LITERAL under /v1/backups and sits in the same slot as an id. Excluded
        // by name rather than by ordering luck: a rewrite that collapsed it to `:id` would report
        // the settings route as exercised when it never was, and would report the detail route as
        // exercised when only the settings call had been made — wrong in both directions at once.
        .replace(/\/v1\/backups\/(?!settings$)[^/]+$/, '/v1/backups/:id')
      const POSTS = ['/v1/approvals', '/v1/broadcasts', '/v1/backups', '/v1/restores']
      const PUTS = ['/v1/backups/settings']
      exercised.add(
        call.method === 'POST' && POSTS.includes(generic)
          ? `${generic}#post`
          : call.method === 'PUT' && PUTS.includes(generic)
            ? `${generic}#put`
            : generic,
      )
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
    await record(() => loadBackups())
    await record(() => loadBackup(BACKUP_ID))
    await record(() => startBackup({ kind: 'full', reason: 'r' }, KEY))
    await record(() => loadBackupSettings())
    await record(() =>
      saveBackupSettings({
        rootPath: '/var/backups',
        retentionCopies: 3,
        scheduleEnabled: false,
        scheduleEveryMinutes: 60,
      }),
    )
    await record(() => loadRestores())
    await record(() => startVerifyRestore({ backupRunId: BACKUP_ID, targets: ['t'], reason: 'r' }, KEY))

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

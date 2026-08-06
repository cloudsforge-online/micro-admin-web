/**
 * Where this bundle may be served from, and what it refuses.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE TEST IN THIS FILE THAT IS ABOUT SECURITY RATHER THAN CONFIGURATION.
 *
 * An operator console reachable from an origin a member of the public already has open is the
 * thing this repository exists not to be. `placement()` returns `public-origin` for every public
 * surface in the registry, and `App` renders a refusal rather than the console.
 *
 * The list is DERIVED from the registry rather than written down, so a product added next year is
 * covered without anybody remembering to come back here — and these tests walk the registry to
 * prove the derivation is right rather than restating the same list a third time.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { SURFACES, cloudsforgeHosts, type CloudsForgeHosts } from '@cloudsforge/ui'
import {
  APP_NAME,
  FORESIGHT_SURFACE,
  PRODUCT,
  PUBLIC_SURFACE_KEYS,
  apiBase,
  foresightApiBase,
  isLocal,
  placement,
  resolveApiBase,
  servedFromPublicOrigin,
} from '../src/lib/hosts.ts'
import { installWindow, removeWindow } from './browser-stubs.ts'

afterEach(removeWindow)

/** The production host table, as `cloudsforgeHosts()` derives it from an apex hostname. */
function production(): CloudsForgeHosts {
  installWindow('https://admin.cloudsforge.online/')
  const hosts = cloudsforgeHosts()
  removeWindow()
  return hosts
}

describe('the surface this console is', () => {
  it('is the admin surface', () => {
    assert.equal(PRODUCT, 'admin')
  })

  it('reports itself to the observability ingest under its repository name', () => {
    assert.equal(APP_NAME, 'admin-web')
  })

  it('is an adminOnly entry in the registry, so it is hidden from a player’s switcher', () => {
    assert.equal(SURFACES.find((s) => s.key === 'admin')?.adminOnly, true)
  })

  it('wears clay, which the registry gives it an explicit block for', () => {
    assert.equal(SURFACES.find((s) => s.key === 'admin')?.accent, '#c2704f')
  })
})

describe('the API base', () => {
  it('is EMPTY in production, because the console and admin-api share an origin', () => {
    // This is the case that matters: every request is relative and the bundle names no host.
    const hosts = production()
    assert.equal(resolveApiBase('https://admin.cloudsforge.online', hosts, 'admin'), '')
  })

  it('is absolute when the page is somewhere else — under `pnpm dev`, for instance', () => {
    const hosts = production()
    assert.equal(
      resolveApiBase('http://localhost:5183', hosts, 'admin'),
      'https://admin.cloudsforge.online',
    )
  })

  it('is absolute when there is no page origin at all', () => {
    const hosts = production()
    assert.equal(resolveApiBase('', hosts, 'admin'), 'https://admin.cloudsforge.online')
  })

  it('resolves through cloudsforgeHosts() at call time, never a module constant', () => {
    installWindow('https://admin.cloudsforge.online/')
    assert.equal(apiBase(), '')
    removeWindow()
    installWindow('http://localhost:5183/')
    // A different answer from the same function on the same bundle: the host is resolved per call.
    assert.notEqual(apiBase(), '')
  })

  it('names no hostname of its own — the value comes from the registry', () => {
    installWindow('https://admin.example.test/')
    // An apex the registry does not know is left alone, so the base is derived from it rather
    // than from a literal baked in here.
    assert.equal(apiBase(), '')
  })
})

describe('the public origins this console refuses to be served from', () => {
  const hosts = production()

  it('includes every product', () => {
    for (const product of SURFACES.filter((s) => s.kind === 'product')) {
      assert.ok(
        PUBLIC_SURFACE_KEYS.includes(product.key),
        `${product.key} is a product and is not in the refusal list`,
      )
    }
  })

  it('includes Forge Hub, which is where a signed-in player lives', () => {
    assert.ok(PUBLIC_SURFACE_KEYS.includes('hub'))
  })

  it('includes the marketing site at the apex', () => {
    assert.ok(PUBLIC_SURFACE_KEYS.includes('site'))
  })

  it('includes the account portal', () => {
    assert.ok(PUBLIC_SURFACE_KEYS.includes('account'))
  })

  it('includes the public status page and the explorer', () => {
    assert.ok(PUBLIC_SURFACE_KEYS.includes('status'))
    assert.ok(PUBLIC_SURFACE_KEYS.includes('explorer'))
  })

  it('does NOT include admin, which is this console’s own home', () => {
    assert.equal(PUBLIC_SURFACE_KEYS.includes('admin'), false)
  })

  it('does NOT include the other two operator tools', () => {
    // Lantern and Beacon are adminOnly. Being served from one of them would be a routing mistake
    // rather than a public exposure, and `unregistered` is the right answer for it.
    assert.equal(PUBLIC_SURFACE_KEYS.includes('lantern'), false)
    assert.equal(PUBLIC_SURFACE_KEYS.includes('beacon'), false)
  })

  it('refuses the marketing apex', () => {
    assert.equal(servedFromPublicOrigin('https://cloudsforge.online', hosts), true)
  })

  it('refuses Forge Hub’s origin', () => {
    assert.equal(servedFromPublicOrigin('https://hub.cloudsforge.online', hosts), true)
  })

  it('refuses every product origin, walked from the registry', () => {
    for (const product of SURFACES.filter((s) => s.kind === 'product')) {
      const origin = new URL(hosts[product.key]).origin
      assert.equal(servedFromPublicOrigin(origin, hosts), true, `${product.key} was not refused`)
    }
  })

  it('accepts admin’s own origin', () => {
    assert.equal(servedFromPublicOrigin('https://admin.cloudsforge.online', hosts), false)
  })

  it('accepts no origin at all rather than refusing on a blank', () => {
    assert.equal(servedFromPublicOrigin('', hosts), false)
  })
})

describe('placement', () => {
  const hosts = production()

  it('is ok on admin’s own origin', () => {
    assert.equal(placement('https://admin.cloudsforge.online', 'admin.cloudsforge.online', hosts), 'ok')
  })

  it('is public-origin on a product origin, and that outranks everything', () => {
    assert.equal(placement('https://hub.cloudsforge.online', 'hub.cloudsforge.online', hosts), 'public-origin')
  })

  it('checks the public origin FIRST, before the registered check', () => {
    // The public case is a security problem; the unregistered case is a configuration one. An
    // ordering that reported the milder answer would render the console on a public address.
    assert.equal(placement('https://trade.cloudsforge.online', 'trade.cloudsforge.online', hosts), 'public-origin')
  })

  it('is unregistered on another operator surface’s origin', () => {
    // Lantern is adminOnly, so it is not a public exposure — but it is not this console's home
    // either, and `cloudsforgeHosts()` would be deriving every URL from the right apex while the
    // bundle sits at the wrong address. A warning, not a refusal.
    assert.equal(
      placement('https://lantern.cloudsforge.online', 'lantern.cloudsforge.online', hosts),
      'unregistered',
    )
  })

  it('REFUSES an address the surface registry does not know, and this is not a false positive', () => {
    // `cloudsforgeHosts()` strips only KNOWN subdomains, so this bundle at
    // `operators.cloudsforge.online` treats that whole name as the apex — which makes it
    // identical to the marketing site's origin, since the site's subdomain is the empty string.
    // The verdict is therefore `public-origin` rather than `unregistered`, and the refusal is the
    // RIGHT outcome for a second reason: at that address the console cannot resolve admin-api
    // (it would look for `admin.operators.cloudsforge.online`) and cannot sign anybody in. A
    // preview deployment of this console does not work, and refusing to start beats a console
    // that renders and then fails every request without saying why. The refusal screen names both
    // readings; see MisplacedBundle in src/app.tsx.
    installWindow('https://operators.cloudsforge.online/')
    const derived = cloudsforgeHosts()
    removeWindow()
    assert.equal(
      placement('https://operators.cloudsforge.online', 'operators.cloudsforge.online', derived),
      'public-origin',
    )
  })

  it('is ok on localhost, because cloudsforgeHosts() exempts it', () => {
    installWindow('http://localhost:5183/')
    const local = cloudsforgeHosts()
    removeWindow()
    assert.equal(placement('http://localhost:5183', 'localhost', local), 'ok')
  })

  it('is ok on 127.0.0.1', () => {
    installWindow('http://127.0.0.1:5183/')
    const local = cloudsforgeHosts()
    removeWindow()
    assert.equal(placement('http://127.0.0.1:5183', '127.0.0.1', local), 'ok')
  })

  it('is ok with no page origin, so a prerender does not render a refusal', () => {
    assert.equal(placement('', 'admin.cloudsforge.online', hosts), 'ok')
  })
})

describe('the four names treated as development', () => {
  it('matches cloudsforgeHosts()’ own list', () => {
    assert.equal(isLocal(''), true)
    assert.equal(isLocal('localhost'), true)
    assert.equal(isLocal('127.0.0.1'), true)
    assert.equal(isLocal('anything.local'), true)
  })

  it('does not treat production as local', () => {
    assert.equal(isLocal('admin.cloudsforge.online'), false)
  })

  it('does not treat a hostname merely CONTAINING localhost as local', () => {
    assert.equal(isLocal('localhost.evil.test'), false)
  })
})

/* ═══════════════ the Foresight API, which is the one cross-origin call in the bundle ═══════════════ */

/**
 * `foresightApiBase()` is absolute ALWAYS, and that is the property rather than an accident.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE MISTAKE IT RULES OUT IS A REQUEST FOR JSON ANSWERED WITH THIS CONSOLE'S OWN index.html.
 *
 * `apiBase()` returns '' in production, because the console and `admin-api` share `admin.<apex>`.
 * If the Foresight screens resolved their base the same way, a future edit that made this bundle's
 * origin look like foresight's — or a `resolveApiBase` that returned '' for any reason — would
 * send `GET /markets` to `admin.<apex>/markets`. The gateway's `cf-api-admin` claims only `/v1` on
 * that host (deploy/gateway/dynamic/estate-web.yml), so the request would fall through to
 * `cf-web-admin` and be answered by the app shell: a 200, carrying HTML, where JSON was expected.
 * That failure is silent in the network tab and shows up as a JSON parse error naming the wrong
 * thing — the exact shape `deploy/scripts/surface-routes.py` check 3 exists to prevent at the
 * gateway, asserted here at the client.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
describe('the Foresight API base', () => {
  it('is the foresight surface, not this console', () => {
    assert.equal(FORESIGHT_SURFACE, 'foresight')
    assert.notEqual(FORESIGHT_SURFACE, PRODUCT)
  })

  it('is ABSOLUTE from this console’s own production origin', () => {
    installWindow('https://admin.cloudsforge.online/')
    assert.equal(foresightApiBase(), 'https://foresight.cloudsforge.online')
  })

  it('is absolute under `pnpm dev` too, at the registry’s devPort', () => {
    // 4021, and the registry's own comment records that it was briefly 4011 — beacon's — so a
    // local stack resolved foresight to the monitoring service.
    installWindow('http://localhost:5183/')
    assert.equal(foresightApiBase(), 'http://localhost:4021')
  })

  it('is NEVER the empty string, on any origin the console will render at', () => {
    // The invariant, walked rather than argued. An empty base means "relative", and a relative
    // /markets on this host is answered by this bundle.
    for (const origin of [
      'https://admin.cloudsforge.online/',
      'https://admin.cloudsforge.localtest.me/',
      'http://localhost:5183/',
      'http://127.0.0.1:5183/',
    ]) {
      installWindow(origin)
      assert.notEqual(foresightApiBase(), '', `relative base while served from ${origin}`)
      removeWindow()
    }
  })

  it('is STILL absolute when the page origin IS foresight’s — the case that distinguishes it', () => {
    // ══════════════════════════════════════════════════════════════════════════════════════════
    // THE ONLY ORIGIN THAT TELLS THE TWO IMPLEMENTATIONS APART, WHICH IS WHY IT IS TESTED.
    //
    // The first version of this suite walked the four origins the console legitimately renders at
    // and asserted the base was never ''. It passed — and it passed just as happily against a
    // `foresightApiBase()` written as `resolveApiBase(origin, hosts, 'foresight')`, because none
    // of those four origins IS foresight's, so `resolveApiBase` never reached its '' branch. A
    // check that cannot fail is not a check, and this estate has now found several.
    //
    // This is the branch. `resolveApiBase` returns '' here; reading the registry host returns the
    // absolute URL. Today `placement()` refuses to render at all on this origin, so the console
    // never asks the question — but that refusal is the ONLY thing standing between a relative
    // base and an operator panel making same-origin calls from the public product's page. Pinning
    // the absolute answer means the invariant does not depend on a second function staying right.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    installWindow('https://foresight.cloudsforge.online/')
    assert.equal(
      foresightApiBase(),
      'https://foresight.cloudsforge.online',
      'the Foresight base must never be relative, on any origin whatsoever',
    )
  })

  it('does not resolve to this console’s own origin, which would make it same-origin', () => {
    installWindow('https://admin.cloudsforge.online/')
    assert.notEqual(new URL(foresightApiBase()).origin, 'https://admin.cloudsforge.online')
  })

  it('names foresight as a PUBLIC origin this bundle refuses to be served from', () => {
    // The two facts together are the whole arrangement: this console CALLS foresight and must
    // never BE foresight. If the second ever stopped being true, the first would silently become
    // a same-origin call and the operator panel would be reachable from the public product.
    assert.ok(
      PUBLIC_SURFACE_KEYS.includes(FORESIGHT_SURFACE),
      'foresight must remain an origin this console refuses to render at',
    )
    const hosts = production()
    assert.equal(placement('https://foresight.cloudsforge.online', 'foresight.cloudsforge.online', hosts), 'public-origin')
  })
})

/**
 * The three descriptions of this console's addresses, checked against each other.
 *
 *   1. `src/lib/routes.ts` — the declaration, from which the navigation is derived.
 *   2. `src/app.tsx`       — which component renders at each path.
 *   3. `nginx.conf`        — which addresses are served the app shell at all.
 *
 * The third is what makes this test worth having. nginx enumerates the real routes and 404s
 * everything else on purpose, so that a wrong address answers 404 rather than 200 — an app that
 * answers 200 for every address serves its "page not found" screen as a success, which crawlers
 * index and monitors call healthy.
 *
 * The price of that honesty is that a route added to the router and not to nginx works perfectly
 * under `pnpm dev` and 404s on the first hard refresh in production. That failure survives review
 * because nothing about the diff looks wrong. This test is the mechanism instead.
 *
 * It reads `app.tsx` as TEXT rather than importing it: importing would pull in React, the router
 * and every page, and this suite deliberately has no DOM.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  DEEP_LINK_PATH,
  FORESIGHT_DEEP_LINK_PATH,
  FORESIGHT_NAV,
  NAV,
  NON_INDEX_PATHS,
  ROUTES,
} from '../src/lib/routes.ts'

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const appSource = read('src/app.tsx')
const nginx = read('nginx.conf')
const ci = read('.github/workflows/ci.yml')

/**
 * nginx.conf with its comments removed.
 *
 * The file's own header quotes the directive it forbids, in order to explain why the routes are
 * enumerated by hand — so a grep over the raw text matches the warning and fails a correct file.
 * The rule is about DIRECTIVES; strip the prose before checking it. The web template's own CI has
 * exactly this bug and fails on its own pristine config.
 */
const directives = nginx
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

/** The alternation inside nginx's enumerated `location ~ ^/(…)` block. */
function nginxPaths(): string[] {
  const match = /location\s+~\s+\^\/\(([^)]+)\)/.exec(directives)
  assert.ok(match, 'nginx.conf has no enumerated route block')
  return (match[1] ?? '').split('|').map((p) => p.trim())
}

describe('the route declaration', () => {
  it('is not empty, so this whole file cannot pass for the wrong reason', () => {
    assert.ok(ROUTES.length >= 6, `expected the route table, found ${ROUTES.length} entries`)
  })

  it('has exactly one index route, and it is the estate view', () => {
    // The screen that answers "is anything wrong". A console whose front page is a form makes the
    // operator navigate to the question they arrived with.
    const index = ROUTES.filter((r) => r.path === '')
    assert.equal(index.length, 1)
    assert.equal(index[0]?.label, 'Estate')
  })

  it('declares no duplicate path', () => {
    const paths = ROUTES.map((r) => r.path)
    assert.equal(new Set(paths).size, paths.length)
  })

  it('declares no path with a slash: these are TOP-LEVEL segments', () => {
    // nginx matches on the first segment and everything under it. A declaration of
    // `approvals/detail` would produce a location block that does not mean what it says.
    for (const route of ROUTES) {
      assert.ok(!route.path.includes('/'), `${route.path} is not a top-level segment`)
    }
  })

  it('marks approvals as a wildcard, because the detail page lives under it', () => {
    assert.equal(ROUTES.find((r) => r.path === 'approvals')?.wildcard, true)
  })

  it('marks the leaf pages as not wildcards', () => {
    for (const path of ['actions', 'audit', 'flags', 'broadcasts']) {
      assert.equal(ROUTES.find((r) => r.path === path)?.wildcard, false, path)
    }
  })

  it('offers every route in the navigation — none is reachable but hidden', () => {
    for (const route of ROUTES) assert.notEqual(route.label, null, route.path)
  })
})

describe('the navigation', () => {
  it('is derived from the declaration rather than restated', () => {
    const labelled = ROUTES.filter((r) => r.label !== null)
    assert.equal(NAV.length, labelled.length)
    assert.deepEqual(
      NAV.map((n) => n.to),
      labelled.map((r) => `/${r.path}`),
    )
  })

  it('points the first entry at the index, with the leading slash a NavLink needs', () => {
    assert.equal(NAV[0]?.to, '/')
  })

  it('offers the approvals queue, which is the screen with work waiting in it', () => {
    assert.ok(NAV.some((n) => n.to === '/approvals'))
  })

  it('offers the action catalogue, so §3.3g is findable', () => {
    // A gap nobody can find is a gap nobody closes.
    assert.ok(NAV.some((n) => n.to === '/actions'))
  })
})

describe('the router', () => {
  it('renders a route element for every non-index path', () => {
    for (const path of NON_INDEX_PATHS) {
      assert.match(appSource, new RegExp(`path="${path}"`), `app.tsx has no route for /${path}`)
    }
  })

  it('renders the detail route under approvals', () => {
    assert.match(appSource, /path="approvals\/:id"/)
  })

  it('has an index route', () => {
    assert.match(appSource, /<Route\s+index/)
  })

  it('has a catch-all, so an unknown address renders inside the shell', () => {
    assert.match(appSource, /path="\*"/)
  })

  it('puts every route behind the session gate', () => {
    // Not the security boundary — admin-api verifies the role on the request — but a signed-out
    // operator must be sent to sign in rather than shown a screen made entirely of 401s.
    const guards = appSource.match(/<ProtectedRoute>/g) ?? []
    assert.ok(
      guards.length >= NON_INDEX_PATHS.length + 1,
      `${guards.length} guards for ${NON_INDEX_PATHS.length + 1} routes`,
    )
  })

  it('refuses to render at all from a public origin, before the router is reached', () => {
    assert.match(appSource, /placement === 'public-origin'/)
    assert.match(appSource, /return <MisplacedBundle \/>/)
  })

  it('checks the placement BEFORE constructing the router', () => {
    const check = appSource.indexOf("placement === 'public-origin'")
    const router = appSource.indexOf('<BrowserRouter>')
    assert.ok(check > 0 && router > check, 'the origin check must come first')
  })
})

describe('nginx serves exactly the routes that exist', () => {
  it('enumerates every non-index path', () => {
    const served = nginxPaths()
    for (const path of NON_INDEX_PATHS) {
      assert.ok(served.includes(path), `nginx.conf does not serve /${path}`)
    }
  })

  it('enumerates nothing that is not a route', () => {
    for (const path of nginxPaths()) {
      assert.ok(
        NON_INDEX_PATHS.includes(path),
        `nginx.conf serves /${path}, which is not in the route table`,
      )
    }
  })

  it('serves the index', () => {
    assert.match(directives, /location = \/\s*\{/)
  })

  it('does NOT use the SPA 200-fallback', () => {
    // `try_files $uri /index.html` serves the bundle with a 200 for every address in existence.
    assert.doesNotMatch(directives, /try_files\s+\$uri\s+(\$uri\/\s+)?\/index\.html/)
  })

  it('keeps the honest 404 through error_page', () => {
    assert.match(directives, /error_page 404 \/index\.html/)
  })

  it('404s a missing asset rather than serving the shell for it', () => {
    // A JavaScript request answered with HTML fails with a syntax error naming the wrong file.
    assert.match(directives, /location \/assets\/\s*\{\s*try_files \$uri =404/)
  })

  it('sets the three security headers at the server level', () => {
    for (const header of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy']) {
      assert.match(directives, new RegExp(`add_header ${header}`), header)
    }
  })

  it('DENIES framing rather than allowing same-origin', () => {
    // Every other frontend uses SAMEORIGIN because it has legitimate same-origin embeds. This one
    // has none, and an operator console inside any frame is a clickjacking surface for a session
    // that can authorise a ledger reversal.
    assert.match(directives, /X-Frame-Options "DENY"/)
    assert.doesNotMatch(directives, /X-Frame-Options "SAMEORIGIN"/)
  })

  it('tells robots to stay away, in a header as well as a meta tag', () => {
    assert.match(directives, /X-Robots-Tag/)
  })

  it('restates the security headers in EVERY location that sets Cache-Control', () => {
    // nginx's add_header is all-or-nothing per level: a location that declares ANY add_header
    // inherits NONE from its parent. The template's `location /assets/` stripped nosniff from
    // every hashed script in every frontend cut from it.
    const blocks = directives.split(/location\s/).slice(1)
    for (const block of blocks) {
      if (!block.includes('Cache-Control')) continue
      assert.match(block, /X-Content-Type-Options/, `a Cache-Control location without nosniff: ${block.slice(0, 40)}`)
      assert.match(block, /X-Frame-Options/, `a Cache-Control location without frame-options: ${block.slice(0, 40)}`)
      assert.match(block, /Referrer-Policy/, `a Cache-Control location without referrer-policy: ${block.slice(0, 40)}`)
    }
  })

  it('never caches the shell', () => {
    const root = /location = \/\s*\{([^}]*)\}/.exec(directives)?.[1] ?? ''
    assert.match(root, /Cache-Control "no-store"/)
  })

  it('caches hashed assets immutably', () => {
    const assets = /location \/assets\/\s*\{([^}]*)\}/.exec(directives)?.[1] ?? ''
    assert.match(assets, /immutable/)
  })
})

describe('the CI deep-link probe names a real route', () => {
  it('is a path this console owns', () => {
    const segment = DEEP_LINK_PATH.split('/')[1] ?? ''
    assert.ok(
      NON_INDEX_PATHS.includes(segment),
      `${DEEP_LINK_PATH} starts at /${segment}, which is not a route`,
    )
  })

  it('is deep enough to exercise the wildcard rather than the top-level location', () => {
    assert.ok(DEEP_LINK_PATH.split('/').length >= 3, `${DEEP_LINK_PATH} is not a deep link`)
  })

  it('lands under a route declared as a wildcard', () => {
    const segment = DEEP_LINK_PATH.split('/')[1]
    assert.equal(ROUTES.find((r) => r.path === segment)?.wildcard, true)
  })

  it('is the path CI actually probes', () => {
    // A probe against a path the app does not own proves only that the 404 page renders, which is
    // the opposite of what the check is for.
    assert.ok(ci.includes(DEEP_LINK_PATH), `ci.yml does not probe ${DEEP_LINK_PATH}`)
  })

  it('CI also probes an address the console does NOT own, and requires a 404', () => {
    assert.match(ci, /nope\/not\/a\/route/)
    assert.match(ci, /"404"/)
  })
})

/* ══════════════════════ the Foresight section, folded in at P13 ══════════════════════ */

/**
 * The fold's own routing, checked at the three layers that have to agree about it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE FAILURE THIS GUARDS IS A DEEP LINK THAT WORKS UNDER `pnpm dev` AND 404s IN PRODUCTION.
 *
 * `/foresight/markets/<uuid>` is the address an operator pastes into a chat window when they want
 * a second pair of eyes before resolving a market — which is to say it is the one address in this
 * section that is followed COLD, in a fresh tab, by somebody who was not already on the page. That
 * is exactly the path a client-side router serves perfectly and nginx has never heard of.
 *
 * It is also a segment deeper than anything this console routed before today. Every previous
 * wildcard was two segments (`/approvals/<uuid>`); this is three. The nginx block matches on the
 * FIRST segment and everything under it, so three works for the same reason two does — but "so it
 * should" is precisely what this estate has been wrong about before, which is why it is asserted
 * rather than reasoned about.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
describe('the Foresight section', () => {
  it('is one top-level route, not three', () => {
    // The three screens are one product's lifecycle. Promoting them into the estate's own
    // workflow bar would put "Markets" beside "Approvals" as if they were the same kind of thing.
    const foresight = ROUTES.filter((r) => r.path.startsWith('foresight'))
    assert.equal(foresight.length, 1, `expected one foresight route, found ${foresight.length}`)
    assert.equal(foresight[0]?.path, 'foresight')
  })

  it('is a WILDCARD, because markets and the market detail live under it', () => {
    // Without this the route table would claim `/foresight` is a leaf, and the next person to read
    // it would have no reason to keep the nginx alternation matching everything beneath.
    assert.equal(ROUTES.find((r) => r.path === 'foresight')?.wildcard, true)
  })

  it('is offered in the top-level navigation', () => {
    assert.ok(NAV.some((n) => n.to === '/foresight'), 'the fold is unreachable from the nav')
  })

  it('declares its three screens as a SECOND-level nav, never as top-level routes', () => {
    // A path with a slash in it would produce an nginx location block that does not mean what it
    // says — which is what the top-level test above forbids. These live in their own table.
    assert.equal(FORESIGHT_NAV.length, 3)
    for (const item of FORESIGHT_NAV) {
      assert.ok(item.to.startsWith('/foresight'), `${item.to} is not inside the section`)
    }
    assert.deepEqual(
      FORESIGHT_NAV.map((n) => n.to),
      ['/foresight', '/foresight/markets', '/foresight/categories'],
    )
  })

  it('ends the index link and NOT the markets link', () => {
    // `end` decides which link lights up. Without it on the index, the queue link would stay lit
    // on every screen in the section; WITH it on markets, the section link would go dark the
    // moment an operator opened a market — while they are still in it.
    assert.equal(FORESIGHT_NAV.find((n) => n.to === '/foresight')?.end, true)
    assert.equal(FORESIGHT_NAV.find((n) => n.to === '/foresight/markets')?.end, false)
  })

  it('mounts all four screens in the router, nested under the one path', () => {
    assert.match(appSource, /path="foresight"/)
    assert.match(appSource, /path="markets"/)
    assert.match(appSource, /path="markets\/:id"/)
    assert.match(appSource, /path="categories"/)
  })

  it('puts the section layout AND every screen under it behind the session gate', () => {
    // Wrapping only the layout looks sufficient and is not: a child route renders inside a parent
    // that has already returned its children. Wrapping only the children would leave the section's
    // navigation visible to a signed-out browser.
    const section = appSource.slice(appSource.indexOf('path="foresight"'))
    const guards = section.match(/<ProtectedRoute>/g) ?? []
    assert.ok(guards.length >= 4, `${guards.length} guards inside the foresight section`)
  })

  it('catches an unknown address INSIDE the section rather than falling to the index', () => {
    // Without a nested catch-all, `/foresight/marketz` matches the section index and renders the
    // idea queue — a 200 for a route that does not exist, which is the exact thing nginx.conf's
    // enumeration exists to prevent, reintroduced one layer up.
    const section = appSource.slice(appSource.indexOf('path="foresight"'))
    const end = section.indexOf('{/* Unknown paths render inside the shell')
    assert.ok(end > 0, 'could not find the end of the foresight section')
    assert.match(section.slice(0, end), /path="\*"/)
  })

  it('is served by nginx, under the same enumerated block', () => {
    assert.ok(nginxPaths().includes('foresight'), 'nginx.conf does not serve /foresight')
  })
})

describe('the Foresight deep link, which is three segments rather than two', () => {
  it('starts at a route this console owns', () => {
    const segment = FORESIGHT_DEEP_LINK_PATH.split('/')[1] ?? ''
    assert.ok(NON_INDEX_PATHS.includes(segment), `/${segment} is not a route`)
  })

  it('lands under a route declared as a wildcard', () => {
    const segment = FORESIGHT_DEEP_LINK_PATH.split('/')[1]
    assert.equal(ROUTES.find((r) => r.path === segment)?.wildcard, true)
  })

  it('is genuinely three segments deep, which is what makes it worth probing separately', () => {
    // `DEEP_LINK_PATH` already proves two. If this ever shortened to two it would stop testing
    // anything the other probe does not, while still passing.
    assert.equal(
      FORESIGHT_DEEP_LINK_PATH.split('/').filter(Boolean).length,
      3,
      `${FORESIGHT_DEEP_LINK_PATH} is not three segments deep`,
    )
  })

  it('is matched by the nginx block, which anchors on the FIRST segment only', () => {
    // The assertion the whole describe exists for: reconstruct nginx's own regex and run the
    // three-segment path through it, rather than trusting that `(/|$)` behaves as read.
    const alternation = nginxPaths().join('|')
    assert.match(FORESIGHT_DEEP_LINK_PATH, new RegExp(`^/(${alternation})(/|$)`))
  })

  it('is the path CI actually probes', () => {
    // A probe against a path the app does not own proves only that the 404 page renders.
    assert.ok(ci.includes(FORESIGHT_DEEP_LINK_PATH), `ci.yml does not probe ${FORESIGHT_DEEP_LINK_PATH}`)
  })
})

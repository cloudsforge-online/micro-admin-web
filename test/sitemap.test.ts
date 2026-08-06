/**
 * What this console tells a crawler, and the ONE registry field all of it is derived from.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE POINT OF THIS FILE IS THAT NOTHING IN IT IS A DECISION.
 *
 * `admin`'s registry row carries `adminOnly: true`. Four consequences follow from that one field,
 * in four different files, and this suite checks that every one of them still does:
 *
 *   1. `robotsDirective()` returns `noindex, nofollow`               — @cloudsforge/ui/seo.ts
 *   2. the estate sitemap omits this surface                         — @cloudsforge/ui/sitemap.ts
 *   3. `/robots.txt` answers `Disallow: /`                           — nginx.conf, here
 *   4. `<meta name="robots">` says the same, statically and at runtime — index.html, lib/meta.ts
 *
 * The reason to derive rather than to decide, four times over, is that a console hidden by four
 * independent opinions is a console that becomes visible when one of them is edited by somebody
 * who did not know about the other three. Hiding is NOT the security boundary — `admin-api`
 * verifies the `admin` role on every request (`requireOperator`, admin-api/src/server.ts) —
 * but publishing an operator console's address, name and purpose to anyone who searches is
 * reconnaissance handed over for free, and there is no argument at all for the alternative.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE BODIES ARE IN nginx.conf RATHER THAN IN public/
 *
 * `/robots.txt` did not exist in this repository at all until now. public/ holds three favicons
 * and nothing else, so the address fell through to `location /`, 404'd, and
 * `error_page 404 /index.html` answered a crawler's question about what it may crawl with the
 * console's own HTML — which every crawler reads as "there are no rules here". The absent file was
 * the permissive answer, and it had been the permissive answer since the console shipped.
 *
 * It is a location rather than a file because its sibling `/sitemap.xml` has to be one — an
 * explicit 404, so that a request for this console's sitemap is not answered with the console —
 * and keeping the pair together is what lets one test read both. A body pasted into a config file
 * is a copy, and this estate has been bitten by exactly one of those: `site/index.html`'s title
 * drifted from its application's, the suite stayed green, and every search result carried a
 * sentence the owner had asked to have removed until somebody opened the served HTML rather than
 * the page. Both blocks are therefore treated as GENERATED OUTPUT that happens to live in a config
 * file.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { ENV_LABELS, surface } from '@cloudsforge/ui'
import { robotsDirective } from '@cloudsforge/ui/seo'
import { SITEMAP_SURFACES, robotsTxt } from '@cloudsforge/ui/sitemap'
import { PRODUCT } from '../src/lib/hosts.ts'
import { ROBOTS } from '../src/lib/meta.ts'

const at = (file: string): string =>
  readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const nginx = at('nginx.conf')
const html = at('index.html')

/*
 * Both files ARGUE for their own contents at length, and the arguments name the very tokens the
 * assertions below look for — `<meta name="cf-analytics">` in the block explaining why there is
 * none, `$cf_env` in the block explaining why robots.txt does not consult it. A check that read
 * the prose would report the explanation as the thing it forbids. So the comments come off first,
 * and every assertion is made against what nginx and a browser actually see.
 */
const htmlCode = html.replace(/<!--[\s\S]*?-->/g, '')
const nginxCode = nginx
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')

/** The single-quoted body of a `return 200 '…';` inside an exact-match location. */
function servedBody(path: string): string {
  const block = new RegExp(`location = ${path.replace('.', '\\.')} \\{([\\s\\S]*?)\\n    \\}`).exec(
    nginx,
  )
  assert.ok(block, `nginx.conf has no exact-match location for ${path}`)
  const body = /\n {8}return 200 '([\s\S]*?)';/.exec(block[1] ?? '')
  assert.ok(body, `the ${path} location does not return an unconditional literal body`)
  return body[1] ?? ''
}

describe('the registry is what makes this console invisible', () => {
  it('marks admin as operator-only, which is the field everything else reads', () => {
    assert.equal(surface(PRODUCT).adminOnly, true)
  })

  it('derives noindex from it rather than from anything in this repository', () => {
    assert.equal(robotsDirective(surface(PRODUCT)), 'noindex, nofollow')
  })

  it('keeps this surface out of the ESTATE sitemap that site serves', () => {
    // The other half of the same decision. A sitemap is an INVITATION and a robots directive is an
    // INSTRUCTION, and the two must not disagree: an address disallowed here and listed there is
    // an address whose own estate is arguing with itself about whether to publish it.
    assert.equal(
      SITEMAP_SURFACES.some((s) => s.key === PRODUCT),
      false,
      'admin appears in the estate sitemap',
    )
  })

  it('is a real check — the filter does list the surfaces that ARE public', () => {
    // Without this, the assertion above would pass just as happily against an empty list.
    assert.ok(SITEMAP_SURFACES.length > 0)
    assert.ok(SITEMAP_SURFACES.some((s) => s.key === 'site'))
  })
})

describe('the robots directive is spelled once', () => {
  it('starts with exactly what the registry derives', () => {
    assert.ok(
      ROBOTS.startsWith(robotsDirective(surface(PRODUCT))),
      `${ROBOTS} does not begin with the registry's directive`,
    )
  })

  it('adds this console’s own two, which the registry cannot know about', () => {
    // `noarchive` — a cached copy of an operator console is a copy of whatever the crawled operator
    // could see, served by somebody else, for as long as they keep it. `noimageindex` — the estate
    // view and the audit are pictures of live estate health.
    assert.match(ROBOTS, /\bnoarchive\b/)
    assert.match(ROBOTS, /\bnoimageindex\b/)
  })

  it('is the SAME string the served HTML carries, byte for byte', () => {
    /*
     * THE DRIFT THIS EXISTS TO CATCH, and it is not hypothetical on this surface. `applyHead()`
     * REWRITES `<meta name="robots">` on every client-side navigation. If `lib/meta.ts` stopped
     * passing the override, the tag in the document would be rewritten from four directives to two
     * a moment after the page loaded — visible in no test that reads index.html, and in no browser
     * anybody thought to open, because the static file would still look right.
     */
    const served = /<meta name="robots" content="([^"]+)"/.exec(htmlCode)?.[1]
    assert.equal(served, ROBOTS)
  })

  it('leaves no analytics measurement ID in the shell, and therefore no tag to inject', () => {
    /*
     * The absence is the decision, so it is asserted rather than assumed. `analyticsId()` reads
     * this meta name; with none present it returns null, `CookieBanner` renders nothing and
     * `grantConsent()` returns before it can build a script element. An operator console's
     * addresses ARE estate identifiers — /approvals/<uuid>, /backups/<uuid> — and GA4 reports
     * `page_location` on every hit.
     */
    assert.equal(/<meta name="cf-analytics"/.test(htmlCode), false)
    // And no third-party tag, ever, by any spelling. This is the check that has to survive an edit
    // by somebody who does not know why the line above matters.
    assert.equal(/googletagmanager|gtag\/js|google-analytics/i.test(htmlCode), false)
  })
})

describe('the environment map', () => {
  it('is in http context, above the server block, where `map` is legal', () => {
    const mapAt = nginx.indexOf('map $host $cf_env')
    const serverAt = nginx.indexOf('\nserver {')
    assert.ok(mapAt > 0, 'nginx.conf declares no $cf_env map')
    assert.ok(mapAt < serverAt, 'the map is inside the server block, where it is not legal')
  })

  it('names exactly the environment labels the registry reserves', () => {
    // Read off the alternation rather than restated, so a label added to `ENV_LABELS` and not to
    // this file fails here rather than in an estate that quietly indexed a testnet.
    const alternation = /\(\?:((?:[a-z]+\|)+[a-z]+)\)\\\./.exec(nginx)?.[1]
    assert.ok(alternation, 'the $cf_env map has no recognisable label alternation')
    assert.deepEqual([...alternation.split('|')].sort(), [...ENV_LABELS].sort())
  })

  it('matches BOTH host shapes, the suffix one and the old apex-prefix one', () => {
    // `admin-testnet.<apex>` today; `testnet.<apex>` before, which put this console at the
    // two-label `admin.testnet.<apex>` that the edge's one-label wildcard certificate cannot serve.
    // `surfaces.ts` keeps the old shape deliberately, so both have to match.
    assert.match(nginx, /~\^\(\?:\[\^.\]\+-\)\?\(\?:/)
  })
})

describe('robots.txt', () => {
  it('is served by an exact-match location rather than being absent', () => {
    assert.match(nginx, /location = \/robots\.txt \{/)
  })

  it('is byte for byte what the design system composes for a surface that is not indexable', () => {
    assert.equal(servedBody('/robots.txt'), robotsTxt({ indexable: false }))
  })

  it('refuses UNCONDITIONALLY — there is no mainnet branch on this surface', () => {
    /*
     * The difference between this console and every public surface in the estate. There, the
     * `Disallow: /` body is the NON-MAINNET branch guarded by `if ($cf_env)` and `Allow: /` is what
     * mainnet gets. Here mainnet is refused too, so `$cf_env` is not consulted at all inside this
     * location — and a conditional appearing in it later would mean somebody had made this console
     * crawlable in production without saying so.
     */
    const block = /location = \/robots\.txt \{([\s\S]*?)\n {4}\}/.exec(nginxCode)?.[1] ?? ''
    assert.equal(block.includes('$cf_env'), false, 'robots.txt branches on the environment')
    assert.match(block, /Disallow: \//)
    assert.equal(/Allow: \//.test(block), false)
  })

  it('names no sitemap, because naming one would publish the list it disallows', () => {
    assert.equal(servedBody('/robots.txt').includes('Sitemap:'), false)
  })

  it('names no hostname, so one artefact is correct on every origin it is served from', () => {
    // test/no-build-time-config.test.ts is the rule; this is the one document in the repository
    // that could plausibly have broken it, since robots.txt is where a `Sitemap:` absolute URL
    // would go.
    assert.equal(/cloudsforge\.(com|online|localtest)/.test(servedBody('/robots.txt')), false)
  })

  it('restates the security headers, because a location that sets any inherits none', () => {
    const block = /location = \/robots\.txt \{([\s\S]*?)\n {4}\}/.exec(nginx)?.[1] ?? ''
    for (const header of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy']) {
      assert.match(block, new RegExp(`add_header ${header} `), `robots.txt drops ${header}`)
    }
    // DENY rather than SAMEORIGIN, matching the server level: this console has no legitimate embed.
    assert.match(block, /X-Frame-Options "DENY"/)
  })
})

describe('sitemap.xml, which this surface deliberately does not have', () => {
  it('answers 404 rather than falling through to the app shell', () => {
    /*
     * Without this location the address reaches `location /`, 404s, and `error_page 404
     * /index.html` serves the console's own bundle in the body. The status would be honest and the
     * body would not: a crawler asking for this console's sitemap would be handed the console.
     */
    const block = /location = \/sitemap\.xml \{([\s\S]*?)\n {4}\}/.exec(nginx)?.[1]
    assert.ok(block, 'nginx.conf has no exact-match location for /sitemap.xml')
    assert.match(block, /return 404;/)
  })

  it('returns no body at all — not an empty urlset, which would be a claim', () => {
    const block = /location = \/sitemap\.xml \{([\s\S]*?)\n {4}\}/.exec(nginx)?.[1] ?? ''
    assert.equal(block.includes('urlset'), false)
    assert.equal(block.includes('return 200'), false)
  })
})

/**
 * A frontend ships its own browser chrome, or it ships none at all.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS FILE DIVERGES FROM THE TEMPLATE'S IN EXACTLY ONE PLACE, AND THE DIVERGENCE IS ARGUED HERE
 * RATHER THAN HIDDEN.
 *
 * `micro-web-template/test/brand-chrome.test.ts` requires an `og:title` and a relative `og:image`,
 * and it is right to for every surface it was written for. FOUR FINISHED FRONTENDS SHIPPED WITH NO
 * FAVICON AT ALL and went green in CI, because nothing anywhere asserted that a page has an icon
 * (§3.3e). Those checks are carried over here VERBATIM, in both directions.
 *
 * The og requirement is the one place it does not fit. `brand/assets/admin/` holds three favicons
 * and a mark and NO og card, and that is a decision rather than an omission —
 * 18-build-status.md §3.3k, which audited all fourteen planned frontends against the brand sets,
 * records it in one line: "`admin` deliberately does not [have one] — nobody shares an operator
 * console outward, and a card there would exist to satisfy a pattern rather than a need." The
 * paragraph directly above it says `developers` DOES have one now, because devportal-web is a
 * public surface whose links get shared. The distinction is the point.
 *
 * There were three ways to respond and two of them are worse than the problem:
 *
 *   * **Generate an og card.** That is producing an asset to satisfy a test, against a decision
 *     the brand audit recorded on purpose — and it puts a shareable preview of the operator
 *     console into the world, which is the thing §3.3k declined to do.
 *   * **Delete the check.** That is the guard being removed by the first repository it
 *     inconveniences, which is how §3.3e happened in the first place.
 *   * **Point a guard of EQUAL FORCE at what is actually required here.** Which is what the three
 *     tests at the bottom of this file do: they assert the deliberate ABSENCE, so adding an og
 *     card to this console later fails the build and has to be argued for, exactly as removing
 *     one from a public surface would.
 *
 * The favicon checks — the ones that catch the defect the template was written for — are
 * unchanged and unweakened. Nothing here is skipped, and every test can fail.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))
const HTML = readFileSync(at('index.html'), 'utf8')

/** The sizes a browser and an install prompt actually ask for. */
const REQUIRED_ICONS = ['favicon-32x32.png', 'favicon-192x192.png']

/* ══════════════════ carried over from the template, unchanged ══════════════════ */

test('the icons a browser asks for are present in public/', () => {
  const missing = REQUIRED_ICONS.filter((f) => !existsSync(at(`public/${f}`)))
  assert.deepEqual(
    missing,
    [],
    `public/ is missing ${missing.join(', ')} — copy them from micro-brand's assets/admin/`,
  )
})

test('index.html links every icon it ships, and ships every icon it links', () => {
  // Both directions. A link to a file that is not there is a 404 in every tab; a file nobody links
  // is dead weight that looks like it is working.
  for (const f of REQUIRED_ICONS) {
    assert.ok(HTML.includes(f), `index.html does not link /${f}`)
  }
  for (const m of HTML.matchAll(/href="\/(favicon[^"]*)"/g)) {
    assert.ok(existsSync(at(`public/${m[1]}`)), `index.html links /${m[1]}, which is not in public/`)
  }
})

test('the icons are this surface’s own, not the template’s placeholders', () => {
  // The template ships the company marks so that a freshly cut frontend is never iconless. Leaving
  // them in place passes every check above and puts the wrong brand in the tab.
  const brand = '../brand/assets/admin'
  for (const icon of REQUIRED_ICONS) {
    const here = readFileSync(at(`public/${icon}`))
    const source = at(`${brand}/${icon}`)
    if (!existsSync(source)) continue
    assert.deepEqual(
      here,
      readFileSync(source),
      `public/${icon} is not the byte-identical copy from brand/assets/admin/`,
    )
  }
})

/* ══════════════════ the divergence: an og card is REFUSED here ══════════════════ */

test('this surface ships NO og card, because §3.3k decided it should not', () => {
  const stray = readdirSync(at('public')).filter((f) => f.startsWith('og'))
  assert.deepEqual(
    stray,
    [],
    `public/ holds ${stray.join(', ')}. brand/assets/admin/ has no og card on purpose ` +
      '(18-build-status.md §3.3k): nobody shares an operator console outward. If this is being ' +
      'added, the brand audit is what has to change first.',
  )
})

test('index.html declares no og:image, so no link preview of this console exists', () => {
  assert.doesNotMatch(
    HTML,
    /property="og:image"/,
    'an og:image here would produce a shareable preview card for the operator console',
  )
})

test('index.html declares no og metadata at all', () => {
  // Not only the image. An og:title alone still makes the console render as a card in a chat
  // client, with its name and description, which is the outcome §3.3k declined.
  const tags = [...HTML.matchAll(/property="(og:[^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(tags, [], `index.html declares ${tags.join(', ')}`)
})

test('index.html tells crawlers to stay away, which is what stands in for the card', () => {
  // The positive form of the same decision, so this file asserts a requirement rather than only
  // an absence. nginx.conf sends the same instruction as a header; test/routes.test.ts checks it.
  assert.match(HTML, /name="robots"/)
  assert.match(HTML, /noindex/)
})

test('the reason for the divergence is written down where the next reader will look', () => {
  // Without this, the next person to run the template's test against this repository concludes the
  // og card was forgotten and adds one.
  assert.match(HTML, /§3\.3k/, 'index.html does not cite the decision')
  const readme = readFileSync(at('README.md'), 'utf8')
  assert.match(readme, /og/i, 'README.md does not mention the missing og card')
  assert.match(readme, /3\.3k/, 'README.md does not cite §3.3k')
})

/* ══════════════════ the icons have to reach the IMAGE, not only the repo ══════════════════ */

test('the Dockerfile copies public/ into the build context', () => {
  // `micro-web-template`'s Dockerfile copies tsconfig, vite.config, index.html and src — and not
  // public — so Vite has no publicDir to copy and every frontend cut from it builds an image whose
  // dist/ has no favicon in it, while this very test passes because it reads the SOURCE tree. The
  // icons are wired, committed, tested, and absent from the artefact that is actually served.
  // Reported to micro-web-template; corrected here, and pinned so it cannot be lost again.
  const dockerfile = readFileSync(at('Dockerfile'), 'utf8')
  assert.match(
    dockerfile,
    /^COPY public \.\/public$/m,
    'the Dockerfile does not copy public/, so the built image will have no favicon',
  )
})

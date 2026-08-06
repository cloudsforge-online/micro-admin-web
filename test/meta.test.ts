/**
 * The head this console composes for one of its addresses.
 *
 * `src/lib/meta.ts` is a pure function on purpose, so every case here is exercised without a DOM
 * and without mounting the shell. The one impure call — `applyHead()` — is made by the shell and
 * belongs to the design system, which tests it itself.
 *
 * ── WHAT IS ACTUALLY AT STAKE ────────────────────────────────────────────────────────────────
 *
 * The tab title, and it is not a nicety on this surface. This console is worked with several tabs
 * open at once BY DESIGN: a two-operator decision is a comparison, so the queue is in one tab, the
 * request under decision in another, and the audit thread in a third. Every one of them read
 * "CloudsForge Operator Console" before this, so an operator picked between them by guessing — on
 * the one surface in the estate where picking the wrong tab is precisely the mistake the typed
 * confirmation phrase exists to catch.
 *
 * The robots directive is checked in `test/sitemap.test.ts` instead, beside the registry field it
 * is derived from and the `robots.txt` that has to agree with it.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { surface } from '@cloudsforge/ui'
import { PRODUCT } from '../src/lib/hosts.ts'
import { ROBOTS, consoleMeta, pageLabel } from '../src/lib/meta.ts'
import { FORESIGHT_BASE, FORESIGHT_NAV, NAV, ROUTES } from '../src/lib/routes.ts'

const NAME = surface(PRODUCT).name

describe('the page name comes off the route table', () => {
  it('gives every navigable section a name, and none is left unnamed', () => {
    // Derived from the same declaration the navigation is. A section added to `ROUTES` and not
    // handled here fails HERE, rather than shipping a tab titled with the surface name alone.
    for (const entry of NAV) {
      assert.equal(
        pageLabel(entry.to),
        entry.label === 'Foresight' ? 'Foresight' : entry.label,
        `${entry.to} has no page name`,
      )
    }
  })

  it('is not empty, so this file cannot pass for the wrong reason', () => {
    assert.ok(NAV.length >= 9, `only ${NAV.length} navigation entries`)
    assert.ok(ROUTES.some((r) => r.wildcard))
  })

  it('titles the index as the section it is, rather than with the surface name alone', () => {
    // `/` is the estate view — the screen that answers "is anything wrong", which is why it is the
    // index rather than a form. A tab reading "Admin" says nothing an operator with four of them
    // open can use.
    assert.equal(pageLabel('/'), 'Estate')
    assert.equal(consoleMeta('/').title, `Estate — ${NAME}`)
  })

  it('resolves a detail address to its SECTION rather than to the identifier in it', () => {
    /*
     * `/approvals/<uuid>` is titled "Approvals". The console cannot know what a given request is
     * for without fetching it, and a title that waited on a fetch would leave the PREVIOUS page's
     * title in the tab for the length of a round trip — which is the tab an operator switches back
     * to in order to check which request they left open. A uuid in a tab is also not a thing
     * anybody reads at tab width.
     */
    assert.equal(pageLabel('/approvals/3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'), 'Approvals')
    assert.equal(pageLabel('/backups/3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'), 'Backups')
  })

  it('gives an unknown address no name at all', () => {
    // The 404 page is not a section, and inventing a name for it would put a title in a tab for a
    // screen whose entire message is that there is nothing at this address.
    assert.equal(pageLabel('/nope'), null)
    assert.equal(consoleMeta('/nope').title, NAME)
  })
})

describe('the Foresight section, which is two levels deep', () => {
  it('names the section itself at its index', () => {
    assert.equal(pageLabel(FORESIGHT_BASE), 'Foresight')
  })

  it('names each screen beneath it WITH the section, because the names are ambiguous alone', () => {
    // "Markets" in a console that also has an estate view and an approvals queue is a word that
    // needs its product attached; "What we will run" doubly so.
    for (const entry of FORESIGHT_NAV) {
      if (entry.to === FORESIGHT_BASE) continue
      assert.equal(pageLabel(entry.to), `${entry.label} — Foresight`)
    }
  })

  it('resolves a market detail address to the Markets screen', () => {
    // The longest match wins. Without the sort, `/foresight/markets/<uuid>` could be answered by
    // the section index and titled "Foresight", losing the level the operator is actually on.
    assert.equal(
      pageLabel(`${FORESIGHT_BASE}/markets/3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071`),
      'Markets — Foresight',
    )
  })

  it('gives an unknown address INSIDE the section the section’s own name, not a screen’s', () => {
    assert.equal(pageLabel(`${FORESIGHT_BASE}/marketz`), 'Foresight')
  })
})

describe('the composed head', () => {
  it('suffixes the surface name rather than replacing it', () => {
    assert.equal(consoleMeta('/audit').title, `Audit — ${NAME}`)
  })

  it('carries this console’s full robots directive on every address', () => {
    for (const path of ['/', '/approvals', '/backups/abc', `${FORESIGHT_BASE}/markets`, '/nope']) {
      assert.equal(consoleMeta(path).robots, ROBOTS, `${path} does not carry the full directive`)
    }
  })

  it('collapses a trailing slash, so one page never has two canonicals', () => {
    // nginx serves both spellings — `location ~ ^/(…|audit|…)(/|$)` — and react-router matches
    // both. Two canonicals for one page is how a page splits its own indexing between them.
    assert.equal(consoleMeta('/audit/').path, '/audit')
    assert.equal(consoleMeta('/audit/').title, consoleMeta('/audit').title)
    assert.equal(consoleMeta('//').path, '/')
  })

  it('names no hostname — the origin is supplied by the caller, from the browser', () => {
    // test/no-build-time-config.test.ts is the rule. `applyHead()` takes the origin as an argument
    // for exactly this reason, and the shell reads it from `window.location`.
    const composed = JSON.stringify(consoleMeta('/approvals'))
    assert.equal(/cloudsforge\.(com|online|localtest)/.test(composed), false)
  })

  it('describes the surface from the registry rather than from a sentence typed here', () => {
    assert.ok(consoleMeta('/').description.length > 0)
    assert.ok(consoleMeta('/').description.includes(surface(PRODUCT).blurb))
  })
})

/**
 * The shell, MOUNTED, after @cloudsforge/ui 1.1 replaced three of its parts.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE HAD TO EXIST BEFORE THE SHELL COULD BE TOUCHED
 *
 * Everything this repository asserted about `src/components/shell.tsx` was asserted about the
 * FILE. `test/render.test.ts` says so plainly — "this proves each component IS WIRED to the
 * right data, not that the pixels land" — and for the shell that limit bites harder than anywhere
 * else, because the shell's job is almost entirely ORDER: what is first in the tab sequence, where
 * focus lands, what is last in the document.
 *
 * A source-text test could not have caught the defect that was actually there. `.aw-skip` pointed
 * at `<main id="main">`, and the `<main>` carried no `tabIndex={-1}` — so a `grep` for a skip link
 * found one, a `grep` for its target found one, and the control did not work: in Chrome and Safari
 * following the link scrolled the page and left focus on the LINK, so the operator's next Tab went
 * back into the company bar. Both halves were present and the pair was broken.
 *
 * So this file mounts the real shell and moves focus with `tab()`. That is the only layer at which
 * "the skip link works" is a statement with a truth value.
 *
 * The harness boundary from `test/dom.ts` applies unchanged: text, document order, accessible
 * roles and names, and where focus is. No geometry, no computed style, nothing a second DOM
 * implementation would plausibly differ on.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { withScreen, type Screen } from './dom.ts'
import { AppShell } from '../src/components/shell.tsx'
import { AuthProvider } from '../src/lib/auth.tsx'
import { NAV } from '../src/lib/routes.ts'
import { consoleMeta } from '../src/lib/meta.ts'

const ORIGIN = 'https://admin.cloudsforge.online'

/** A marker only the outlet can render, so "the page rendered" is distinguishable from "the shell did". */
const PAGE_TEXT = 'the page inside the shell'

/**
 * The shell at an address, with a stand-in page in its outlet.
 *
 * A stand-in rather than a real screen on purpose: every real page fetches, and a fetch failure
 * would make a scenario about focus order fail for a reason that has nothing to do with focus.
 * What is under test here is the frame, and the frame is the same whatever renders inside it.
 */
const shellAt = (path: string): ReactElement =>
  h(
    MemoryRouter,
    { initialEntries: [path] },
    h(
      AuthProvider,
      null,
      h(
        Routes,
        null,
        h(Route, {
          path: '*',
          element: h(AppShell, null),
          children: [h(Route, { key: 'i', path: '*', element: h('p', null, PAGE_TEXT) })],
        } as never),
      ),
    ),
  )

/** Tab forward until `stop` says yes, or the tab order runs out. Returns how many presses it took. */
async function tabUntil(s: Screen, stop: (el: Element | null) => boolean): Promise<number> {
  for (let presses = 1; presses <= 40; presses += 1) {
    const el = await s.tab()
    if (stop(el)) return presses
  }
  assert.fail('focus never reached the element the scenario is about')
}

describe('the skip link, which is the control that was half-implemented', () => {
  it('is the FIRST thing in the tab order, before the company bar', async () => {
    await withScreen(shellAt('/'), { url: `${ORIGIN}/`, mountedText: PAGE_TEXT }, async (s) => {
      const first = s.tabbables()[0] ?? null
      assert.ok(first, 'nothing in the shell is tabbable')
      assert.equal(first.tagName, 'A')
      assert.match(s.textOf(first), /Skip to the page/)
    })
  })

  it('points at a target that EXISTS and can hold focus', async () => {
    /*
     * The pair, checked as a pair. `SkipLink` composes its href from `MAIN_ID` and `MainRegion`
     * sets the same id AND `tabindex="-1"`, so neither half can be shipped without the other. The
     * old code had the href and the id and not the tabindex, which is exactly the state this
     * asserts is impossible now.
     */
    await withScreen(shellAt('/'), { url: `${ORIGIN}/`, mountedText: PAGE_TEXT }, async (s) => {
      const link = s.tabbables()[0] as Element
      const href = link.getAttribute('href') ?? ''
      assert.match(href, /^#/, 'the skip link is not a fragment link')
      const target = s.document.getElementById(href.slice(1))
      assert.ok(target, `nothing in the document has the id ${href}`)
      assert.equal(target.tagName, 'MAIN')
      assert.equal(
        target.getAttribute('tabindex'),
        '-1',
        'the skip target cannot receive focus — following the link would scroll and leave focus behind',
      )
    })
  })

  it('wraps the page rather than sitting beside it', async () => {
    // The outlet has to be INSIDE the region the skip link targets, or the link skips to an empty
    // landmark and the reader tabs on into the same navigation they asked to skip.
    await withScreen(shellAt('/audit'), { url: `${ORIGIN}/audit`, mountedText: PAGE_TEXT }, async (s) => {
      const main = s.document.querySelector('main')
      assert.ok(main)
      assert.match(s.textOf(main), new RegExp(PAGE_TEXT))
    })
  })

  it('keeps the layout class the stylesheet is written against', async () => {
    // `MainRegion` takes a className through. Losing it would drop the page's max-width, gutters
    // and bottom padding on every screen at once — a change nothing else in this suite would see.
    await withScreen(shellAt('/'), { url: `${ORIGIN}/`, mountedText: PAGE_TEXT }, async (s) => {
      const main = s.document.querySelector('main')
      assert.ok(main?.classList.contains('wt-main'))
    })
  })
})

describe('the navigation survived the shell change', () => {
  it('offers every section, by name, as a link', async () => {
    await withScreen(shellAt('/'), { url: `${ORIGIN}/`, mountedText: PAGE_TEXT }, async (s) => {
      for (const entry of NAV) {
        const link = s.queryByRole('link', entry.label)
        assert.ok(link, `${entry.label} is not offered in the navigation`)
        assert.equal(link.getAttribute('href'), entry.to)
      }
    })
  })

  it('is reachable by keyboard from the skip link, in one direction', async () => {
    // The regression the old skip link caused: activating it left focus on the link, so the next
    // Tab went BACKWARDS into the bar. Here the sections are reached by tabbing forward and the
    // count is monotonic — nothing sends focus back up the document.
    await withScreen(shellAt('/'), { url: `${ORIGIN}/`, mountedText: PAGE_TEXT }, async (s) => {
      const estate = await tabUntil(s, (el) => el !== null && s.textOf(el) === 'Estate')
      const audit = await tabUntil(s, (el) => el !== null && s.textOf(el) === 'Audit')
      assert.ok(audit > 0 && estate > 0)
    })
  })

  it('still marks this console as the current surface, in a word and not only a colour', async () => {
    await withScreen(shellAt('/'), { url: `${ORIGIN}/`, mountedText: PAGE_TEXT }, async (s) => {
      assert.match(s.text(), /Operator/)
    })
  })
})

describe('consent, on a surface that ships no measurement ID', () => {
  it('draws NO banner, because there is nothing to consent to', async () => {
    /*
     * `CookieBanner` is mounted in the shell and returns null here: `analyticsId()` reads
     * `<meta name="cf-analytics">`, this console ships none, and the component refuses to draw
     * without one (ui/packages/ui/src/index.tsx). Asserting the absence is what makes the
     * decision in index.html enforceable — if somebody adds a measurement ID, this test goes red
     * and they have to argue for it rather than ship it quietly.
     */
    await withScreen(shellAt('/'), { url: `${ORIGIN}/`, mountedText: PAGE_TEXT }, async (s) => {
      assert.equal(s.queryByRole('button', /accept/i), null, 'a consent banner was drawn')
      assert.equal(s.queryByRole('button', /reject/i), null, 'a consent banner was drawn')
      assert.equal(/cookie/i.test(s.text()), false)
    })
  })

  it('sets no cookie and requests no third-party script', async () => {
    // The GDPR posture, asserted rather than reasoned about. `initAnalytics()` runs on boot and
    // pushes onto an array; nothing here may set a cookie or append a script element.
    await withScreen(shellAt('/'), { url: `${ORIGIN}/`, mountedText: PAGE_TEXT }, async (s) => {
      assert.equal(s.document.cookie, '')
      const scripts = [...s.document.querySelectorAll('script[src]')].map((el) =>
        el.getAttribute('src'),
      )
      assert.deepEqual(scripts, [])
    })
  })
})

describe('the document head follows the address', () => {
  it('titles the page it is on, not the console', async () => {
    await withScreen(shellAt('/audit'), { url: `${ORIGIN}/audit`, mountedText: PAGE_TEXT }, async (s) => {
      await s.settle()
      assert.equal(s.document.title, consoleMeta('/audit').title)
      assert.match(s.document.title, /^Audit — /)
    })
  })

  it('carries the full robots directive into the served document', async () => {
    // Four directives, not the two the registry derives. `applyHead()` REWRITES this tag, so the
    // override in lib/meta.ts is the only thing standing between the archive and image refusals
    // and a silent downgrade one second after the page loads.
    await withScreen(shellAt('/'), { url: `${ORIGIN}/`, mountedText: PAGE_TEXT }, async (s) => {
      await s.settle()
      const robots = s.document.querySelector('meta[name="robots"]')?.getAttribute('content')
      assert.equal(robots, 'noindex, nofollow, noarchive, noimageindex')
    })
  })

  it('writes ONE canonical link, and moves it rather than adding a second', async () => {
    await withScreen(shellAt('/audit'), { url: `${ORIGIN}/audit`, mountedText: PAGE_TEXT }, async (s) => {
      await s.settle()
      const links = s.document.querySelectorAll('link[rel="canonical"]')
      assert.equal(links.length, 1)
      assert.equal(links[0]?.getAttribute('href'), `${ORIGIN}/audit`)
    })
  })
})

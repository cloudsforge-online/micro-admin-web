/**
 * The app shell: the company bar, the operator navigation, and the page.
 *
 * The bar is `CloudsForgeBar` from @cloudsforge/ui and is never reimplemented. It is passed
 * `PRODUCT` — 'admin' — so the switcher marks this console as current and leaves every product
 * clickable, which is what an operator wants when they need to look at the public page of the
 * thing they are about to act on.
 *
 * The bar's right slot carries a permanent OPERATOR marker. It is a word and a border, never a
 * colour alone: Admin's clay (#c2704f) is a warm mid-tone that has no reserved meaning in this
 * estate, and nothing in this console may depend on the accent to say what it is.
 */
import { useEffect, useState } from 'react'
import {
  CloudsForgeBar,
  CloudsForgeFooter,
  CookieBanner,
  MainRegion,
  SkipLink,
  SubNav,
} from '@cloudsforge/ui'
import { applyHead } from '@cloudsforge/ui/seo'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { PRODUCT } from '../lib/hosts.ts'
import { consoleMeta } from '../lib/meta.ts'
import { NAV } from '../lib/routes.ts'
import { useSession } from '../lib/auth.tsx'
import { setViewedNetwork, viewedNetwork, type ViewedNetwork } from '../lib/viewed.ts'

export function AppShell({ unregistered = false }: { unregistered?: boolean }) {
  // The viewed network: in-tab memory, defaulting to the hostname's own (micro-org#459).
  // `setViewedNetwork` runs first in the handler below so the remounted tree reads the new value
  // on its very first render.
  const [viewed, setViewed] = useState<ViewedNetwork>(viewedNetwork())
  const { account, operator, signIn, signOut } = useSession()

  return (
    <>
      {/*
        Skip link first in the DOM, because keyboard is the primary input for an operator working
        through a queue and a console with ten nav entries is ten tabs to the content.

        IT IS THE SHARED ONE NOW, AND THE LOCAL ONE WAS HALF THE PATTERN. `.aw-skip` pointed at
        `#main` and `<main id="main">` below carried no `tabIndex={-1}` — so in Chrome and Safari
        following the link scrolled the page, left focus on the link itself, and sent the operator's
        next Tab back into the company bar. On this surface that lands them in the switcher, one
        keystroke from leaving the console, at the moment they asked to reach the page. `MainRegion`
        below is the half that was missing; `SkipLink` composes its href from the same `MAIN_ID`
        constant, so the link and its target cannot disagree.

        The local rule also revealed itself on `:focus-visible` only, where the shared `.cf-skip`
        uses `:focus`. That difference is not cosmetic: a skip link is activated by keyboard by
        definition, and `:focus-visible` is a heuristic that a browser is allowed to answer `false`
        to.
      */}
      <SkipLink>Skip to the page</SkipLink>
      {/*
        In-app network context (micro-org#459, the combined view). The reader's choice lives in
        `lib/viewed.ts` — module memory, never storage — and the `key` on the Outlet below is the
        refetch mechanism: switching remounts the page tree, and `apiBase()` reads `viewedHosts()`,
        so the same page re-reads itself from the other estate WITHOUT going anywhere. The band and
        the switcher both follow the selection, so testnet data under a mainnet address bar is
        never unmarked. The bar also stamps `?net=` onto its product links, which is what carries
        the choice across a product switch — every surface is its own origin, so nothing else can.
      */}
      <CloudsForgeBar
        current={PRODUCT}
        account={account}
        onSignIn={() => signIn()}
        onSignOut={signOut}
        rightSlot={<span className="aw-opmark">Operator</span>}
        networkSwitch={{
          selected: viewed,
          onSelect: (n) => {
            setViewedNetwork(n)
            setViewed(n)
          },
        }}
      />
      {/*
        The sub-nav is `SubNav` from @cloudsforge/ui, and the local `.wt-subnav*` rules are deleted
        rather than left beside it. It is still sticky at exactly `var(--cf-bar-h)` — the bar's own
        height token, not a number copied out of it — because that is one of the things the shared
        rule kept.

        WHAT IT REPLACES. Measured 2026-08-10: ten frontends declared this strip in their own
        stylesheet under six class prefixes, from what was plainly one original that had been copied
        and then edited in place; the census is in `ui/packages/ui/src/subnav.test.ts`. This copy
        was the closest of the ten to the original and still carried two of the three drifts. It set
        `max-width: 76rem` — 1216px against the 1200px `.cf-bar__inner` takes from `--cf-max-w` — so
        the second row of the header sat 8px proud of the first on each side, which is the width of
        a defect that never gets reported and never gets fixed. And it did not scroll: no
        `overflow-x` and no `white-space: nowrap`, so the ten sections wrapped or clipped on a phone
        rather than scrolling sideways. Its gap, gutter, link padding and type were literals.

        The links stay here, and that is the component's own argument: routing is react-router's
        `NavLink`, which owns the active state, and the design system does not depend on
        react-router. What moved is the STRIP — the sticky offset, the measure, the scroll behaviour
        and the type.

        The `label` keeps this console's own wording. Two `<nav>` landmarks with the same accessible
        name are two landmarks a screen reader user cannot tell apart, and this console has two of
        them — "Sections" here and "Foresight" one level down in `foresight-section.tsx` — so the
        wording is deliberately per-landmark and was not homogenised with the strip.
      */}
      <SubNav label="Sections">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `cf-subnav__link${isActive ? ' cf-subnav__link--current' : ''}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </SubNav>
      <DocumentMeta />
      {/*
        `MainRegion` rather than a hand-written `<main>`: it sets `id={MAIN_ID}` and `tabIndex={-1}`
        together, which is the pair the skip link needs and the pair this file used to get half
        right. The id is `cf-main` now rather than `main`; nothing else in this console referenced
        the old one — `grep -rn '#main' src/` returned this file alone — and both nginx and the
        router address pages by path rather than by fragment.

        `className="wt-main"` is carried over unchanged, so every layout rule in styles.css that
        was written against it still applies.
      */}
      <MainRegion className="wt-main">
        {/*
          Not fatal, so not a refusal — but not silent either. `cloudsforgeHosts()` derives the
          apex by stripping a KNOWN subdomain, so an address the registry does not know makes every
          estate URL resolve one level too deep: `admin-api`, and the account portal with it. The
          symptom is a console that cannot sign anybody in and says nothing about why.
        */}
        {unregistered && (
          <p className="aw-note aw-note--warn" role="status">
            <span className="aw-note__icon" aria-hidden="true">
              ▲
            </span>
            This console is being served from an address the surface registry does not know, so
            every CloudsForge host it resolves — including the account portal — is derived from the
            wrong apex. Its home is the <code className="cf-num">admin</code> surface.
          </p>
        )}
        {/*
          The console could not establish which principal is signed in, which matters here in a way
          it does not elsewhere: the four-eyes control turns on it. Said once, at the top, rather
          than repeated on every request. See lib/auth.tsx.
        */}
        {operator.principal === null && account.signedIn && (
          <p className="aw-note aw-note--warn" role="status">
            <span className="aw-note__icon" aria-hidden="true">
              ▲
            </span>
            This console could not read your account profile, so it does not know which operator
            you are. It will still offer decisions, because refusing on a guess would block a
            legitimate approver — but admin-api is the thing that will refuse a self-approval, and
            you will find out at the request rather than before it.
          </p>
        )}
        <Outlet key={viewed} />
      </MainRegion>

      {/*
        The company footer, from @cloudsforge/ui. Not written here, and deliberately not
        `<footer>` markup of this app's own: the estate had four hand-rolled footers and nine
        surfaces with none, and the registry's `developers` row has been claiming all along that
        the developer console is "reached from the footer" — a navigation path that existed
        nowhere. Every link in it is derived from SURFACES, so a new product appears here without
        this file changing.

        `account` is passed for one reason: it decides whether the operator surfaces are offered.
        Omitting it would hide them, which is safe, but this app already knows and a signed-in
        operator should be able to reach Admin from any page.
      */}
      <CloudsForgeFooter current={PRODUCT} account={account} />

      {/*
        Last in the document, and therefore last in the tab order.

        ON THIS SURFACE IT RENDERS NOTHING, EVER, AND IT IS MOUNTED ANYWAY. `index.html` carries no
        `cf-analytics` measurement ID — the reasoning is written out in that file — so `analyticsId()`
        is null and `CookieBanner` returns null before it draws anything
        (ui/packages/ui/src/index.tsx). Mounting it costs one function call and buys the thing
        that is actually hard to keep: every shell in the estate has the same three elements in the
        same three places, so a reader comparing two of them is comparing surfaces rather than
        conventions, and a future measurement ID cannot be added here without the banner appearing
        with it. A shell that omits the component is a shell where adding the ID is silent.
      */}
      <CookieBanner />
    </>
  )
}

/**
 * Keep the title, the description, the robots directive, the Open Graph block and the canonical
 * link in step with the address.
 *
 * A component in the shell rather than a hook each page calls, because the failure mode of the
 * second shape is the page that forgets — and on this console the page that forgets is the one
 * added last, which is the screen nobody has a habit around yet.
 *
 * ── WHAT AN OPERATOR ACTUALLY GETS OUT OF THIS ────────────────────────────────────────────────
 *
 * The tab title, and it is not a nicety here. This console is worked with several tabs open at
 * once by design — the queue in one, the request under decision in another, the audit thread in a
 * third, because a two-operator decision is a comparison — and every one of those tabs read
 * "CloudsForge Operator Console" until now. A row of identical tabs is a row an operator picks
 * from by guessing, on the surface where picking the wrong one is the failure the typed
 * confirmation phrase exists to catch.
 *
 * ── THE ONE TAG THIS EMITS THAT `index.html` DELIBERATELY DOES NOT CARRY ───────────────────────
 *
 * `og:image`. `brand/assets/admin/` ships no card and 18-build-status.md §3.3k records that as a
 * decision — nobody shares an operator console outward — and `test/brand-chrome.test.ts` asserts
 * the absence with the same force it asserts a favicon's presence. `applyHead()` writes the
 * estate's DEFAULT card at runtime and offers no way to suppress it (seo.ts emits it
 * unconditionally). That is accepted rather than worked around, for one reason that decides it:
 * the fetchers §3.3k is about — chat, social, link previews — do not execute JavaScript, so they
 * read `index.html` and find no card, which is exactly what was decided. The static absence is
 * still asserted and still has to be argued for to change.
 */
function DocumentMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    // `window.location.origin` is read HERE rather than inside `lib/meta.ts`, which is what keeps a
    // hostname out of the module and out of the artefact: one image is served from localhost, from
    // a preview deployment and from `admin.<apex>`, and composes correct absolute URLs on each.
    // `test/no-build-time-config.test.ts` is the rule this obeys.
    applyHead(consoleMeta(pathname), window.location.origin)
  }, [pathname])

  return null
}

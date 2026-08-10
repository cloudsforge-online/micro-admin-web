/**
 * The Foresight section: its own second-level navigation, and the screen under it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS CONSOLE HAS A SECOND LEVEL OF NAVIGATION AT ALL, WHEN IT HAD NONE BEFORE.
 *
 * `micro-foresight-admin-web` was a whole console for three screens, so those three were its
 * top-level nav. Folded in here they are one product's lifecycle inside a console whose top level
 * is the ESTATE's workflow — is anything wrong, what needs a second signature, what happened, who
 * is affected. Promoting "Markets" into that bar would put it beside "Approvals" as though the two
 * were the same kind of thing, and they are not: Approvals is every service's queue and Markets is
 * one service's.
 *
 * So the section keeps its own three, one level down, and the top bar gains exactly one entry.
 * `19-new-products.md` called this a fold rather than a merge for the same reason — the panel
 * was always one panel, and it stays one.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── This is layout, and layout is not authorisation ───────────────────────────────────────────
 *
 * Nothing in this file decides who may see anything. It renders three links and an outlet. The
 * route gate is `ProtectedRoute` in app.tsx, which only distinguishes signed-in from signed-out,
 * and the thing that actually refuses is `micro-foresight` — every operator route calls
 * `requireAdmin(await authenticate(ctx, deps))` before it reads a parameter
 * (foresight/src/server.ts, 660, 681, 704, 714, 732, 772, 859, 899, 927, 957, 976), and
 * `requireAdmin` refuses a token without the role wherever it came from.
 *
 * That ordering matters more here than on the estate screens, because two of these links lead to
 * controls that move money on a chain. If hiding a link were ever load-bearing, an operator with a
 * bookmark would be authorised by their browser history. It is not, and it must not become so.
 */
import { SubNav } from '@cloudsforge/ui'
import { NavLink, Outlet } from 'react-router-dom'
import { FORESIGHT_NAV } from '../lib/routes.ts'

export function ForesightSection() {
  return (
    <>
      {/*
        No section heading. Every screen below already opens with its own `wt-page__head`, and a
        second title above it would push the actual page title below the fold on a laptop while
        saying nothing the nav does not. The section is identified by the nav's own accessible
        name, which is what a screen reader announces on entering it.

        Deliberately no new CSS namespace either: this is `SubNav` from @cloudsforge/ui, the same
        component the top-level nav uses, with one modifier of this console's own. A second set of
        hand-rolled section styles is how two navigations in one console come to disagree about
        their own height.

        ── WHY THE MODIFIER IS STILL LOCAL, AND WHY IT IS A WRAPPER ────────────────────────────────

        `.wt-subnav--section` un-sticks the strip, and that is the whole modifier. `.cf-subnav` pins
        itself to `var(--cf-bar-h)` so the console's top-level nav stays reachable while a long
        audit page scrolls. Two sticky rows at the same offset either stack — costing a third of a
        laptop viewport on the screen whose job is a long queue — or collide, with the second
        silently drawn over the first. This nav is short and sits at the top of its own section, so
        it scrolls away with it.

        It is NOT pushed up into @cloudsforge/ui because this console is the only surface in the
        estate with two levels of navigation, and a modifier with one caller is a guess about the
        second. The day a second surface needs it, it has two callers and an argument; today it
        would be a shared class that only this file can explain.

        A WRAPPER rather than a `className` prop, because `SubNav` deliberately takes only `label`
        and `children` (ui/packages/ui/src/index.tsx). Passing arbitrary classes into a shared
        landmark is how the ten local copies happened in the first place — the escape hatch gets
        used, then edited, then diverges. So the local rule reaches the shared element by descent
        (`.wt-subnav--section .cf-subnav`), which any stylesheet can do without the component
        growing a seam.
      */}
      {/*
        `end` is per-entry rather than a rule, and getting it wrong is invisible until somebody
        notices two links lit at once. The queue is the section INDEX, so it needs `end` or it
        would match every path beneath /foresight. Markets must NOT have it, because the detail
        page lives under it and the section link should stay lit while an operator is reading one.
      */}
      <div className="wt-subnav--section">
        <SubNav label="Foresight">
          {FORESIGHT_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `cf-subnav__link${isActive ? ' cf-subnav__link--current' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </SubNav>
      </div>

      <Outlet />
    </>
  )
}

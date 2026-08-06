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

        Deliberately no new CSS namespace either: this reuses `wt-subnav`, the same component the
        top-level nav uses, with one modifier. A second set of hand-rolled section styles is how
        two navigations in one console come to disagree about their own height.
      */}
      {/*
        `end` is per-entry rather than a rule, and getting it wrong is invisible until somebody
        notices two links lit at once. The queue is the section INDEX, so it needs `end` or it
        would match every path beneath /foresight. Markets must NOT have it, because the detail
        page lives under it and the section link should stay lit while an operator is reading one.
      */}
      <nav className="wt-subnav wt-subnav--section" aria-label="Foresight">
        <div className="wt-subnav__inner">
          {FORESIGHT_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `wt-subnav__link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Outlet />
    </>
  )
}

/**
 * The route table, as data, in one place.
 *
 * Three files describe this console's addresses and all three have to agree:
 *
 *   1. `src/lib/routes.ts` — this file, from which the sub-navigation is derived,
 *   2. `src/app.tsx`       — which component renders at each path,
 *   3. `nginx.conf`        — which addresses are served the app shell at all.
 *
 * The third is the one that bites, and it bites late. nginx enumerates the real routes and 404s
 * everything else ON PURPOSE, so that a wrong address answers 404 rather than 200 — an app that
 * answers 200 for every address serves its "page not found" screen as a success, which crawlers
 * index and monitors call healthy. The price of that honesty is this list, in triplicate, so
 * `test/routes.test.ts` reads `nginx.conf` and `app.tsx` and fails the build when either has
 * drifted. "Remember to update nginx.conf" is not a mechanism; a test is.
 *
 * This module deliberately imports nothing — not React, not the router — so the test that reads
 * it does not have to boot a browser to find out what the routes are.
 */

export interface ConsoleRoute {
  /** The top-level path segment, without a leading slash. `''` is the index route. */
  readonly path: string
  /** The sub-navigation label, or null for a route that is reachable but not offered. */
  readonly label: string | null
  /** True when the route owns everything beneath it (`/approvals/<uuid>`). */
  readonly wildcard: boolean
}

export const ROUTES: readonly ConsoleRoute[] = [
  // The estate is the index because it is the screen that answers "is anything wrong". A console
  // whose front page is a form makes the operator navigate to the question they arrived with.
  { path: '', label: 'Estate', wildcard: false },
  // Wildcard: `/approvals/<uuid>` is the detail page, and it is the address an operator pastes
  // into a chat window when they need the second pair of eyes the queue requires.
  { path: 'approvals', label: 'Approvals', wildcard: true },
  // The catalogue, including the one action that cannot be executed. Reachable from the nav on
  // purpose: §3.3g is a decision the estate made, and a gap nobody can find is a gap nobody
  // closes.
  { path: 'actions', label: 'Actions', wildcard: false },
  { path: 'audit', label: 'Audit', wildcard: false },
  // The support lookup — 05 journey 16, and the evidence 17 §7 claim 9 is measured by. It sits
  // beside Audit because the two are halves of one workflow: this screen turns a USER into the
  // correlation ids their history hangs off, and Audit reads one of those threads. The pivot is
  // the half that did not exist, and it is why this is not a second copy of the audit screen.
  { path: 'support', label: 'Support', wildcard: false },
  // What was sent to one person and did it arrive — the delivery half of the support question
  // above. A separate page because its query axis is a RECIPIENT (address or user id), not a
  // correlation id, and because resending is an action support's read-only screen must not grow.
  { path: 'mail', label: 'Mail', wildcard: false },
  // The engagement treasury — docs/ecosystem/21 §6. The owner's requirement was that this be
  // "manageable from the admin panel", so the caps are here rather than only in curl. The screen
  // is a VIEW of the actions, never the mechanism: §6 is explicit that the catalogue remains
  // fully operable without it.
  { path: 'engagement', label: 'Engagement', wildcard: false },
  { path: 'flags', label: 'Flags', wildcard: false },
  { path: 'broadcasts', label: 'Broadcasts', wildcard: false },
  // Backups and restores. A WILDCARD, because `/backups/<uuid>` is where the restore lives — and
  // that address is not a convenience. A live restore needs an approved two-operator
  // `estate.restore` request, so the operator who wants one has to send somebody else the thing
  // they are asking about: which backup, from when, what is in it, and whether anything has ever
  // restored it. That is a URL, for the same reason `/approvals/<uuid>` is one.
  { path: 'backups', label: 'Backups', wildcard: true },
  // ── The Foresight operator panel, folded in at P13 ──────────────────────────────────────────
  //
  // One top-level segment owning everything beneath it, rather than three siblings — `/foresight`
  // is the idea queue, `/foresight/markets`, `/foresight/markets/:id` and `/foresight/categories`
  // are the rest, and `FORESIGHT_NAV` below is the second-level navigation inside the section.
  //
  // WHY A SECTION AND NOT THREE MORE TOP-LEVEL ENTRIES. This console's nav is the estate's
  // workflow — is anything wrong, what needs a second signature, what happened, who is affected.
  // Foresight's three screens are one product's lifecycle, and spreading them across that bar
  // would put "Markets" beside "Approvals" as if they were the same kind of thing. They are not:
  // Approvals is every service's queue and Markets is one service's. The registry row this fold
  // deletes said the same in its blurb — "Operator panel: idea queue, open/close/resolve/void" is
  // one panel, and it stays one.
  //
  // It is also what keeps the nginx list honest: `foresight` is one entry in one alternation, and
  // the wildcard is what makes a hard refresh on `/foresight/markets/<uuid>` serve the shell.
  { path: 'foresight', label: 'Foresight', wildcard: true },
  // Forge Worlds — generating and running *Ninety Days After* worlds.
  //
  // NOT a wildcard, unlike Foresight: there is one screen, and a world's detail is the game's own
  // to render rather than this console's. What an operator does to a world from outside — open it,
  // force a day, change the bots — is four actions on one list, and a `/worlds/<uuid>` address
  // that only restated the row above it would be a page to maintain for no question it answers.
  //
  // WHY IT IS IN THIS CONSOLE AT ALL, when Foresight got folded in from its own admin app and this
  // has no app to fold: `nda` has no row in `surfaces.ts`, so it has no hostname, no gateway
  // router and no tunnel ingress rule — the tunnel config enumerates three hostnames by hand and
  // 404s the rest. The service has been healthy and unreachable for weeks, which is why the title
  // reads `draft`. admin-api proxies it (`/v1/worlds`), and this is the door.
  { path: 'worlds', label: 'Worlds', wildcard: false },
]

/**
 * The section's own root, as one string.
 *
 * Everything under `/foresight` composes its address from this — the nav below, the pages' links,
 * and the deep-link probe. See `foresightPath`.
 */
export const FORESIGHT_BASE = '/foresight'

/**
 * The navigation INSIDE the Foresight section.
 *
 * Its own table rather than more `ROUTES` rows, because these are not top-level segments and
 * `ROUTES` is checked by `test/routes.test.ts` for exactly that — a path with a slash in it would
 * produce an nginx location block that does not mean what it says. The three screens are declared
 * here, the section's layout renders them, and `app.tsx` mounts them under the one wildcard route.
 */
export const FORESIGHT_NAV: ReadonlyArray<{ to: string; label: string; end: boolean }> = [
  // The queue is the section index because it is the screen with work waiting in it, which is the
  // same reason Approvals is not this console's index and the estate view is.
  { to: FORESIGHT_BASE, label: 'Idea queue', end: true },
  { to: `${FORESIGHT_BASE}/markets`, label: 'Markets', end: false },
  { to: `${FORESIGHT_BASE}/categories`, label: 'What we will run', end: true },
]

/**
 * Every in-app address the Foresight screens link to, built from one base.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE BUG THIS EXISTS TO HAVE FIXED ONCE, RATHER THAN THREE TIMES.
 *
 * In `micro-foresight-admin-web` these screens were the whole app, so the market list linked to
 * `/markets/<id>`, the detail page linked back to `/markets`, and approving a proposal navigated
 * to `/markets/<id>`. All three are ROOT-relative, all three moved into this console unchanged,
 * and all three then pointed at addresses this console does not route — so every one of them
 * landed on the 404 page. Nothing typechecked differently and nothing in the client suite noticed:
 * a `<Link to>` is a string, and the route table it has to agree with is in another file.
 *
 * `test/foresight-journeys.test.ts` caught it by mounting the list and reading the `href` off the
 * rendered anchor, which is the only layer at which a wrong link is observable at all.
 *
 * So the section's base is written once, here, beside the route that declares it — and the pages
 * compose their addresses from it rather than restating a prefix each. If the section is ever
 * moved or renamed, this is the line that moves.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export const foresightPath = {
  queue: (): string => FORESIGHT_BASE,
  markets: (): string => `${FORESIGHT_BASE}/markets`,
  market: (id: string): string => `${FORESIGHT_BASE}/markets/${id}`,
  categories: (): string => `${FORESIGHT_BASE}/categories`,
} as const

/** What the sub-navigation renders, with the leading slash a `NavLink` wants. */
export const NAV: ReadonlyArray<{ to: string; label: string }> = ROUTES.filter(
  (route): route is ConsoleRoute & { label: string } => route.label !== null,
).map((route) => ({ to: `/${route.path}`, label: route.label }))

/** Every path nginx has to serve the shell for, excluding the index. */
export const NON_INDEX_PATHS: readonly string[] = ROUTES.filter((r) => r.path !== '').map(
  (r) => r.path,
)

/**
 * A route this console owns, deep enough to prove the SPA fallback works.
 *
 * Passed to CI as the deep-link probe. It must be a REAL address — a probe against a path the app
 * does not own proves only that the 404 page renders, which is the opposite of what the check is
 * for.
 */
export const DEEP_LINK_PATH = '/approvals/3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'

/**
 * A second probe, THREE segments deep, under the route the fold added.
 *
 * `DEEP_LINK_PATH` is two segments and every wildcard route before today was two. `/foresight`'s
 * detail page is three — `/foresight/markets/<uuid>` — and that is a different question of the
 * nginx config: `location ~ ^/(…|foresight)(/|$)` matches the FIRST segment and everything under
 * it, so it covers three as readily as two, but "so it should" is what the estate has been wrong
 * about before. It is the address an operator pastes into a chat window when they want a second
 * pair of eyes before resolving something, so it is the one that must survive a hard refresh.
 */
export const FORESIGHT_DEEP_LINK_PATH =
  '/foresight/markets/3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'

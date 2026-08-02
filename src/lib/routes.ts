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
  // The engagement treasury — docs/ecosystem/21 §6. The owner's requirement was that this be
  // "manageable from the admin panel", so the caps are here rather than only in curl. The screen
  // is a VIEW of the actions, never the mechanism: §6 is explicit that the catalogue remains
  // fully operable without it.
  { path: 'engagement', label: 'Engagement', wildcard: false },
  { path: 'flags', label: 'Flags', wildcard: false },
  { path: 'broadcasts', label: 'Broadcasts', wildcard: false },
]

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

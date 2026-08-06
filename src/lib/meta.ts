/**
 * The document head, for one address of this console.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS MODULE EXISTS AT ALL, WHEN `surfaceMeta()` ALREADY COMPOSES A HEAD.
 *
 * Two facts about this surface the shared function cannot know, and one it can:
 *
 *   1. **The robots string is longer here.** `robotsDirective()` derives `noindex, nofollow` from
 *      `adminOnly` (@cloudsforge/ui/seo.ts:139-140, and `admin`'s row at surfaces.ts:340) — which
 *      is right and is not the whole of what this console refuses. `index.html` has carried
 *      `noarchive, noimageindex` as well since it shipped, because a console that is merely
 *      unindexed can still be cached and have its screenshots served. That is a per-surface
 *      addition and `PageMetaInput.robots` is the documented way to make one (seo.ts:101-106).
 *
 *      IT MATTERS THAT IT IS SPELLED ONCE. `applyHead()` REWRITES the `<meta name="robots">` tag
 *      in the served document on every navigation. Without the override it would rewrite the four
 *      directives down to two, a second after the page loaded, in a way visible in no test that
 *      reads `index.html` and in no browser anybody thought to open. `test/sitemap.test.ts` reads
 *      `index.html` and fails when the two spellings drift.
 *
 *   2. **The page name is a route table, not a segment.** The console's sections are declared in
 *      `routes.ts` and the Foresight fold added a second level below them. Both are read here, so
 *      a title is composed from the same declaration the navigation is, rather than typed a fourth
 *      time.
 *
 *   3. What it CAN know is the surface name, the description and the canonical shape, and those
 *      are left entirely to it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Nothing here touches `document`. `applyHead()` is the one impure call and it is made by the
 * shell, so this module stays a pure function that `test/meta.test.ts` exercises without a DOM.
 */
import { surfaceMeta, type SurfaceMeta } from '@cloudsforge/ui/seo'
import { PRODUCT } from './hosts.ts'
import { FORESIGHT_BASE, FORESIGHT_NAV, ROUTES } from './routes.ts'

/**
 * What this console tells a crawler, in ONE place.
 *
 * The first two directives are the registry's, restated rather than imported, because this is the
 * string a human reads in `index.html` and a string assembled from a function call in a static
 * HTML file is not a thing that exists. `test/sitemap.test.ts` asserts that the first two ARE what
 * `robotsDirective()` derives, so the restatement cannot drift from the registry either.
 *
 * The second two are this console's own, and they are not decoration:
 *
 *   - `noarchive` — a cached copy of an operator console is a copy of whatever the operator who
 *     was crawled could see, served by somebody other than us, for as long as they keep it.
 *   - `noimageindex` — the estate view and the audit are screenshots of live estate health.
 */
export const ROBOTS = 'noindex, nofollow, noarchive, noimageindex'

/**
 * The page name for an address, from the route tables.
 *
 * Returns `null` only for an address that is not a declared section, in which case the surface name
 * stands alone. That is the 404 page, and it is deliberate: the not-found screen is not a section,
 * and inventing a title for it would put a name in a tab for a screen whose entire message is that
 * there is nothing at this address.
 *
 * THE INDEX IS NOT SUCH AN ADDRESS. `/` is the estate view — `ROUTES` declares it with the label
 * "Estate" and the navigation offers it — so it is titled like the section it is rather than with
 * the surface name alone. On a console read in one tab that would be a nicety; on this one it is
 * the difference between a row of tabs that all say "Admin" and a row an operator can pick from.
 *
 * A DETAIL ADDRESS RESOLVES TO ITS SECTION. `/approvals/<uuid>` is titled "Approvals" rather than
 * carrying the uuid, and `/backups/<uuid>` likewise. The console cannot know what a given approval
 * is for without fetching it, and a `<title>` that waited on a fetch would leave the previous
 * page's title in the tab for the length of a round trip — which on this console is the tab an
 * operator switches back to in order to check WHICH request they left open.
 */
export function pageLabel(pathname: string): string | null {
  const path = normalise(pathname)

  // The second level first: `/foresight/markets` must not be answered by `/foresight`'s own entry,
  // and `FORESIGHT_NAV`'s longest match is the specific one.
  if (path === FORESIGHT_BASE || path.startsWith(`${FORESIGHT_BASE}/`)) {
    const nested = [...FORESIGHT_NAV]
      .sort((a, b) => b.to.length - a.to.length)
      .find((entry) => path === entry.to || path.startsWith(`${entry.to}/`))
    // `Markets — Foresight` rather than `Markets`: the section is a product's name and the screens
    // beneath it (`Markets`, `What we will run`) are ambiguous without it in a console that also
    // has an estate view and an approvals queue.
    if (nested !== undefined && nested.to !== FORESIGHT_BASE) return `${nested.label} — Foresight`
    return 'Foresight'
  }

  // `''` is a real key here: `ROUTES` declares the index as `{ path: '', label: 'Estate' }`, so the
  // lookup answers `/` without a special case for it.
  const segment = path === '/' ? '' : (path.split('/')[1] ?? '')
  return ROUTES.find((route) => route.path === segment)?.label ?? null
}

/** This address's head, composed. */
export function consoleMeta(pathname: string): SurfaceMeta {
  const label = pageLabel(pathname)
  return surfaceMeta(PRODUCT, {
    // `exactOptionalPropertyTypes` is on, so an absent title is an ABSENT KEY rather than an
    // `undefined` one. Spreading a conditional object is the spelling that produces that.
    ...(label === null ? {} : { title: label }),
    path: normalise(pathname),
    robots: ROBOTS,
  })
}

/**
 * Collapse an address to the one spelling this console routes on.
 *
 * `/audit/` and `/audit` are one page. nginx serves both — `location ~ ^/(…|audit|…)(/|$)` — and
 * react-router matches both, so without this the trailing-slash spelling would get its own
 * canonical link. One page with two canonicals is how a page splits its own indexing between them.
 * It is a smaller problem on a `noindex` surface than on a public one, and it is the same three
 * lines either way.
 */
function normalise(pathname: string): string {
  if (!pathname.startsWith('/')) return normalise(`/${pathname}`)
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

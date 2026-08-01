/**
 * Where this console talks to, resolved at runtime.
 *
 * `cloudsforgeHosts()` reads `window.location.hostname` on every call, so one image serves
 * localhost, a preview deployment and production. Nothing here reads a build-time constant; see
 * the note in vite.config.ts and `test/no-build-time-config.test.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THIS CONSOLE MUST NEVER BE REACHABLE FROM A PUBLIC ORIGIN, AND THAT IS CHECKED AT RUNTIME.**
 *
 * Every other frontend in the estate is a public surface with a signed-in mode. This one is
 * neither: every screen in it reads or writes something only an operator may touch, and one of
 * its screens authorises a manual ledger reversal. 19-new-products.md:142 gives the rule in a
 * line — "an operator UI must not share a bundle with an unauthenticated public page" — and
 * sharing a bundle and sharing an ORIGIN are the same mistake told twice: a public page on the
 * operator's origin can read whatever the operator's origin can.
 *
 * So `servedFromPublicOrigin` asks a wider question than foresight-admin-web's version of it.
 * That console guarded against ONE origin, the product whose API it calls. This one is the
 * estate's console, and there is no single product it belongs to — so the check is against EVERY
 * public origin in the surface registry: the six products, Forge Hub, the marketing site, the
 * public status page, the explorer, the developer platform and the account portal. Any of them
 * would be wrong, and `App` refuses to render the console rather than warning about it.
 *
 * It is a deployment mistake rather than a code one, which is exactly why it is checked at
 * runtime: no test in this repository can fail for an nginx vhost pointed at the wrong bucket,
 * and the symptom — an operator console answering on `hub.<apex>` — is invisible until somebody
 * without the role loads it.
 *
 * The gateway is the FIRST gate and this is the second; see the README for what the gateway must
 * enforce. Neither replaces `admin-api`'s own `requireOperator`
 * (`admin-api/src/server.ts:443`), which is the one that actually refuses.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── The dev port disagreement, recorded rather than worked around ──────────────────────────────
 *
 * The surface registry gives `admin` devPort **3002** (`ui/packages/ui/src/surfaces.ts`), and
 * `admin-api` binds **4014** (`admin-api/src/env.ts:167`, `admin-api/.env.example:76`). In
 * production that is invisible: the console and its API are the same origin behind
 * `admin.<apex>`, so `apiBase()` is `''` and every request is relative. Under `pnpm dev` it is
 * not, and this repository does NOT paper over it with a literal port — a hard-coded host is a
 * second, unversioned copy of the registry, and the copy is the one that will be wrong. It is
 * reported to `micro-ui`, whose file that is, and the README says how to run locally meanwhile.
 */
import {
  cloudsforgeHosts,
  SURFACES,
  type CloudsForgeHosts,
  type SurfaceKey,
} from '@cloudsforge/ui'

/**
 * The surface this console IS, and whose API it calls.
 *
 * One key rather than foresight-admin-web's two: this console is served from `admin.<apex>` and
 * `admin-api` answers on the same origin, so the bar's current entry and the API host are the
 * same surface.
 */
export const PRODUCT: SurfaceKey = 'admin'

/** The name reported to the observability ingest and shown in error copy. */
export const APP_NAME = 'admin-web'

/**
 * Origins this bundle must never be served from.
 *
 * Derived from the registry rather than listed, so a product added next year is covered without
 * anybody remembering to come back here. The rule: anything a person without the operator role
 * can reach. That is every `product`, plus the containers and front doors (Hub, the site, the
 * wallet, the faucet) and the public-facing services (status, explorer, developers, the account
 * portal, the public API). The three `adminOnly` switcher entries — admin, lantern, beacon — are
 * excluded, because they are operator surfaces and `admin` is this console's own home.
 */
export const PUBLIC_SURFACE_KEYS: readonly SurfaceKey[] = SURFACES.filter(
  (s) => s.kind === 'product' || (s.adminOnly !== true && s.key !== 'admin'),
).map((s) => s.key)

/**
 * The base URL for `admin-api`.
 *
 * Origins are COMPARED rather than a `DEV` flag consulted, because a flag is a build-time
 * constant and this repository has none: an image built for production and opened on localhost
 * would otherwise point at a host that is not there.
 */
export function resolveApiBase(pageOrigin: string, hosts: CloudsForgeHosts, key: SurfaceKey): string {
  const own = hosts[key]
  // With no page origin there is nothing for a relative URL to resolve against, so the absolute
  // form is the only correct answer.
  if (!pageOrigin) return own
  // A surface may carry a basePath (the wallet is a path inside Hub), so compare ORIGINS rather
  // than whole URLs — otherwise every such surface would look cross-origin to itself.
  return new URL(own).origin === pageOrigin ? '' : own
}

/** Is this bundle being served from an origin a member of the public can reach? */
export function servedFromPublicOrigin(pageOrigin: string, hosts: CloudsForgeHosts): boolean {
  if (!pageOrigin) return false
  return PUBLIC_SURFACE_KEYS.some((key) => {
    // A registry entry with no resolvable URL cannot be compared; treating it as a match would
    // refuse to render on a technicality.
    try {
      return new URL(hosts[key]).origin === pageOrigin
    } catch {
      return false
    }
  })
}

/**
 * Where this bundle may be served from, and what happens when it is not.
 *
 * `unregistered` is the third answer and it is not cosmetic. `cloudsforgeHosts()` derives the
 * apex by stripping a KNOWN subdomain prefix, and the known set is exactly the registry's own
 * subdomains plus `www`. Being served from another OPERATOR surface's origin — Lantern, Beacon —
 * is not a public exposure but it is not this console's home either, so it warns rather than
 * refuses.
 *
 * A hostname the registry does not know at all lands on the REFUSAL instead, and that is worth
 * knowing about rather than being surprised by: an unknown prefix is left alone, so the whole
 * name becomes the apex — which is byte-identical to the marketing site's origin, since the
 * site's subdomain is the empty string. A preview deployment of this console therefore refuses to
 * start. That is the right outcome for a second reason: at such an address this bundle would look
 * for `admin-api` at `admin.<that-name>` and would resolve the account portal one level too deep,
 * so it could not reach its API or sign anybody in. `MisplacedBundle` in app.tsx names both
 * readings, because the operator cannot tell them apart from the address bar.
 *
 * Local development is exempt because `cloudsforgeHosts()` exempts it: localhost resolves the
 * dev-port table rather than deriving an apex at all, so there is no apex to get wrong.
 */
export type Placement = 'ok' | 'public-origin' | 'unregistered'

export function placement(
  pageOrigin: string,
  hostname: string,
  hosts: CloudsForgeHosts,
): Placement {
  // Checked FIRST because it is the only one of the three that is a security problem rather than
  // a configuration one.
  if (servedFromPublicOrigin(pageOrigin, hosts)) return 'public-origin'
  if (isLocal(hostname)) return 'ok'
  if (!pageOrigin) return 'ok'
  return new URL(hosts[PRODUCT]).origin === pageOrigin ? 'ok' : 'unregistered'
}

/** The same four names `cloudsforgeHosts()` treats as development. Kept in step by test. */
export function isLocal(hostname: string): boolean {
  return (
    hostname === '' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local')
  )
}

/** Every CloudsForge base URL, for the current environment. */
export function hosts(): CloudsForgeHosts {
  return cloudsforgeHosts()
}

/** The API base, resolved now. Call it per request; never cache it in a module constant. */
export function apiBase(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return resolveApiBase(origin, cloudsforgeHosts(), PRODUCT)
}

/** The page origin, or a stable placeholder when there is no document (tests, prerender). */
export function pageOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}

/** Where this bundle is being served from, resolved now. Read by `App` before it renders. */
export function currentPlacement(): Placement {
  if (typeof window === 'undefined') return 'ok'
  return placement(window.location.origin, window.location.hostname, cloudsforgeHosts())
}

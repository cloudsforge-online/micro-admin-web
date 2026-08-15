/**
 * Forge Worlds — generating and running *Ninety Days After* worlds.
 *
 * `GET /v1/worlds`, `POST /v1/worlds`, `POST /v1/worlds/:id/start`, `POST /v1/worlds/:id/tick`
 * and `PUT /v1/worlds/:id/bots` — **admin-api/src/server.ts**, which forwards the OPERATOR's own
 * bearer to `nda` rather than minting a service token. Same arrangement as `mail.ts`, and for the
 * same reason: nda's `requireAdminPrincipal` takes either a service holding `nda:write` or a human
 * with `role:admin`, and a world should record the human who generated it.
 *
 * ── WHY THIS GOES THROUGH admin-api AT ALL ────────────────────────────────────────────────────
 *
 * The Foresight panel in this console calls foresight DIRECTLY, on its own host (`foresight.ts`),
 * because that surface has a DNS record, a tunnel ingress rule, an Access policy and a pair of
 * Traefik routers. `nda` has none of those: it is absent from `surfaces.ts`, so
 * `deploy/cloudflared/config.mainnet.operator.yml` — which enumerates hostnames BY HAND, three of
 * them, and 404s everything else — has no entry that could reach it. The container has been
 * healthy for weeks and unreachable from any browser on earth. That, not a missing feature, is why
 * the title still reads `draft`.
 *
 * So these calls are plain `api()` against this origin, and the proxy is the door.
 *
 * ── EVERY MUTATION CARRIES AN `Idempotency-Key`, AND admin-api REFUSES WITHOUT ONE ────────────
 *
 * Not optional and not defaulted: `POST /v1/worlds` answers 400 when the header is absent rather
 * than inventing one, because creating a world runs the map generator, and a double-submitted form
 * without a key builds two worlds — neither of them wrong enough for anything downstream to
 * notice. The key is minted per page view via `idempotencyKeyFor`, so a retry after a lost
 * response presents the same key and nda replays the world it already built.
 */

import { api } from './api.ts'
import { idempotencyKeyFor } from './gate.ts'

/** A world's place in its own life: waiting for players, being played, over. */
export type WorldStatus = 'lobby' | 'active' | 'archived'

export interface World {
  readonly id: string
  readonly name: string
  /** What makes a world reproducible — same seed, same inputs, byte-identical resolution. */
  readonly seed: string
  readonly status: WorldStatus
  /** Which day of the season has resolved. `0` until the world starts. */
  readonly day: number
  readonly seasonLength: number
  readonly width: number
  readonly height: number
  readonly tickIntervalMinutes: number
  readonly humans: number
  readonly bots: number
}

export function loadWorlds(opts: { signal?: AbortSignal } = {}): Promise<{
  worlds: readonly World[]
}> {
  return api('/v1/worlds', { ...(opts.signal ? { signal: opts.signal } : {}) })
}

/**
 * The shape of the generator form.
 *
 * Every field but the name is optional, and an ABSENT field is sent as absent rather than as a
 * restated default. nda owns the bounds — 12..64 tiles a side, 5..365 days a season, 1..1440
 * minutes a tick (`nda/src/worlds.ts`) — and a default copied into this file is a second opinion
 * about how big a world should be that nobody would think to update.
 */
export interface NewWorld {
  readonly name: string
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly seasonLength?: number | undefined
  readonly tickIntervalMinutes?: number | undefined
  readonly seed?: string | undefined
}

/**
 * Generate a world.
 *
 * 201 when it is new, 200 when the key replayed one already built. The page says which, because
 * "you already made this" and "this is the world you just made" are different facts and only one
 * of them means the operator's click did something.
 *
 * Keyed on the NAME, like the broadcast composer keys on its title: a retry of the same form is
 * one world, and a genuinely different world named differently gets its own key.
 */
export function createWorld(
  world: NewWorld,
  mintedAt: number,
): Promise<{ world: World; replayed: boolean }> {
  return api('/v1/worlds', {
    method: 'POST',
    body: {
      name: world.name,
      ...(world.width === undefined ? {} : { width: world.width }),
      ...(world.height === undefined ? {} : { height: world.height }),
      ...(world.seasonLength === undefined ? {} : { seasonLength: world.seasonLength }),
      ...(world.tickIntervalMinutes === undefined
        ? {}
        : { tickIntervalMinutes: world.tickIntervalMinutes }),
      ...(world.seed === undefined || world.seed === '' ? {} : { seed: world.seed }),
    },
    headers: { 'idempotency-key': idempotencyKeyFor('world-create', world.name, mintedAt) },
  })
}

/** Open the world for play: `lobby` → `active`, and the first day begins resolving on schedule. */
export function startWorld(
  worldId: string,
  mintedAt: number,
): Promise<{ world: World; replayed: boolean }> {
  return api(`/v1/worlds/${encodeURIComponent(worldId)}/start`, {
    method: 'POST',
    body: {},
    headers: { 'idempotency-key': idempotencyKeyFor('world-start', worldId, mintedAt) },
  })
}

/**
 * Resolve the next day now, instead of waiting for the tick.
 *
 * 202: nothing has resolved when this returns. The day is enqueued behind the world's lease —
 * which is what stops an operator's force-tick and the scheduler's sweep advancing the same day
 * twice — so the page says "queued", never "resolved".
 *
 * ── THE KEY NAMES THE DAY, NOT THE PAGE VIEW ──────────────────────────────────────────────────
 *
 * `mintedAt` alone would make every tick after the first one in a single page view a REPLAY: the
 * operator clicks, day 4 resolves, they click again to advance day 5, and the same key comes back
 * with the day-4 answer and `replayed: true`. Nothing advances, the button looks like it worked,
 * and the only way to tick twice is to reload the page. Keying on the day the operator is asking
 * to advance makes a retry of one intention idempotent and a second intention distinct — which is
 * what the header is for, rather than a rate limiter that lies.
 */
export function tickWorld(
  worldId: string,
  day: number,
  mintedAt: number,
): Promise<{ queued: boolean; replayed: boolean }> {
  return api(`/v1/worlds/${encodeURIComponent(worldId)}/tick`, {
    method: 'POST',
    body: {},
    headers: {
      'idempotency-key': idempotencyKeyFor('world-tick', `${worldId}-d${day}`, mintedAt),
    },
  })
}

/**
 * Set how many bots inhabit the world.
 *
 * A SYNC, not a delta: the count is what the world should have, and nda adds or retires to reach
 * it. `enabled: false` is zero regardless of the count sent — admin-api forces it — so turning
 * bots off cannot leave a number behind that comes back the next time somebody toggles.
 *
 * The key names the TARGET, for the reason `tickWorld` names the day: 12 bots and then 20 bots are
 * two decisions, and a key that saw only the world id would answer the second with the first.
 */
export function setBots(
  worldId: string,
  bots: { enabled: boolean; count: number },
  mintedAt: number,
): Promise<{ bots: number; replayed: boolean }> {
  const target = bots.enabled ? bots.count : 0
  return api(`/v1/worlds/${encodeURIComponent(worldId)}/bots`, {
    method: 'PUT',
    body: { enabled: bots.enabled, count: bots.count },
    headers: {
      'idempotency-key': idempotencyKeyFor('world-bots', `${worldId}-n${target}`, mintedAt),
    },
  })
}

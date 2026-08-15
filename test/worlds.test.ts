/**
 * Forge Worlds, driven the way an operator drives it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR, GIVEN `render.test.ts` ALREADY READS THE SOURCE
 *
 * The Worlds screen is the first caller `nda` has ever had. The service is finished — worlds,
 * tiles, homesteads, communes, a day-resolution engine, bots — and it has no hostname, so nothing
 * has ever reached `POST /v1/worlds` and no world has ever been generated. That is why the
 * catalogue entry for *Ninety Days After* still reads `draft`.
 *
 * A first caller is exactly where a wrong request is invisible. Everything below is a property of
 * WHAT WENT OVER THE WIRE, which is what doc 22 §3.1 allows a DOM scenario to assert and what
 * TypeScript cannot see:
 *
 *   - a numeric field left EMPTY must be sent ABSENT, not as a zero and not as a default this
 *     console invented, because nda owns the bounds (12–64 tiles, 5–365 days, 1–1440 minutes) and a
 *     default copied into a frontend is a second opinion nobody would think to update;
 *   - every mutation must carry an `Idempotency-Key`, because admin-api answers 400 without one;
 *   - and the keys of two DIFFERENT intentions in one page view must DIFFER, which is the whole
 *     reason `tickWorld` keys on the day and `setBots` on the target rather than on the world id.
 *
 * That last one is the scenario worth the file. `idempotencyKeyFor(scope, subject, mintedAt)` mints
 * per page view; a key of `world-tick-<id>` would make the operator's second tick a REPLAY of their
 * first — 200, `replayed: true`, nothing advanced, the button looking like it worked, and the only
 * way to tick twice being to reload the page. Nothing about that fails to compile.
 *
 * **No scenario here asserts a business rule.** Whether a world may start, what the map looks like,
 * whether a day resolves — all nda's, and nothing below claims any of it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes as StubRoutes, type Screen } from './dom.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { WorldsPage } from '../src/pages/worlds.tsx'
import type { World } from '../src/lib/worlds.ts'

const ORIGIN = 'https://admin.cloudsforge.online'

const SIGNED_IN = {
  'cf.accessToken': 'a-test-access-token',
  'cf.refreshToken': 'a-test-refresh-token',
}

const ME: StubRoutes = {
  'GET /auth/me': {
    body: {
      user: { id: 'op-1', handle: 'avery', principal: 'operator:avery', roles: ['admin:operator'] },
    },
  },
}

const ID = '3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'

const world = (over: Partial<World> = {}): World => ({
  id: ID,
  name: 'The long winter',
  seed: 'a-fixed-seed',
  status: 'lobby',
  day: 0,
  seasonLength: 90,
  width: 32,
  height: 32,
  tickIntervalMinutes: 60,
  humans: 0,
  bots: 0,
  ...over,
})

const page = (): ReactElement =>
  h(MemoryRouter, { initialEntries: ['/worlds'] }, h(AuthProvider, null, h(WorldsPage)))

/**
 * Reveal one `ReversibleAction`'s real control: the first press only explains it.
 *
 * Scoped to the `<section aria-label={label}>` the component renders, because this page carries
 * four of them — the generator, and up to three per world — and an unscoped
 * `byRole('button', 'What will this do?')` would be ambiguous on exactly the page that matters.
 * Copied from the same helper in `test/double-submit.test.ts`.
 */
async function reveal(s: Screen, actionLabel: string): Promise<Element> {
  const sections = s
    .allByRole('region')
    .filter((el) => el.getAttribute('aria-label') === actionLabel)
  assert.equal(sections.length, 1, `expected one action labelled "${actionLabel}", found ${sections.length}`)
  const section = sections[0] as Element
  const control = (): Element => {
    const buttons = Array.from(section.querySelectorAll('button'))
    assert.equal(buttons.length, 1, `"${actionLabel}" has ${buttons.length} buttons, expected its one control`)
    return buttons[0] as Element
  }
  await s.click(control())
  return control()
}

/** The one text input inside an action, addressed by the label above it. */
function fieldIn(s: Screen, actionLabel: string, fieldLabel: string): Element {
  const box = s.byRole('textbox', fieldLabel)
  const section = box.closest('[aria-label]')
  assert.equal(
    section?.getAttribute('aria-label'),
    actionLabel,
    `"${fieldLabel}" is not inside "${actionLabel}"`,
  )
  return box
}

/* ══════════════════════════ generating the first world ══════════════════════════ */

describe('generating a world', () => {
  it('sends only the name when every number is left empty, so nda applies its own bounds', async () => {
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: {
          ...ME,
          'GET /v1/worlds': { body: { worlds: [] } },
          'POST /v1/worlds': { status: 201, body: { world: world({ name: 'Nefeli' }), replayed: false } },
        },
      },
      async (s) => {
        await s.type(fieldIn(s, 'Generate a world', 'Name'), 'Nefeli')
        await s.click(await reveal(s, 'Generate a world'))
        await s.settle()

        const sent = s.api.matching('POST /v1/worlds')
        assert.equal(sent.length, 1, 'the generator did not send exactly one request')
        // The assertion is on the KEYS, not on the values: a `width: 32` this console invented
        // would be a perfectly valid request that quietly overrode the game's own default.
        assert.deepEqual(Object.keys(sent[0]!.json as object), ['name'])
        assert.deepEqual(sent[0]!.json, { name: 'Nefeli' })
      },
    )
  })

  it('sends the numbers that were typed, and still omits the ones that were not', async () => {
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: {
          ...ME,
          'GET /v1/worlds': { body: { worlds: [] } },
          'POST /v1/worlds': { status: 201, body: { world: world(), replayed: false } },
        },
      },
      async (s) => {
        await s.type(fieldIn(s, 'Generate a world', 'Name'), 'The long winter')
        await s.type(fieldIn(s, 'Generate a world', 'Season length'), '30')
        await s.type(fieldIn(s, 'Generate a world', 'Seed'), 'a-fixed-seed')
        await s.click(await reveal(s, 'Generate a world'))
        await s.settle()

        const sent = s.api.matching('POST /v1/worlds')
        assert.equal(sent.length, 1)
        assert.deepEqual(sent[0]!.json, {
          name: 'The long winter',
          seasonLength: 30,
          seed: 'a-fixed-seed',
        })
      },
    )
  })

  it('carries an Idempotency-Key, because admin-api refuses the request without one', async () => {
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: {
          ...ME,
          'GET /v1/worlds': { body: { worlds: [] } },
          'POST /v1/worlds': { status: 201, body: { world: world(), replayed: false } },
        },
      },
      async (s) => {
        await s.type(fieldIn(s, 'Generate a world', 'Name'), 'The long winter')
        await s.click(await reveal(s, 'Generate a world'))
        await s.settle()

        const key = s.api.matching('POST /v1/worlds')[0]?.headers['idempotency-key']
        // The floor admin-api's `idempotencyKeyOf` enforces, restated: a key it rejects reads to an
        // operator as "the form is broken", which is the failure this length check exists for.
        assert.ok((key ?? '').length >= 8, `the generator sent no usable key: ${String(key)}`)
      },
    )
  })

  it('says the world already existed when the service replayed one, rather than claiming a new one', async () => {
    // 200 + `replayed: true` is nda answering "you already asked me this". Reporting it as a fresh
    // world would tell an operator their click generated a map when it generated nothing.
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: {
          ...ME,
          'GET /v1/worlds': { body: { worlds: [] } },
          'POST /v1/worlds': { body: { world: world(), replayed: true } },
        },
      },
      async (s) => {
        await s.type(fieldIn(s, 'Generate a world', 'Name'), 'The long winter')
        await s.click(await reveal(s, 'Generate a world'))
        await s.settle()

        assert.match(s.textOf(s.document.body), /already existed/)
      },
    )
  })
})

/* ══════════════════ two intentions in one page view are two keys ══════════════════ */

describe('the idempotency key names the intention, not the world', () => {
  it('a second tick, after the day moved, is a different key — it is not swallowed as a replay', async () => {
    // The bug this scenario is written against: keying on the world id alone would make the second
    // tick present the first tick's key, come back `replayed: true` with the day-4 answer, and
    // advance nothing — with the button looking exactly as it does when it worked.
    let day = 4
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: {
          ...ME,
          // The list is re-read after each tick, the way the page reloads it, and the day has moved
          // by then. A stub that answered the same day twice could not tell the two keys apart.
          'GET /v1/worlds': () => ({ body: { worlds: [world({ status: 'active', day })] } }),
          [`POST /v1/worlds/${ID}/tick`]: () => {
            day += 1
            return { status: 202, body: { queued: true, replayed: false } }
          },
        },
      },
      async (s) => {
        const tick = await reveal(s, 'Resolve the next day now')
        await s.click(tick)
        await s.settle()
        await s.click(s.byRole('button', 'Queue the day'))
        await s.settle()

        const sent = s.api.matching(`POST /v1/worlds/${ID}/tick`)
        assert.equal(sent.length, 2, 'the second tick never reached the service')
        assert.notEqual(
          sent[0]!.headers['idempotency-key'],
          sent[1]!.headers['idempotency-key'],
          'both ticks presented the same key, so the second would replay the first and nothing would advance',
        )
      },
    )
  })

  it('two different bot targets in one page view are two keys, and the same target twice is one', async () => {
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: {
          ...ME,
          'GET /v1/worlds': { body: { worlds: [world({ status: 'active', day: 4 })] } },
          [`PUT /v1/worlds/${ID}/bots`]: { body: { bots: 12, replayed: false } },
        },
      },
      async (s) => {
        const run = await reveal(s, 'Bots living in this world')
        const box = () => fieldIn(s, 'Bots living in this world', 'How many')

        await s.type(box(), '12')
        await s.click(run)
        await s.settle()

        await s.type(box(), '20')
        await s.click(s.byRole('button', 'Bring it to 20'))
        await s.settle()

        // And back to twelve: the SAME decision as the first press, so the same key. This is the
        // half that makes the key a key rather than a nonce — a retry of one intention replays.
        await s.type(box(), '12')
        await s.click(s.byRole('button', 'Bring it to 12'))
        await s.settle()

        const sent = s.api.matching(`PUT /v1/worlds/${ID}/bots`)
        assert.equal(sent.length, 3, 'a bot change never reached the service')
        const keys = sent.map((w) => w.headers['idempotency-key'])
        assert.notEqual(keys[0], keys[1], 'twelve bots and twenty bots presented the same key')
        assert.equal(keys[0], keys[2], 'the same target twice presented two keys, so a retry is not a retry')
        assert.deepEqual(sent[1]!.json, { enabled: true, count: 20 })
      },
    )
  })

  it('zero bots is sent as disabled, so the count cannot come back when somebody toggles', async () => {
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: {
          ...ME,
          'GET /v1/worlds': { body: { worlds: [world({ status: 'active', day: 4, bots: 12 })] } },
          [`PUT /v1/worlds/${ID}/bots`]: { body: { bots: 0, replayed: false } },
        },
      },
      async (s) => {
        const run = await reveal(s, 'Bots living in this world')
        await s.type(fieldIn(s, 'Bots living in this world', 'How many'), '0')
        await s.click(run)
        await s.settle()

        const sent = s.api.matching(`PUT /v1/worlds/${ID}/bots`)
        assert.equal(sent.length, 1)
        assert.equal((sent[0]!.json as { enabled: boolean }).enabled, false)
      },
    )
  })
})

/* ══════════════════════════ what the operator is shown ══════════════════════════ */

describe('the worlds list', () => {
  it('tells the operator what an empty list costs a player, and where to fix it', async () => {
    // This assertion used to be `/draft/`, written against a hint that told the operator generating
    // a world is "what takes the title out of draft". It is not, and it never was. A title's status
    // lives in `worlds`' own register — `titles.ts`, moved by the titles route — and `nda` writes
    // worlds and nothing else. The sentence sent an operator to this page to fix something the page
    // cannot reach, and the test froze it in place.
    //
    // What the empty state can honestly say is what it now says: there is nothing for a player to
    // open, and the form above is where that changes. So that is what is asserted — the consequence
    // and the remedy, which is what an empty screen is for.
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: { ...ME, 'GET /v1/worlds': { body: { worlds: [] } } },
      },
      async (s) => {
        const shown = s.textOf(s.document.body)
        assert.match(shown, /nothing for a player to open/i, 'the empty state does not say what an empty list costs')
        assert.match(shown, /generate one here/i, 'the empty state does not point at the form above it')
        assert.doesNotMatch(
          shown,
          /takes the title out of draft/i,
          'the empty state is back to promising something this page cannot do — a title moves through ' +
            "the titles route in `worlds`, not by generating an `nda` world",
        )
      },
    )
  })

  it('groups a world under what can be done to it, and offers only the actions that apply', async () => {
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: {
          ...ME,
          'GET /v1/worlds': {
            body: {
              worlds: [
                // Names chosen to be unique tokens on the page, so an ordering assertion cannot
                // accidentally match a section heading or a consequence sentence instead.
                world({ id: `${ID}-a`, name: 'Nefeli', status: 'lobby' }),
                world({ id: `${ID}-b`, name: 'Kalliope', status: 'active', day: 4 }),
                world({ id: `${ID}-c`, name: 'Thalassa', status: 'archived', day: 90 }),
              ],
            },
          },
        },
      },
      async (s) => {
        const labels = s
          .allByRole('region')
          .map((el) => el.getAttribute('aria-label'))
          .filter((l): l is string => l !== null)

        // A world in lobby can be started and cannot be ticked; a running one is the reverse; an
        // archived one takes nothing at all. The button that is absent is the assertion.
        assert.ok(labels.includes('Open it for play'), 'a world in lobby offers no way to open it')
        assert.ok(labels.includes('Resolve the next day now'), 'a running world offers no way to force a day')
        assert.equal(
          labels.filter((l) => l === 'Open it for play').length,
          1,
          'a world that is not in lobby was offered a start',
        )
        assert.equal(
          labels.filter((l) => l === 'Bots living in this world').length,
          2,
          'bots were offered on an archived world, or withheld from a live one',
        )
        // Ordered by the work: what needs opening, what is being played, what is over.
        s.before('Nefeli', 'Kalliope', 'a world waiting to be opened is below one already running')
        s.before('Kalliope', 'Thalassa', 'a finished season is above one still being played')
      },
    )
  })

  it('names a world before it starts by what it will be, not by a day it has not reached', async () => {
    // `day: 0` on a world in lobby is not day zero of anything — the season has not begun. Printing
    // "0 of 90" would read as a season already underway and stalled.
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: {
          ...ME,
          'GET /v1/worlds': { body: { worlds: [world({ status: 'lobby', day: 0, seasonLength: 90 })] } },
        },
      },
      async (s) => {
        const body = s.textOf(s.document.body)
        assert.match(body, /not started/)
        assert.equal(body.includes('0 of 90'), false, 'a world in lobby was rendered as being on day zero')
      },
    )
  })

  it('starts a world with a key, and asks the service rather than deciding locally', async () => {
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/worlds`,
        storage: SIGNED_IN,
        routes: {
          ...ME,
          'GET /v1/worlds': { body: { worlds: [world({ status: 'lobby' })] } },
          [`POST /v1/worlds/${ID}/start`]: {
            body: { world: world({ status: 'active', day: 1 }), replayed: false },
          },
        },
      },
      async (s) => {
        await s.click(await reveal(s, 'Open it for play'))
        await s.settle()

        const sent = s.api.matching(`POST /v1/worlds/${ID}/start`)
        assert.equal(sent.length, 1, 'starting the world sent no request')
        assert.ok((sent[0]!.headers['idempotency-key'] ?? '').length >= 8, 'the start carried no usable key')
      },
    )
  })
})

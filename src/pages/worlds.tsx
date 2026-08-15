/**
 * Forge Worlds — generate a *Ninety Days After* world, open it, run it.
 *
 * `GET /v1/worlds`, `POST /v1/worlds`, `POST /v1/worlds/:id/start`, `POST /v1/worlds/:id/tick`,
 * `PUT /v1/worlds/:id/bots` — all through `lib/worlds.ts`. See that file for why the calls go
 * through admin-api rather than at nda directly.
 *
 * ── WHAT WAS ACTUALLY MISSING, SINCE IT WAS NOT THE GAME ──────────────────────────────────────
 *
 * `nda` is finished: worlds, tiles, homesteads, communes, a day-resolution engine, bots, and an
 * admin API whose `requireAdminPrincipal` has always accepted a human with `role:admin`. What it
 * has never had is a caller. There is no nda-web, no row in `surfaces.ts`, therefore no hostname,
 * therefore no way for anybody to reach `POST /v1/worlds` — so no world was ever generated, so the
 * catalogue's `ninety-days-after` entry has stayed `draft` for as long as it has existed. This
 * screen is the caller.
 *
 * ── WHY THIS IS A SCREEN AND NOT A CURL RUNBOOK ───────────────────────────────────────────────
 *
 * Generating a world takes six numbers and a seed, and the ones that matter are not obvious: a
 * season length sets how long the title's whole premise runs, and a tick interval sets how much of
 * a player's day it asks for. Those are product decisions being made under a shell prompt, once,
 * by whoever remembers the flags. Here they have their bounds, their defaults and their
 * consequences written beside them.
 *
 * ── THE THREE ACTIONS ARE ORDERED BY HOW HARD THEY ARE TO UNDO ────────────────────────────────
 *
 * Bots is a sync and reversible. Ticking is not reversible — a resolved day stays resolved — but
 * it is the schedule doing early what it would have done anyway. Starting is the one-way door:
 * `lobby → active` has no route back, and a world opened by mistake is archived rather than
 * un-started. So starting states that plainly, and none of the three is a bare button.
 */
import { useCallback, useMemo, useState } from 'react'
import { asOfLabel, count, worldTone } from '../lib/format.ts'
import { previewWorld } from '../lib/gate.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { useSession } from '../lib/auth.tsx'
import {
  createWorld,
  loadWorlds,
  setBots,
  startWorld,
  tickWorld,
  type World,
  type WorldStatus,
} from '../lib/worlds.ts'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { AsOf, Facts, StatusWord } from '../components/tone.tsx'
import { ReversibleAction } from '../components/irreversible.tsx'

/** Sorted the way the work arrives: what needs opening, what is running, what is over. */
const ORDER: readonly WorldStatus[] = ['lobby', 'active', 'archived']

const SECTION: Readonly<Record<WorldStatus, { title: string; lede: string }>> = {
  lobby: {
    title: 'Waiting to open',
    lede: 'Generated, with a map and a seed, and nobody can join until it is started.',
  },
  active: {
    title: 'Being played',
    lede: 'Days resolve on the world’s own tick. Forcing one runs it now instead of later.',
  },
  archived: {
    title: 'Over',
    lede: 'The season ran out. The world stays readable — nothing is deleted when it ends.',
  },
}

export function WorldsPage() {
  const [readAt, setReadAt] = useState<Date | null>(null)
  const load = useCallback(async (signal: AbortSignal) => {
    const result = await loadWorlds({ signal })
    setReadAt(new Date())
    return result.worlds
  }, [])
  const worlds = useResource<readonly World[]>(
    load,
    (rows) => rows.length,
    'The worlds could not be loaded.',
  )
  const now = new Date()

  // One mint per page view, shared by every action on it: `idempotencyKeyFor`'s contract is a key
  // per INTENTION, and a value recomputed each render would make every retry a fresh world.
  const mintedAt = useMemo(() => Date.now(), [])

  const grouped = useMemo(() => {
    const rows = worlds.data ?? []
    return ORDER.map((status) => ({ status, rows: rows.filter((w) => w.status === status) })).filter(
      (group) => group.rows.length > 0,
    )
  }, [worlds.data])

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Forge Worlds</h1>
        <p className="aw-page-lede">
          Ninety Days After runs one season per world: a generated map, a fixed number of days, and
          whoever is living on it when the days run out. This is where a world is made and run.
        </p>
      </header>

      <div className="aw-toolbar">
        {readAt !== null && <AsOf label={asOfLabel(readAt, now)} />}
        <button type="button" className="cf-btn cf-btn--quiet" onClick={worlds.reload}>
          Read again
        </button>
      </div>

      <Generator mintedAt={mintedAt} onDone={worlds.reload} />

      {worlds.state === 'loading' && <Loading label="Reading the worlds" />}
      {worlds.state === 'forbidden' && <Forbidden notice={worlds.error ?? undefined} />}
      {worlds.state === 'failed' && worlds.error !== null && (
        <Failed notice={worlds.error} onRetry={worlds.reload} title="The worlds did not load" />
      )}
      {worlds.state === 'empty' && (
        <Empty
          title="No world has been generated yet"
          // NOT "this is what takes the title out of draft" — it never was. `nda` writes worlds and
          // nothing else; a title's status lives in `worlds`' own register (`POST /v1/titles`), which
          // this screen does not call. The old sentence sent an operator here to fix something this
          // page cannot reach.
          hint="Generate one here, then start it. Until a world exists there is nothing for a player to open at /play — Ninety Days After serves worlds and has none."
        />
      )}

      {grouped.map((group) => (
        <section key={group.status} className="aw-section">
          <h2 className="aw-section__title">{SECTION[group.status].title}</h2>
          <p className="aw-section__lede">{SECTION[group.status].lede}</p>
          {group.rows.map((world) => (
            <WorldCard
              key={world.id}
              world={world}
              mintedAt={mintedAt}
              onDone={worlds.reload}
            />
          ))}
        </section>
      ))}
    </>
  )
}

/* ────────────────────────────────── generating one ────────────────────────────────── */

/**
 * The form.
 *
 * Every numeric field is EMPTY by default and sent absent, so nda applies its own bounds and
 * defaults (`nda/src/worlds.ts`). Pre-filling them here would copy four numbers into a frontend
 * that nobody would think to update when the game changed them — and would make every world the
 * console generates carry the console's opinion rather than the game's.
 */
function Generator({ mintedAt, onDone }: { mintedAt: number; onDone: () => void }) {
  const { operator } = useSession()
  const [name, setName] = useState('')
  const [seed, setSeed] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [seasonLength, setSeasonLength] = useState('')
  const [tickIntervalMinutes, setTickIntervalMinutes] = useState('')

  const trimmed = name.trim()
  const numbers = { width, height, seasonLength, tickIntervalMinutes }
  const badField = Object.entries(numbers).find(([, raw]) => raw !== '' && !isWholeNumber(raw))

  const create = useMutation<[], { world: World; replayed: boolean }>(
    async () =>
      createWorld(
        {
          name: trimmed,
          ...parsed('width', width),
          ...parsed('height', height),
          ...parsed('seasonLength', seasonLength),
          ...parsed('tickIntervalMinutes', tickIntervalMinutes),
          ...(seed.trim() === '' ? {} : { seed: seed.trim() }),
        },
        mintedAt,
      ),
    'The world could not be generated.',
  )

  const run = async () => {
    const result = await create.run()
    if (result !== null) onDone()
  }

  const disabledReason =
    trimmed === ''
      ? 'A world needs a name before it can be generated. It is what players see and what the audit row records.'
      : badField
        ? `${LABELS[badField[0] as keyof typeof LABELS]} must be a whole number, or left empty to take the game’s own default.`
        : null

  return (
    <ReversibleAction
      label="Generate a world"
      summary="Builds the map and writes the world in lobby. Nobody can join until it is started, so this is the safe half."
      consequences={[
        'The map is generated from the seed. Same seed, same size, same map — which is how a world can be rebuilt exactly if it ever has to be.',
        'It is created in lobby. No day resolves and no player joins until somebody starts it.',
        'Anything you leave empty is decided by the game, not by this page: 12–64 tiles a side, 5–365 days a season, 1–1440 minutes a tick.',
      ]}
      previews={[
        previewWorld({ actor: operator.principal, kind: 'create', name: trimmed, seed: seed.trim() }),
      ]}
      runLabel="Generate it"
      busy={create.busy}
      disabledReason={disabledReason}
      onRun={() => void run()}
    >
      <div className="aw-form-grid">
        <Field
          label="Name"
          hint="What players see. Required."
          value={name}
          onChange={setName}
          placeholder="The long winter"
        />
        <Field
          label="Seed"
          hint="Leave empty and the game picks one. Two worlds with the same seed and size have the same map."
          value={seed}
          onChange={setSeed}
          placeholder="chosen for you"
        />
        <Field label={LABELS.width} hint="Tiles across. 12–64." value={width} onChange={setWidth} placeholder="the game’s default" />
        <Field label={LABELS.height} hint="Tiles down. 12–64." value={height} onChange={setHeight} placeholder="the game’s default" />
        <Field
          label={LABELS.seasonLength}
          hint="Days before the world archives itself. 5–365."
          value={seasonLength}
          onChange={setSeasonLength}
          placeholder="the game’s default"
        />
        <Field
          label={LABELS.tickIntervalMinutes}
          hint="Minutes between days. 1–1440. This is how much of a player’s day the world asks for."
          value={tickIntervalMinutes}
          onChange={setTickIntervalMinutes}
          placeholder="the game’s default"
        />
      </div>

      {create.error !== null && <Failed notice={create.error} title="The world was not generated" />}
      {create.result !== null && (
        <p className="aw-note" role="status">
          {create.result.replayed ? (
            <>
              <strong>{create.result.world.name}</strong> already existed — this was the same request
              as before, so the world you made earlier came back rather than a second one.
            </>
          ) : (
            <>
              <strong>{create.result.world.name}</strong> was generated: {create.result.world.width}×
              {create.result.world.height} tiles, {count(create.result.world.seasonLength, 'day')},
              seed <code className="cf-num">{create.result.world.seed}</code>. It is waiting below.
            </>
          )}
        </p>
      )}
    </ReversibleAction>
  )
}

const LABELS = {
  width: 'Width',
  height: 'Height',
  seasonLength: 'Season length',
  tickIntervalMinutes: 'Tick interval',
} as const

function isWholeNumber(raw: string): boolean {
  return /^\d+$/.test(raw.trim())
}

/** `{}` for an empty box, so the field is sent ABSENT and the game's own default applies. */
function parsed<K extends string>(field: K, raw: string): Partial<Record<K, number>> {
  return raw.trim() === '' || !isWholeNumber(raw)
    ? {}
    : ({ [field]: Number(raw.trim()) } as Record<K, number>)
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint: string
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <label className="aw-field">
      <span className="aw-field__label">{label}</span>
      <span className="aw-field__hint">{hint}</span>
      <input
        className="aw-field__input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

/* ────────────────────────────────── running one ────────────────────────────────── */

function WorldCard({
  world,
  mintedAt,
  onDone,
}: {
  world: World
  mintedAt: number
  onDone: () => void
}) {
  return (
    <article className="aw-card" aria-label={world.name}>
      <div className="aw-card__head">
        <h3 className="aw-card__title">{world.name}</h3>
        <StatusWord tone={worldTone(world.status)} />
      </div>

      <Facts
        rows={[
          {
            label: 'day',
            value:
              world.status === 'lobby'
                ? `not started — ${count(world.seasonLength, 'day')} when it does`
                : `${world.day} of ${world.seasonLength}`,
          },
          { label: 'map', value: `${world.width}×${world.height} tiles` },
          { label: 'tick', value: `every ${count(world.tickIntervalMinutes, 'minute')}` },
          { label: 'living there', value: `${count(world.humans, 'player')}, ${count(world.bots, 'bot')}` },
          { label: 'seed', value: <code className="cf-num">{world.seed}</code> },
          { label: 'id', value: <code className="cf-num">{world.id}</code> },
        ]}
      />

      {world.status === 'lobby' && (
        <Start world={world} mintedAt={mintedAt} onDone={onDone} />
      )}
      {world.status === 'active' && <Tick world={world} mintedAt={mintedAt} onDone={onDone} />}
      {world.status !== 'archived' && <Bots world={world} mintedAt={mintedAt} onDone={onDone} />}
    </article>
  )
}

function Start({ world, mintedAt, onDone }: { world: World; mintedAt: number; onDone: () => void }) {
  const { operator } = useSession()
  const go = useMutation<[], { world: World; replayed: boolean }>(
    async () => startWorld(world.id, mintedAt),
    'The world could not be started.',
  )
  const run = async () => {
    if ((await go.run()) !== null) onDone()
  }

  return (
    <>
      <ReversibleAction
        label="Open it for play"
        summary="Moves the world out of lobby. From here it runs on its own schedule."
        consequences={[
          `Days start resolving every ${count(world.tickIntervalMinutes, 'minute')}, and the season ends after ${count(world.seasonLength, 'day')}.`,
          'Players can join and claim land. What they build is theirs for the rest of the season.',
          'There is no way back to lobby. A world opened by mistake is archived, not un-started — so check the name and the seed above first.',
        ]}
        previews={[previewWorld({ actor: operator.principal, kind: 'start', id: world.id, name: world.name })]}
        runLabel="Start the season"
        busy={go.busy}
        onRun={() => void run()}
      />
      {go.error !== null && <Failed notice={go.error} title="The world was not started" />}
    </>
  )
}

function Tick({ world, mintedAt, onDone }: { world: World; mintedAt: number; onDone: () => void }) {
  const { operator } = useSession()
  const go = useMutation<[], { queued: boolean; replayed: boolean }>(
    async () => tickWorld(world.id, world.day, mintedAt),
    'The day could not be queued.',
  )
  const run = async () => {
    if ((await go.run()) !== null) onDone()
  }

  return (
    <>
      <ReversibleAction
        label="Resolve the next day now"
        summary={`Runs day ${world.day + 1} immediately instead of waiting for the tick.`}
        consequences={[
          'The day is QUEUED, not resolved. It runs behind the world’s lease, which is what stops this and the scheduler advancing the same day twice.',
          'A resolved day is not reversible. This does not skip anything — it does early what the schedule would have done anyway.',
          'Read the world again in a moment to see the day move.',
        ]}
        previews={[
          previewWorld({ actor: operator.principal, kind: 'tick', id: world.id, name: world.name, day: world.day }),
        ]}
        runLabel="Queue the day"
        busy={go.busy}
        onRun={() => void run()}
      />
      {go.error !== null && <Failed notice={go.error} title="The day was not queued" />}
      {go.result !== null && (
        <p className="aw-note" role="status">
          {go.result.replayed
            ? `Day ${world.day + 1} was already queued by this page — it has not been queued twice.`
            : `Day ${world.day + 1} is queued. It resolves behind the world’s lease, not on this click.`}
        </p>
      )}
    </>
  )
}

/**
 * Bots.
 *
 * A SYNC: the number typed is what the world should have, and nda adds or retires to reach it.
 * Not a delta, so a double-submitted 20 is 20 bots rather than 40 — which is the whole reason the
 * count goes on the wire instead of a "+5" button.
 */
function Bots({ world, mintedAt, onDone }: { world: World; mintedAt: number; onDone: () => void }) {
  const { operator } = useSession()
  const [wanted, setWanted] = useState(String(world.bots))
  const enabled = isWholeNumber(wanted) && Number(wanted) > 0
  const target = enabled ? Number(wanted) : 0

  const go = useMutation<[], { bots: number; replayed: boolean }>(
    async () => setBots(world.id, { enabled, count: target }, mintedAt),
    'The bots could not be changed.',
  )
  const run = async () => {
    if ((await go.run()) !== null) onDone()
  }

  return (
    <>
      <ReversibleAction
        label="Bots living in this world"
        summary="How many the world should have. The game adds or retires to reach it."
        consequences={[
          target === 0
            ? 'Zero retires every bot. What they built stays — the world does not lose their homesteads with them.'
            : `The world is brought to ${count(target, 'bot')}, adding or retiring from the ${count(world.bots, 'bot')} there now.`,
          'This is a target, not a change: submitting the same number twice leaves the same number of bots.',
          'Bots act when a day resolves, so nothing visible happens until the next tick.',
        ]}
        previews={[
          previewWorld({
            actor: operator.principal,
            kind: 'bots',
            id: world.id,
            name: world.name,
            from: world.bots,
            to: target,
          }),
        ]}
        runLabel={target === 0 ? 'Retire them all' : `Bring it to ${target}`}
        busy={go.busy}
        disabledReason={
          isWholeNumber(wanted) || wanted.trim() === ''
            ? null
            : 'The number of bots must be a whole number, zero or more.'
        }
        onRun={() => void run()}
      >
        <Field
          label="How many"
          hint="Zero retires them all. The world has to be lived in for a day to resolve into anything."
          value={wanted}
          onChange={setWanted}
          placeholder="0"
        />
      </ReversibleAction>
      {go.error !== null && <Failed notice={go.error} title="The bots were not changed" />}
      {go.result !== null && (
        <p className="aw-note" role="status">
          {world.name} now has {count(go.result.bots, 'bot')}.
        </p>
      )}
    </>
  )
}

/**
 * The backup screens' pure layer: what the console may claim, and what it may not.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS FILE EXISTS BECAUSE A BACKUP SCREEN IS THE EASIEST SCREEN IN AN ESTATE TO LIE WITH.
 *
 * Every fact on it is reassuring by default. A row of green states, a size in gibibytes, a
 * checksum — none of which says whether the files read back, whether the machine they are on is
 * the machine they protect, or whether the one secret that makes the vault decryptable is in them.
 * A console that renders the reassuring half accurately and leaves the rest to a reader's
 * assumptions has not been wrong about anything and has still told them the wrong thing.
 *
 * So the derivations here are the unflattering ones: which backups nobody has ever proved, which
 * environment this estate actually is (and when that cannot be established), and what a set of
 * settings will be refused for. They are pure functions so `test/backups.test.ts` can prove each
 * refusal in every direction without rendering anything.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import type {
  Artefact,
  BackupCeilings,
  BackupRun,
  BackupSettings,
  EstateIdentity,
  RestoreRun,
} from './admin.ts'

/* ══════════════════════════ which estate is this? ══════════════════════════ */

export interface EstateEnvironment {
  /** What this console believes the estate is, or null when it could not establish it. */
  readonly environment: string | null
  /** The rows disagree with each other, which is itself worth putting on screen. */
  readonly mixed: boolean
  /** How the answer was arrived at, in the operator's words. Always present. */
  readonly basis: string
}

/**
 * Which environment this estate is — READ from the service, never derived.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS FUNCTION USED TO GUESS, AND THE GUESS WAS RIGHT, AND IT IS STILL GONE.
 *
 * The contract these screens were first written to served no field for the estate's own
 * environment, so this derived it: a backup is taken BY this estate OF this estate, so the
 * environment on its own runs is the environment it is. The service that landed serves
 * `estate.environment` from the `estate_identity` row (server.ts:1350) — and that row is not a
 * label. `requestRestore` reads it and refuses a backup taken elsewhere with
 * `EnvironmentMismatchError` (admin-api/src/backups.ts:608-622), so it is literally one half of the
 * comparison this screen exists to show.
 *
 * Keeping the derivation alongside it would have been a second, unversioned opinion about a
 * question the enforcing service answers — and the copy is the one that goes stale. So the served
 * value is the answer, and a null one is rendered as the absence it is: an estate that has claimed
 * no identity has `requestRestore` refusing every restore outright rather than guessing, which is
 * a fact an operator should read here rather than discover at the end of the ritual.
 *
 * ── What survives of the derivation, and why ──────────────────────────────────────────────────
 *
 * `mixed`. A list holding both `mainnet` and `testnet` runs means either the root path is shared
 * between two estates or artefacts were copied in from elsewhere — and neither is something the
 * `estate_identity` row can tell you, because it describes this estate rather than the directory.
 * It is a genuinely independent observation, so it is kept and reported as its own alarm.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function estateEnvironment(
  estate: EstateIdentity,
  backups: readonly BackupRun[],
): EstateEnvironment {
  const seen = new Set(backups.map((b) => b.environment))
  const mixed = seen.size > 1
  if (estate.environment === null) {
    return {
      environment: null,
      mixed,
      basis:
        'this estate has claimed no identity, so admin-api cannot check a restore for environment ' +
        'confusion — and it refuses every restore rather than guessing. That is a deployment ' +
        'problem, not a display one.',
    }
  }
  return {
    environment: estate.environment,
    mixed,
    basis:
      `served by admin-api from the estate_identity row, for compose project ${estate.composeProject}. ` +
      'It is the same value requestRestore compares a backup against, so what is shown here is ' +
      'what will decide the restore rather than a second opinion about it.',
  }
}

/** The environments the RUNS name, for the alarm when they disagree with each other. */
export function environmentsSeen(backups: readonly BackupRun[]): readonly string[] {
  return [...new Set(backups.map((b) => b.environment))].sort()
}

/* ══════════════════════════ ordering and verification ══════════════════════════ */

/**
 * Newest first, by the service's own clock.
 *
 * The contract says the list arrives newest first and this sorts it anyway, for the reason
 * `support.tsx` sorts the audit timeline itself: the order is the thing an operator reads the
 * screen for — "when did we last back this up" is answered by the top row — and a client that
 * inherits it from the response is one route change away from answering it with the oldest run.
 * Sorting a list that is already sorted costs nothing.
 *
 * A row whose `queuedAt` will not parse sorts LAST rather than first: an unreadable timestamp must
 * not be able to claim the top of a list whose top row is read as "the most recent backup".
 */
export function newestFirst(backups: readonly BackupRun[]): readonly BackupRun[] {
  return [...backups].sort((a, b) => at(b.queuedAt) - at(a.queuedAt))
}

/** The same, for restores. */
export function restoresNewestFirst(restores: readonly RestoreRun[]): readonly RestoreRun[] {
  return [...restores].sort((a, b) => at(b.queuedAt) - at(a.queuedAt))
}

function at(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

/**
 * A backup that completed and that nothing has ever restored.
 *
 * Deliberately narrower than "has no `verifiedAt`": a queued, running, failed or pruned run has no
 * artefacts a restore could have proved, and counting those as unverified would put a warning on
 * every row of a healthy list — which is how a warning stops being read.
 */
export function neverVerified(backup: BackupRun): boolean {
  return backup.state === 'succeeded' && (backup.verifiedAt === null || backup.verifiedAt === '')
}

/** How many finished backups nobody has ever proved. The headline number of the whole screen. */
export function unverifiedCount(backups: readonly BackupRun[]): number {
  return backups.filter(neverVerified).length
}

/**
 * The one sentence the list page leads with, or null when there is nothing to say.
 *
 * Three answers, and the order is the order they matter in: no backup at all beats an unverified
 * one, and an unverified one beats silence. Null means every finished backup here has been proved
 * by a restore, which is the only state that earns saying nothing.
 */
export function verificationHeadline(backups: readonly BackupRun[]): string | null {
  const finished = backups.filter((b) => b.state === 'succeeded')
  if (finished.length === 0) {
    return 'No backup of this estate has ever completed. There is nothing to restore from.'
  }
  const unproven = finished.filter(neverVerified).length
  if (unproven === 0) return null
  if (unproven === finished.length) {
    return `No backup here has ever been restored. All ${finished.length} of them are claims about ` +
      'what would happen, not evidence. Run a verify restore — it reads the artefacts back into a ' +
      'throwaway database and drops it, and nothing live is touched.'
  }
  return `${unproven} of ${finished.length} completed backups have never been restored, so nothing ` +
    'has proved they read back. A verify restore proves one without touching anything live.'
}

/* ══════════════════════════ the custody half ══════════════════════════ */

export interface CustodyCoverage {
  /** Completed runs that carried the custody vault. */
  readonly runs: number
  /** When the most recent of them finished. Null when none has. */
  readonly lastAt: string | null
}

/**
 * That a custody backup EXISTS — and nothing whatever about what is in it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONLY TWO NUMBERS THIS CONSOLE MAY KNOW ABOUT CUSTODY.
 *
 * An operator needs to be able to answer "is the vault being backed up at all", and that question
 * is answered by a COUNT and a DATE. It is not answered by a filename, a slot id, an address, a
 * key version or a byte of ciphertext, and this console never asks for any of them: the artefact
 * rows it renders carry names and checksums, and there is no field anywhere in the client that
 * could carry contents.
 *
 * `deploy/docs/custody-backup-restore.md`'s one rule is the reason: "never print, echo, paste or
 * commit a master secret, a private key, a mnemonic or an xprv … where a value must be handled, it
 * is moved file-to-file and its presence is proved with a checksum or a length, never by
 * displaying it." A count and a date are the presence; they are not the value.
 *
 * `includesCustody` is read only off runs that SUCCEEDED. A queued run that intends to include the
 * vault has not backed anything up, and rendering it as coverage would be the reassuring reading
 * of a run that may still fail.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function custodyCoverage(backups: readonly BackupRun[]): CustodyCoverage {
  const carried = newestFirst(
    backups.filter((b) => b.state === 'succeeded' && b.includesCustody),
  )
  const newest = carried[0]
  return {
    runs: carried.length,
    lastAt: newest === undefined ? null : (newest.finishedAt ?? newest.queuedAt),
  }
}

/* ══════════════════════════ what a restore may target ══════════════════════════ */

/**
 * The things this backup contains, as the names a restore is asked for.
 *
 * ── WHY THE OPTIONS COME FROM THE ARTEFACTS AND NOT FROM A LIST IN THIS FILE ──────────────────
 *
 * The contract types `targets` as `string[]` and does not enumerate the legal values. A hard-coded
 * list here would be this console inventing a vocabulary and then offering the operator options a
 * particular backup does not contain — a restore of a database that is not in the directory. The
 * artefacts ARE what is in there, by name, so they are what is offered. Duplicates collapse and
 * the order is the service's.
 */
export function targetNamesOf(artefacts: readonly Artefact[]): readonly string[] {
  return [...new Set(artefacts.map((a) => a.name).filter((name) => name.length > 0))]
}

/* ══════════════════════════ the settings form ══════════════════════════ */

export interface SettingsDraft {
  readonly rootPath: string
  readonly retentionCopies: string
  readonly scheduleEnabled: boolean
  readonly scheduleEveryMinutes: string
}

export function draftFrom(settings: BackupSettings): SettingsDraft {
  return {
    rootPath: settings.rootPath,
    retentionCopies: String(settings.retentionCopies),
    scheduleEnabled: settings.scheduleEnabled,
    scheduleEveryMinutes: String(settings.scheduleEveryMinutes),
  }
}

/**
 * What is wrong with this draft, in sentences, or nothing.
 *
 * ── THIS IS COURTESY, NOT ENFORCEMENT, AND IT SAYS SO ─────────────────────────────────────────
 *
 * `admin-api` holds the ceilings and is the thing that refuses; these checks exist so an operator
 * is not made to discover a typo by watching a 400 arrive. They therefore check only what is
 * knowable HERE without inventing a bound: that the numbers are positive integers rather than
 * empty boxes or decimals, and that the root path is absolute. The server's own ceilings are
 * rendered beside the form rather than reimplemented in it — a client-side copy of a bound is a
 * copy that goes stale the day the bound is tightened, and it goes stale silently.
 *
 * `retentionCopies` of zero is refused here rather than passed on, because it is the one value in
 * this form whose meaning is destructive rather than invalid: keeping zero copies is asking for
 * the backups to be pruned.
 */
export function settingsProblems(draft: SettingsDraft): readonly string[] {
  const problems: string[] = []
  const root = draft.rootPath.trim()
  if (root.length === 0) {
    problems.push('The root path is empty. That is where every artefact is written.')
  } else if (!root.startsWith('/')) {
    problems.push(
      `“${root}” is not an absolute path. The backup runs inside a container whose working ` +
        'directory is not yours, so a relative path names somewhere neither of you meant.',
    )
  }

  const copies = wholeNumber(draft.retentionCopies)
  if (copies === null) {
    problems.push(`“${draft.retentionCopies}” is not a whole number of copies to keep.`)
  } else if (copies < 1) {
    problems.push(
      'Keeping zero copies means every backup is pruned as soon as the next one succeeds. If the ' +
        'intention is to stop taking backups, turn the schedule off instead — that leaves the ' +
        'copies you already have.',
    )
  }

  if (draft.scheduleEnabled) {
    const minutes = wholeNumber(draft.scheduleEveryMinutes)
    if (minutes === null) {
      problems.push(`“${draft.scheduleEveryMinutes}” is not a whole number of minutes.`)
    } else if (minutes < 1) {
      problems.push('A schedule of less than a minute is not an interval; it is a loop.')
    }
  }
  return problems
}

/** A positive-or-zero whole number, or null. `Number('')` is 0 and `Number('1.5')` is not whole. */
function wholeNumber(value: string): number | null {
  const raw = value.trim()
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  // A retention count and a minute interval are small by construction; anything past the safe
  // integer range is a paste accident rather than an intention.
  return Number.isSafeInteger(n) ? n : null
}

/**
 * The ceilings, as rows to render — a bound per settable field.
 *
 * ── WHY THIS WALKS THE OBJECT RATHER THAN NAMING THE FIVE FIELDS ─────────────────────────────
 *
 * `BackupCeilings` is declared now that the service serves a known shape (admin-api's `CEILINGS`,
 * backups.ts:179). Rendering it by walking the entries anyway costs nothing and means a sixth
 * bound added to the service appears here rather than being silently withheld — and on a settings
 * form, a bound the operator cannot see is a 400 they will meet later. The declared type is what
 * makes the *known* five typecheck; this is what stops the sixth going missing.
 *
 * `bytes` marks the two whose values are bigint decimal strings, so the caller can render a human
 * size beside the digits. Detected by the value's shape, not by the field's name: a long run of
 * digits IS a byte count in this object, and a name-based rule would break the day a field is
 * called `maxArchiveSize`.
 */
export interface CeilingRow {
  readonly key: string
  readonly min: string
  readonly max: string
  /** True when both bounds are bigint decimal strings and are worth rendering as sizes too. */
  readonly bytes: boolean
}

export function ceilingRows(ceilings: BackupCeilings): readonly CeilingRow[] {
  // No cast. `BackupCeilings` carries an index signature precisely so this walk is legitimate —
  // see the note on it in lib/admin.ts. A cast here would have compiled and would have hidden the
  // thing the signature is there to state.
  return Object.entries(ceilings).flatMap(([key, bound]) => {
    if (bound === undefined) return []
    // A byte count is a decimal string; a count of copies or of minutes arrives as a JSON number.
    const bytes = typeof bound.min === 'string' && typeof bound.max === 'string'
    return [{ key, min: String(bound.min), max: String(bound.max), bytes }]
  })
}

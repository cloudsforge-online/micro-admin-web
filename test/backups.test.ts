/**
 * Backups and restores: the pure layer, and what an operator actually reads.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE RULE THIS FILE WORKS UNDER. Doc 22 §3: **a browser scenario may never assert a business
 * rule.**
 *
 * Whether a live restore is refused for an environment mismatch is `admin-api`'s to enforce, and a
 * client-side test of it would go green against a service that had stopped enforcing it — 14 §11,
 * where a game client withheld four SKUs from its UI while the payment routes stayed live and
 * chargeable. So nothing below asserts that a restore was refused.
 *
 * What the browser scenarios assert is the two things a stub CAN establish honestly:
 *
 *   1. **What the client sent** — how many requests left the browser, and whether the confirmation
 *      phrase that went over the wire is the same string the operator was shown. That last one is
 *      squarely the client's own: the service compares the phrase, and a console that displayed
 *      one string and sent another would refuse every live restore in the estate.
 *   2. **That what the operator reads is true relative to the stubbed response** — the protection
 *      limits on screen are the ones admin-api sent, the "never verified" word is on the row whose
 *      `verifiedAt` was null, and the two environments shown are the two the fixtures supplied.
 *
 * ── AND THE HALF THAT IS NOT A BROWSER TEST AT ALL ────────────────────────────────────────────
 *
 * `restoreGate`, `estateEnvironment`, `formatBytes` and `restoreConfirmationPhrase` are pure
 * functions, so every refusal is proven in every direction without rendering anything. Putting a
 * DOM under a function is pure cost; the DOM is reserved for the properties that only exist once
 * the page has rendered.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { withScreen, type Routes as StubRoutes, type Screen } from './dom.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import type {
  Artefact,
  BackupCeilings,
  BackupRun,
  BackupSettings,
  EstateIdentity,
  Protection,
  RestoreRun,
} from '../src/lib/admin.ts'
import {
  ceilingRows,
  custodyCoverage,
  draftFrom,
  environmentsSeen,
  estateEnvironment,
  neverVerified,
  newestFirst,
  settingsProblems,
  targetNamesOf,
  unverifiedCount,
  verificationHeadline,
} from '../src/lib/backups.ts'
import {
  backupTone,
  exactBytes,
  formatBytes,
  restoreTone,
  utcSecondStamp,
  verificationTone,
} from '../src/lib/format.ts'
import { restoreConfirmationPhrase, restoreGate, restoreRecordLines } from '../src/lib/gate.ts'
import { BackupPage } from '../src/pages/backup.tsx'
import { BackupsPage } from '../src/pages/backups.tsx'

const ORIGIN = 'https://admin.cloudsforge.online'
const BACKUP_ID = '5c4b3a29-1807-4f6e-95d4-c3b2a1908f7e'
const APPROVAL_ID = '3f2a1b9c-4d5e-4f60-8a1b-2c3d4e5f6071'

/* ══════════════════════════════ fixtures ══════════════════════════════ */

/**
 * One backup run.
 *
 * The rule these follow is `test/fixtures.ts`'s: **a fixture never carries a value the scenario
 * asserts as a literal.** Every scenario reads what it expects out of the fixture it supplied, so
 * a fixture and an assertion cannot agree with each other while both being wrong about the page.
 *
 * The one deliberate exception is the confirmation phrase, where the FORMAT is the thing under
 * test — the service compares it byte for byte — so it is written out and pinned.
 */
const backup = (over: Partial<BackupRun> = {}): BackupRun => ({
  id: BACKUP_ID,
  environment: 'mainnet',
  composeProject: 'cloudsforge',
  kind: 'full',
  state: 'succeeded',
  requestedBy: 'user:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  reason: 'before the ledger migration',
  rootPath: '/srv/backups',
  directory: '/srv/backups/2026-08-04T120000Z',
  queuedAt: '2026-08-04T12:00:00.000Z',
  startedAt: '2026-08-04T12:00:01.000Z',
  finishedAt: '2026-08-04T12:04:11.000Z',
  totalBytes: '3221225472',
  artefactCount: 3,
  manifestSha256: 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
  clusterSystemId: '7311559094203482112',
  includesCustody: true,
  error: null,
  verifiedAt: null,
  verifiedByRestore: null,
  ...over,
})

const artefact = (over: Partial<Artefact> = {}): Artefact => ({
  id: 'art-1',
  kind: 'database',
  name: 'ledger',
  relPath: 'databases/ledger.dump',
  bytes: '1073741824',
  sha256: 'abcdef01abcdef01abcdef01abcdef01abcdef01abcdef01abcdef01abcdef01',
  entryCount: null,
  ...over,
})

const restore = (over: Partial<RestoreRun> = {}): RestoreRun => ({
  id: 'res-1',
  backupRunId: BACKUP_ID,
  environment: 'mainnet',
  mode: 'verify',
  targets: ['ledger'],
  state: 'succeeded',
  requestedBy: 'user:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  reason: 'quarterly drill',
  approvalId: null,
  queuedAt: '2026-08-04T13:00:00.000Z',
  startedAt: '2026-08-04T13:00:02.000Z',
  finishedAt: '2026-08-04T13:02:00.000Z',
  artefactEnvironment: 'mainnet',
  checksumsVerified: true,
  outcome: {},
  error: null,
  ...over,
})

const settings = (over: Partial<BackupSettings> = {}): BackupSettings => ({
  rootPath: '/srv/backups',
  retentionCopies: 7,
  ceilingBytes: '536870912000',
  minFreeBytes: '107374182400',
  scheduleEnabled: true,
  scheduleEveryMinutes: 360,
  verifyEnabled: false,
  verifyEveryMinutes: 1440,
  updatedAt: '2026-08-01T09:00:00.000Z',
  updatedBy: 'user:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  ...over,
})

const estate = (over: Partial<EstateIdentity> = {}): EstateIdentity => ({
  environment: 'mainnet',
  composeProject: 'cloudsforge',
  ...over,
})

/** `CEILINGS`, admin-api/src/backups.ts:179 — a {min,max} per settable field. */
const ceilings = (over: Partial<BackupCeilings> = {}): BackupCeilings => ({
  retentionCopies: { min: 1, max: 365 },
  ceilingBytes: { min: '1073741824', max: '1099511627776' },
  minFreeBytes: { min: '1073741824', max: '1099511627776' },
  scheduleEveryMinutes: { min: 15, max: 43200 },
  verifyEveryMinutes: { min: 60, max: 43200 },
  ...over,
})

const protection = (over: Partial<Protection> = {}): Protection => ({
  destinationDevice: '/dev/disk/by-uuid/9f2c-backup',
  sameHost: true,
  covers: ['the primary disk failing'],
  doesNotCover: [
    'losing the machine — theft, fire, flood, a dead host',
    'ransomware that reaches both mounts',
    'an rm -rf with the wrong argument',
  ],
  custodyKeyringIncluded: false,
  custodyKeyringNote:
    'The custody master secret is never written to a backup. Its copies are paper and an encrypted ' +
    'USB stick, in two different buildings.',
  ...over,
})

/* ══════════════════════════════ the pure layer ══════════════════════════════ */

describe('formatBytes — a bigint, never a double', () => {
  it('formats a gibibyte from its exact byte count', () => {
    assert.equal(formatBytes('1073741824'), '1.00 GiB')
  })

  it('is exact past 2^53, where Number() has already stopped being', () => {
    // THE WHOLE REASON THIS FUNCTION IS BIGINT WORK. 2^53 + 1 is the first integer a double cannot
    // hold, and `Number('9007199254740993')` is 9007199254740992 — a size that is wrong in the
    // direction nobody checks, on the screen where the size is the evidence the backup contains
    // anything at all.
    assert.equal(Number('9007199254740993'), 9007199254740992)
    assert.equal(formatBytes('9007199254740993'), '8.00 PiB')
    // And the exact count survives to the title, digit for digit.
    assert.equal(exactBytes('9007199254740993'), '9,007,199,254,740,993 bytes')
  })

  it('cuts rather than rounds, so a size is never overstated', () => {
    // 1.999 KiB must not read as 2.00 KiB.
    assert.equal(formatBytes('2047'), '1.99 KiB')
  })

  it('renders below a kibibyte as plain bytes', () => {
    assert.equal(formatBytes('512'), '512 B')
    assert.equal(formatBytes('0'), '0 B')
  })

  it('refuses anything that is not a run of digits, rather than coercing it', () => {
    // `BigInt('')` is `0n`, and "0 B" is precisely the reading a missing size must never produce.
    for (const bad of ['', ' ', '-1', '1.5', 'nine', '1e9']) {
      assert.equal(formatBytes(bad), null, `${JSON.stringify(bad)} was coerced`)
    }
    assert.equal(formatBytes(null), null)
    assert.equal(formatBytes(undefined), null)
  })
})

describe('utcSecondStamp — a wire format, not a reading format', () => {
  it('is seconds, UTC, no fraction, with a Z', () => {
    // Pinned as a literal because it is the exact spelling inside the phrase admin-api compares.
    assert.equal(utcSecondStamp('2026-08-04T12:00:00.000Z'), '2026-08-04T12:00:00Z')
  })

  it('normalises an offset to UTC rather than keeping it', () => {
    assert.equal(utcSecondStamp('2026-08-04T15:00:00+03:00'), '2026-08-04T12:00:00Z')
  })

  it('is null for anything unparseable — never "now", never the empty string', () => {
    assert.equal(utcSecondStamp('not a date'), null)
    assert.equal(utcSecondStamp(null), null)
    assert.equal(utcSecondStamp(''), null)
  })
})

describe('restoreConfirmationPhrase — the string the SERVICE compares', () => {
  it('names what, from when, and into which environment', () => {
    assert.equal(
      restoreConfirmationPhrase('mainnet', '2026-08-04T12:00:00.000Z'),
      'restore mainnet from 2026-08-04T12:00:00Z',
    )
  })

  it('is null when it cannot be built, so the caller refuses rather than guesses', () => {
    assert.equal(restoreConfirmationPhrase('mainnet', 'not a date'), null)
    assert.equal(restoreConfirmationPhrase('   ', '2026-08-04T12:00:00.000Z'), null)
  })
})

describe('restoreGate — every refusal, in both directions', () => {
  const base = {
    backup: backup(),
    estateEnvironment: 'mainnet' as string | null,
    mode: 'live' as const,
    reasonCode: 'incident',
    targets: ['ledger'],
  }

  it('offers a live restore when everything lines up', () => {
    const gate = restoreGate(base)
    assert.equal(gate.offered, true)
    assert.equal(gate.reason, null)
    assert.equal(gate.mismatch, false)
    assert.equal(gate.phrase, 'restore mainnet from 2026-08-04T12:00:00Z')
  })

  it('refuses a pruned run and says the files are gone', () => {
    const gate = restoreGate({ ...base, backup: backup({ state: 'pruned' }) })
    assert.equal(gate.offered, false)
    assert.equal(gate.needsOperatorInput, false)
    assert.match(gate.reason ?? '', /pruned/)
  })

  it('refuses a run that has not finished, and says why there is nothing to read', () => {
    for (const state of ['queued', 'running', 'failed'] as const) {
      const gate = restoreGate({ ...base, backup: backup({ state }) })
      assert.equal(gate.offered, false, state)
      assert.equal(gate.needsOperatorInput, false, state)
      assert.match(gate.reason ?? '', new RegExp(state))
    }
  })

  it('refuses an environment mismatch and names BOTH environments', () => {
    const gate = restoreGate({ ...base, estateEnvironment: 'testnet' })
    assert.equal(gate.offered, false)
    assert.equal(gate.mismatch, true)
    assert.equal(gate.needsOperatorInput, false)
    assert.match(gate.reason ?? '', /mainnet/)
    assert.match(gate.reason ?? '', /testnet/)
  })

  it('does NOT refuse when the estate environment could not be established', () => {
    // The same decision `decisionGate` makes about an unknown operator principal. Refusing on the
    // strength of a derivation that came back empty would block a legitimate restore during an
    // incident, and admin-api compares the artefacts against the estate itself regardless.
    const gate = restoreGate({ ...base, estateEnvironment: null })
    assert.equal(gate.offered, true)
    assert.equal(gate.mismatch, false)
  })

  it('refuses an empty target list, and marks it as the operator’s to fix', () => {
    const gate = restoreGate({ ...base, targets: [] })
    assert.equal(gate.offered, false)
    assert.equal(gate.needsOperatorInput, true)
  })

  it('refuses a live restore with no reason code, and marks it as the operator’s to fix', () => {
    // `POST /v1/approvals` validates it against a closed list (approvals.ts:53-61) and answers 400
    // for anything else, so an empty box is a refusal the console can state rather than a 400 the
    // operator has to interpret.
    for (const code of ['', '   ']) {
      const gate = restoreGate({ ...base, reasonCode: code })
      assert.equal(gate.offered, false, JSON.stringify(code))
      assert.equal(gate.needsOperatorInput, true, JSON.stringify(code))
      assert.match(gate.reason ?? '', /closed list/)
    }
  })

  it('asks a verify restore for neither an approval nor a phrase', () => {
    const gate = restoreGate({ ...base, mode: 'verify', reasonCode: '' })
    assert.equal(gate.offered, true)
    assert.equal(gate.phrase, null)
  })

  it('still offers a VERIFY across an environment mismatch, because nothing live is touched', () => {
    // The mismatch is reported either way — the caller renders it — but a verify restores into a
    // throwaway database, so refusing it here would be this console inventing a rule.
    const gate = restoreGate({ ...base, mode: 'verify', reasonCode: '', estateEnvironment: 'testnet' })
    assert.equal(gate.offered, true)
    assert.equal(gate.mismatch, true)
  })

  it('refuses a live restore whose timestamp will not parse, rather than asking for a guess', () => {
    const gate = restoreGate({ ...base, backup: backup({ queuedAt: 'not a date' }) })
    assert.equal(gate.offered, false)
    assert.equal(gate.phrase, null)
    assert.match(gate.reason ?? '', /did not parse/)
  })

  it('checks the structural refusals BEFORE the ones the operator can fix', () => {
    // Ordering matters: a pruned run with an empty approval box must say "these files are gone",
    // not "type an approval id" — the second sends somebody to the approval queue for a backup
    // that cannot be restored whatever they come back with.
    const gate = restoreGate({ ...base, backup: backup({ state: 'pruned' }), reasonCode: '' })
    assert.match(gate.reason ?? '', /pruned/)
  })
})

describe('estateEnvironment — READ from the service, not derived from the rows', () => {
  it('answers with what admin-api served, and says where it came from', () => {
    const answer = estateEnvironment(estate({ environment: 'testnet' }), [backup()])
    assert.equal(answer.environment, 'testnet')
    // NOT the environment on the runs, which this fixture deliberately disagrees with. An earlier
    // version of this function derived the answer from the newest run; if that derivation ever came
    // back, this assertion is what fails.
    assert.notEqual(answer.environment, backup().environment)
    assert.match(answer.basis, /estate_identity/)
  })

  it('renders an unclaimed identity as the absence it is, not as a default', () => {
    // `requestRestore` refuses EVERY restore when this row is missing (admin-api/src/backups.ts:614)
    // rather than guessing, so an operator should read that here and not discover it at the end of
    // the ritual.
    const answer = estateEnvironment(estate({ environment: null }), [backup()])
    assert.equal(answer.environment, null)
    assert.match(answer.basis, /claimed no identity/)
  })

  it('raises its own alarm when the RUNS disagree, independently of the estate row', () => {
    // A different question from "which estate is this": this one is about the directory. Runs
    // naming two environments means the root path is shared or artefacts were copied in, and the
    // estate_identity row cannot tell you either way.
    const answer = estateEnvironment(estate(), [
      backup({ id: 'a', environment: 'mainnet' }),
      backup({ id: 'b', environment: 'testnet' }),
    ])
    assert.equal(answer.mixed, true)
    // And the estate's own answer is unaffected by the disagreement.
    assert.equal(answer.environment, 'mainnet')
    assert.deepEqual(environmentsSeen([
      backup({ id: 'a', environment: 'testnet' }),
      backup({ id: 'b', environment: 'mainnet' }),
    ]), ['mainnet', 'testnet'])
  })

  it('is not mixed when every run agrees', () => {
    assert.equal(estateEnvironment(estate(), [backup(), backup({ id: 'b' })]).mixed, false)
    assert.equal(estateEnvironment(estate(), []).mixed, false)
  })
})

describe('what has been proved, and what has only been written', () => {
  it('counts a finished, unrestored backup as never verified', () => {
    assert.equal(neverVerified(backup({ state: 'succeeded', verifiedAt: null })), true)
    assert.equal(neverVerified(backup({ verifiedAt: '2026-08-04T13:00:00.000Z' })), false)
  })

  it('does NOT call an unfinished or pruned run unverified', () => {
    // Otherwise every row of a healthy list carries a warning, which is how a warning stops being
    // read at all.
    for (const state of ['queued', 'running', 'failed', 'pruned'] as const) {
      assert.equal(neverVerified(backup({ state, verifiedAt: null })), false, state)
    }
  })

  it('gives the same three-answer shape as the audit chain', () => {
    assert.equal(
      verificationTone({ verifiedAt: '2026-08-04T13:00:00.000Z', state: 'succeeded' }).word,
      'VERIFIED BY RESTORE',
    )
    assert.equal(verificationTone({ verifiedAt: null, state: 'succeeded' }).word, 'NEVER VERIFIED')
    assert.equal(verificationTone({ verifiedAt: null, state: 'queued' }).word, 'NOTHING TO VERIFY')
    // Never colour alone: each answer carries a word and a glyph before it carries a tone.
    for (const state of ['succeeded', 'queued'] as const) {
      const tone = verificationTone({ verifiedAt: null, state })
      assert.ok(tone.word.length > 0 && tone.glyph.length > 0)
    }
  })

  it('counts and headlines the unproven ones', () => {
    const rows = [backup({ id: 'a' }), backup({ id: 'b', verifiedAt: '2026-08-04T13:00:00.000Z' })]
    assert.equal(unverifiedCount(rows), 1)
    assert.match(verificationHeadline(rows) ?? '', /1 of 2/)
  })

  it('says so loudest when NOTHING has ever been proved', () => {
    assert.match(verificationHeadline([backup()]) ?? '', /ever been restored/)
    assert.match(verificationHeadline([backup()]) ?? '', /claims about what would happen/)
  })

  it('says nothing when every finished backup has been proved', () => {
    // The only state that earns silence.
    assert.equal(verificationHeadline([backup({ verifiedAt: '2026-08-04T13:00:00.000Z' })]), null)
  })

  it('leads with "there is no backup" over "nothing is verified"', () => {
    assert.match(verificationHeadline([backup({ state: 'failed' })]) ?? '', /ever completed/)
    assert.match(verificationHeadline([backup({ state: 'failed' })]) ?? '', /nothing to restore from/)
  })

  it('gives every backup and restore state a word', () => {
    for (const state of ['queued', 'running', 'succeeded', 'failed', 'pruned']) {
      assert.ok(backupTone(state).word.length > 0, state)
    }
    for (const state of ['queued', 'running', 'succeeded', 'failed', 'refused']) {
      assert.ok(restoreTone(state).word.length > 0, state)
    }
  })
})

describe('ordering, targets and the custody count', () => {
  it('sorts newest first, and sinks an unreadable timestamp rather than floating it', () => {
    const rows = newestFirst([
      backup({ id: 'old', queuedAt: '2026-08-01T09:00:00.000Z' }),
      backup({ id: 'broken', queuedAt: 'not a date' }),
      backup({ id: 'new', queuedAt: '2026-08-04T09:00:00.000Z' }),
    ])
    assert.deepEqual(rows.map((r) => r.id), ['new', 'old', 'broken'])
  })

  it('offers the artefacts as targets, deduplicated, in the service’s order', () => {
    const names = targetNamesOf([
      artefact({ id: '1', name: 'ledger' }),
      artefact({ id: '2', name: 'identity' }),
      artefact({ id: '3', name: 'ledger' }),
      artefact({ id: '4', name: '' }),
    ])
    assert.deepEqual(names, ['ledger', 'identity'])
  })

  it('counts custody coverage only from runs that SUCCEEDED', () => {
    // A queued run that intends to include the vault has backed nothing up, and rendering it as
    // coverage would be the reassuring reading of a run that may still fail.
    const coverage = custodyCoverage([
      backup({ id: 'a', state: 'queued', includesCustody: true }),
      backup({ id: 'b', state: 'succeeded', includesCustody: false }),
      backup({ id: 'c', state: 'succeeded', includesCustody: true, finishedAt: '2026-08-04T12:04:11.000Z' }),
    ])
    assert.equal(coverage.runs, 1)
    assert.equal(coverage.lastAt, '2026-08-04T12:04:11.000Z')
  })

  it('reports no custody coverage as an absence rather than a zero date', () => {
    const coverage = custodyCoverage([backup({ includesCustody: false })])
    assert.equal(coverage.runs, 0)
    assert.equal(coverage.lastAt, null)
  })
})

describe('the settings form’s own checks, which are courtesy and not enforcement', () => {
  const draft = draftFrom(settings())

  it('accepts what the service sent back', () => {
    assert.deepEqual(settingsProblems(draft), [])
  })

  it('refuses a relative root path, and says why the container’s cwd is not yours', () => {
    const problems = settingsProblems({ ...draft, rootPath: 'backups' })
    assert.equal(problems.length, 1)
    assert.match(problems[0] as string, /absolute/)
  })

  it('refuses an empty root path', () => {
    assert.match(settingsProblems({ ...draft, rootPath: '  ' })[0] ?? '', /empty/)
  })

  it('refuses a retention count that is not a whole number', () => {
    for (const bad of ['', '3.5', '-1', 'seven']) {
      assert.ok(settingsProblems({ ...draft, retentionCopies: bad }).length > 0, bad)
    }
  })

  it('refuses zero copies, and names the destructive reading rather than calling it invalid', () => {
    assert.match(
      settingsProblems({ ...draft, retentionCopies: '0' })[0] ?? '',
      /pruned as soon as the next one succeeds/,
    )
  })

  it('checks the interval only when the schedule is on', () => {
    assert.deepEqual(
      settingsProblems({ ...draft, scheduleEnabled: false, scheduleEveryMinutes: 'later' }),
      [],
    )
    assert.ok(
      settingsProblems({ ...draft, scheduleEnabled: true, scheduleEveryMinutes: 'later' }).length > 0,
    )
  })

  it('renders both ends of every bound the service sent', () => {
    const rows = ceilingRows(ceilings())
    const retention = rows.find((r) => r.key === 'retentionCopies')
    assert.deepEqual(retention, { key: 'retentionCopies', min: '1', max: '365', bytes: false })
    // A byte bound is marked so the caller can show a human size beside the digits. Detected from
    // the VALUE's type — decimal strings are bigints, JSON numbers are counts — rather than from
    // the field's name, which would break the day a bound is called `maxArchiveSize`.
    const bytes = rows.find((r) => r.key === 'ceilingBytes')
    assert.equal(bytes?.bytes, true)
    assert.equal(bytes?.min, '1073741824')
  })

  it('renders a bound the service added that this bundle has never heard of', () => {
    // THE DIRECTION THAT MATTERS. A form rendering only the fields it knew about at build time
    // WITHDRAWS any bound the service has started enforcing, and the operator meets it as a 400
    // with no explanation on screen. `BackupCeilings` carries an index signature so this walk is
    // legitimate without a cast — see the note on it in lib/admin.ts.
    const rows = ceilingRows(ceilings({ maxArchiveCount: { min: 2, max: 9 } }))
    const extra = rows.find((r) => r.key === 'maxArchiveCount')
    assert.deepEqual(extra, { key: 'maxArchiveCount', min: '2', max: '9', bytes: false })
    assert.equal(rows.length, 6, 'the known five plus the unknown one')
  })
})

describe('what a restore records, said without inventing an audit row', () => {
  it('describes the restore ROW, and names the targets the operator chose', () => {
    const lines = restoreRecordLines({ mode: 'live', backup: backup(), targets: ['ledger'] })
    assert.ok(lines.some((l) => l.includes('ledger')))
    assert.ok(lines.some((l) => l.includes('approval')))
  })

  it('says a verify needs no approval, rather than leaving the field unexplained', () => {
    const lines = restoreRecordLines({ mode: 'verify', backup: backup(), targets: ['ledger'] })
    assert.ok(lines.some((l) => /No approval id/.test(l)))
  })
})

/* ══════════════════════════════ what the operator reads ══════════════════════════════ */

/**
 * A signed-in operator, because both screens preview the audit row they will write.
 *
 * `previewBackupRequest` and `previewRequest` name the ACTOR on the row, and they take it from the
 * session — so an operator sees their own name on the record they are about to create. `/auth/me`
 * is stubbed rather than the session faked, for the reason `test/journeys.ts` gives about stubbing
 * the seam and not the mock.
 */
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

const listAt = (): ReactElement =>
  h(MemoryRouter, { initialEntries: ['/backups'] }, h(AuthProvider, null, h(BackupsPage)))

const detailAt = (id = BACKUP_ID): ReactElement =>
  h(
    MemoryRouter,
    { initialEntries: [`/backups/${id}`] },
    h(
      AuthProvider,
      null,
      h(Routes, null, h(Route, { path: 'backups/:id', element: h(BackupPage) })),
    ),
  )

/** The stubbed reads the list page makes. Every scenario supplies its own bodies. */
const listRoutes = (over: {
  backups?: readonly BackupRun[]
  protection?: Protection
  settings?: BackupSettings
  restores?: readonly RestoreRun[]
  estate?: EstateIdentity
}): StubRoutes => ({
  ...ME,
  'GET /v1/backups/settings': {
    body: {
      settings: over.settings ?? settings(),
      ceilings: ceilings(),
      protection: over.protection ?? protection(),
    },
  },
  'GET /v1/backups': {
    body: {
      backups: over.backups ?? [],
      settings: over.settings ?? settings(),
      protection: over.protection ?? protection(),
      estate: over.estate ?? estate(),
    },
  },
  'GET /v1/restores': { body: { restores: over.restores ?? [] } },
})

/**
 * The detail page's three reads.
 *
 * The list is fetched for `estate` — the environment admin-api will check the backup against — and
 * the catalogue for the CLOSED reason-code list `POST /v1/approvals` validates against. Both are
 * stubbed here rather than defaulted inside the page, because a page that invented either would be
 * the thing this suite exists to catch.
 */
const detailRoutes = (over: {
  backup?: BackupRun
  artefacts?: readonly Artefact[]
  restores?: readonly RestoreRun[]
  list?: readonly BackupRun[]
  protection?: Protection
  estate?: EstateIdentity
  phrase?: string
  reasonCodes?: readonly string[]
}): StubRoutes => {
  const one = over.backup ?? backup()
  return {
    ...ME,
    [`GET /v1/backups/${one.id}`]: {
      body: {
        backup: one,
        artefacts: over.artefacts ?? [artefact()],
        restores: over.restores ?? [],
        // The service builds this with `expectedConfirmation` (admin-api/src/backups.ts:561) and
        // compares it with `!==` at execution. The scenarios read it off the PAGE and compare it
        // with what was sent, so a console rendering its own spelling of the timestamp fails.
        liveConfirmationPhrase:
          over.phrase ?? `restore ${one.environment} from ${one.queuedAt.slice(0, 19)}Z`,
      },
    },
    'GET /v1/backups': {
      body: {
        backups: over.list ?? [one],
        settings: settings(),
        protection: over.protection ?? protection(),
        estate: over.estate ?? estate(),
      },
    },
    'GET /v1/actions': {
      body: { actions: [], reasonCodes: over.reasonCodes ?? ['incident', 'migration'] },
    },
  }
}

/** The `<section>` with this accessible name. */
function region(s: Screen, name: string): Element {
  const found = s.allByRole('region').filter((el) => el.getAttribute('aria-label') === name)
  assert.equal(found.length, 1, `expected one region labelled "${name}", found ${found.length}`)
  return found[0] as Element
}

describe('the honesty block', () => {
  it('renders every limit admin-api sent, verbatim', async () => {
    const p = protection()
    await withScreen(
      listAt(),
      { url: `${ORIGIN}/backups`, storage: SIGNED_IN, routes: listRoutes({ backups: [backup()], protection: p }) },
      async (s) => {
        const panel = s.textOf(region(s, 'What this protects against'))
        // Read out of the fixture this scenario supplied, never written as a literal — so the
        // fixture and the assertion cannot agree with each other while both being wrong.
        for (const line of p.doesNotCover) {
          assert.ok(panel.includes(line), `“${line}” is not on the page`)
        }
        for (const line of p.covers) {
          assert.ok(panel.includes(line), `“${line}” is not on the page`)
        }
        assert.ok(panel.includes(p.destinationDevice), 'the destination is not named')
        s.clean('the backups list')
      },
    )
  })

  it('puts what is NOT protected before what is', async () => {
    const p = protection()
    await withScreen(
      listAt(),
      { url: `${ORIGIN}/backups`, storage: SIGNED_IN, routes: listRoutes({ backups: [backup()], protection: p }) },
      async (s) => {
        s.before(
          p.doesNotCover[0] as string,
          p.covers[0] as string,
          'the flattering order leaves the limits to somebody who scrolls',
        )
      },
    )
  })

  it('says a second disk in the same machine is one failure, not safety', async () => {
    await withScreen(
      listAt(),
      {
        url: `${ORIGIN}/backups`,
        storage: SIGNED_IN,
        routes: listRoutes({ backups: [backup()], protection: protection({ sameHost: true }) }),
      },
      async (s) => {
        const panel = s.textOf(region(s, 'What this protects against'))
        assert.match(panel, /second disk in the same machine/)
        assert.match(panel, /theft, fire, flood/)
        // An alert rather than a quiet aside: it is the sentence that decides what to do next.
        const alerts = s.allByRole('alert').map((el) => s.textOf(el))
        assert.ok(
          alerts.some((text) => /second disk in the same machine/.test(text)),
          'the same-host verdict is not raised to an alert',
        )
      },
    )
  })

  it('renders on the EMPTY result too, which is where it matters most', async () => {
    await withScreen(
      listAt(),
      { url: `${ORIGIN}/backups`, storage: SIGNED_IN, routes: listRoutes({ backups: [] }) },
      async (s) => {
        const panel = s.textOf(region(s, 'What this protects against'))
        assert.ok(panel.length > 100, 'the protection panel is missing from the empty state')
        assert.match(s.text(), /There is no backup of this estate/)
      },
    )
  })

  it('says the custody keyring is deliberately absent, and where its real procedure lives', async () => {
    const p = protection()
    await withScreen(
      listAt(),
      { url: `${ORIGIN}/backups`, storage: SIGNED_IN, routes: listRoutes({ backups: [backup()], protection: p }) },
      async (s) => {
        const panel = s.textOf(region(s, 'What this protects against'))
        assert.ok(panel.includes(p.custodyKeyringNote), 'the service’s own note is not rendered')
        assert.match(panel, /deploy\/docs\/custody-backup-restore\.md §4/)
      },
    )
  })

  it('shows that a custody backup EXISTS as a count and a date, and shows nothing else about it', async () => {
    await withScreen(
      listAt(),
      {
        url: `${ORIGIN}/backups`,
        storage: SIGNED_IN,
        routes: listRoutes({
          backups: [backup({ includesCustody: true, state: 'succeeded' })],
        }),
      },
      async (s) => {
        const panel = s.textOf(region(s, 'What this protects against'))
        assert.match(panel, /1 completed run carried it/)
        assert.match(panel, /never shown here/)
        // WHAT THE CLIENT ASKED FOR. Nothing on this page requests an artefact's contents, and
        // there is no route that would serve them — asserted against the requests that were made
        // rather than against the absence of a word in the markup.
        for (const call of s.api.wire) {
          assert.doesNotMatch(call.path, /content|download|raw|file\?/, `${call.path} fetches a file`)
        }
      },
    )
  })
})

describe('a backup nobody has restored', () => {
  it('says NEVER VERIFIED on the row whose verifiedAt was null', async () => {
    await withScreen(
      listAt(),
      {
        url: `${ORIGIN}/backups`,
        storage: SIGNED_IN,
        routes: listRoutes({ backups: [backup({ verifiedAt: null, state: 'succeeded' })] }),
      },
      async (s) => {
        assert.match(s.text(), /NEVER VERIFIED/)
        // And an alert saying so, above the table it summarises.
        s.before('never been restored', 'Runs', 'the headline must precede what it summarises')
      },
    )
  })

  it('says VERIFIED BY RESTORE when the same field carries a time', async () => {
    // The other direction, so the assertion above cannot pass by rendering one word always.
    await withScreen(
      listAt(),
      {
        url: `${ORIGIN}/backups`,
        storage: SIGNED_IN,
        routes: listRoutes({ backups: [backup({ verifiedAt: '2026-08-04T13:00:00.000Z' })] }),
      },
      async (s) => {
        assert.match(s.text(), /VERIFIED BY RESTORE/)
        assert.doesNotMatch(s.text(), /NEVER VERIFIED/)
      },
    )
  })

  it('renders an absent size as an absence, never as 0 B', async () => {
    await withScreen(
      listAt(),
      { url: `${ORIGIN}/backups`, storage: SIGNED_IN, routes: listRoutes({ backups: [backup({ totalBytes: null })] }) },
      async (s) => {
        assert.doesNotMatch(s.text(), /0 B\b/)
        assert.match(s.text(), /not measured/)
      },
    )
  })

  it('renders a size past 2^53 exactly', async () => {
    await withScreen(
      listAt(),
      {
        url: `${ORIGIN}/backups`,
        storage: SIGNED_IN,
        routes: listRoutes({ backups: [backup({ totalBytes: '9007199254740993' })] }),
      },
      async (s) => {
        assert.match(s.text(), /8\.00 PiB/)
      },
    )
  })

  it('tells the operator that nothing in this estate has ever been restored', async () => {
    await withScreen(
      listAt(),
      { url: `${ORIGIN}/backups`, storage: SIGNED_IN, routes: listRoutes({ backups: [backup()], restores: [] }) },
      async (s) => {
        assert.match(s.textOf(region(s, 'Restores')), /Nothing has ever been restored here/)
      },
    )
  })
})

describe('the two environments, before the action', () => {
  it('shows the backup’s and the estate’s side by side', async () => {
    await withScreen(
      detailAt(),
      { url: `${ORIGIN}/backups/${BACKUP_ID}`, storage: SIGNED_IN, routes: detailRoutes({}) },
      async (s) => {
        const envs = s.textOf(region(s, 'Which estate, and which backup'))
        assert.match(envs, /These artefacts were taken from/)
        assert.match(envs, /This estate reads as/)
        assert.match(envs, /mainnet/)
        s.clean('the backup detail')
      },
    )
  })

  it('names the disagreement when the two differ, and offers no live restore', async () => {
    // admin-api says this estate is testnet; the backup on screen is mainnet. That is the
    // "artefacts copied in from elsewhere" case, and it is the refusal an operator is most likely
    // to walk into.
    await withScreen(
      detailAt(),
      {
        url: `${ORIGIN}/backups/${BACKUP_ID}`,
        storage: SIGNED_IN,
        routes: detailRoutes({
          backup: backup({ environment: 'mainnet' }),
          estate: estate({ environment: 'testnet' }),
        }),
      },
      async (s) => {
        assert.match(s.text(), /These are not the same environment/)
        assert.match(s.textOf(region(s, 'Live restore')), /No live restore is available here/)
        // The safe half is still there: a verify touches nothing live.
        assert.ok(s.queryByRole('button', 'What will this do?'), 'the verify restore vanished too')
      },
    )
  })
})

describe('the live restore — which raises a request rather than restoring', () => {
  /** Walk the live-restore form to the point where the typed phrase is the only thing left. */
  async function arm(s: Screen): Promise<{ phrase: string; button: Element }> {
    await s.type(s.byRole('combobox', 'Reason code'), 'incident')
    await s.type(s.byRole('textbox', 'Why does this estate need restoring?'), 'the host was lost')
    const button = s.byRole('button', 'Ask two operators to restore mainnet')
    // The phrase the OPERATOR was shown, scraped out of the rendered page rather than written
    // here. The wire assertion below compares what was sent against this, so the two cannot agree
    // with each other while both being wrong — the trap doc 22 records about a test that compared
    // a URL with a copy of itself and could therefore never fail.
    //
    // Read from the visible text and not from the input, because an `<input>` has no text content:
    // the phrase lives in its label, which is what the operator reads. The timestamp is matched by
    // SHAPE rather than with `\S+`, because the phrase's `<code>` and the hint after it have no
    // whitespace between them and `textContent` runs the two together.
    const body = s.text()
    const at = body.indexOf('To confirm, type')
    assert.ok(at >= 0, 'no confirmation field was offered at all')
    const found = /restore \S+ from \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.exec(body.slice(at))
    assert.ok(found, `no phrase was offered; the field reads ${JSON.stringify(body.slice(at, at + 120))}`)
    return { phrase: found[0], button }
  }

  it('says plainly that nothing is restored by sending it', async () => {
    // The single most important sentence on the section. An operator who believes they have just
    // restored the estate, and has not, will not chase the second signature.
    await withScreen(
      detailAt(),
      { url: `${ORIGIN}/backups/${BACKUP_ID}`, storage: SIGNED_IN, routes: detailRoutes({}) },
      async (s) => {
        const setup = s.textOf(region(s, 'Live restore setup'))
        assert.match(setup, /Nothing happens when you send it/)
        assert.match(setup, /a second operator — not you — decides it/)
      },
    )
  })

  it('shows the phrase the SERVICE sent, not one the console composed', async () => {
    // A phrase this console rendered from its own spelling of the timestamp would be refused by
    // `requestRestore`'s `!==` at execution — after two operators had signed for it. The scenario
    // supplies a phrase that no local builder would produce, so a console that ignored the served
    // value fails here rather than in production.
    const served = 'restore mainnet from 1999-12-31T23:59:59Z'
    await withScreen(
      detailAt(),
      { url: `${ORIGIN}/backups/${BACKUP_ID}`, storage: SIGNED_IN, routes: detailRoutes({ phrase: served }) },
      async (s) => {
        // The confirmation field appears once the request is otherwise complete, so the reason code
        // comes first — which is the order an operator fills the form in anyway.
        await s.type(s.byRole('combobox', 'Reason code'), 'incident')
        assert.ok(s.text().includes(served), 'the served confirmation phrase is not on the page')
        // And the phrase this bundle would have composed is NOT what is shown. Without that half,
        // a console that ignored the served value would still pass whenever the two agree — which
        // is every time except the one that matters.
        assert.ok(
          !s.text().includes('restore mainnet from 2026-08-04T12:00:00Z'),
          'the console rendered its own phrase over the one the service will compare',
        )
      },
    )
  })

  it('offers the reason codes the catalogue served, and no others', async () => {
    await withScreen(
      detailAt(),
      {
        url: `${ORIGIN}/backups/${BACKUP_ID}`,
        storage: SIGNED_IN,
        routes: detailRoutes({ reasonCodes: ['incident', 'migration', 'audit'] }),
      },
      async (s) => {
        const options = [...s.byRole('combobox', 'Reason code').querySelectorAll('option')]
          .map((o) => o.getAttribute('value'))
          .filter((v) => v !== '')
        // Read out of the fixture this scenario supplied. A hard-coded list in the page would be a
        // second copy of something admin-api owns, and the copy is the one that goes stale.
        assert.deepEqual(options, ['incident', 'migration', 'audit'])
      },
    )
  })

  it('keeps the reason-code selector on screen while it is empty, rather than hiding the box', async () => {
    await withScreen(
      detailAt(),
      { url: `${ORIGIN}/backups/${BACKUP_ID}`, storage: SIGNED_IN, routes: detailRoutes({}) },
      async (s) => {
        assert.ok(
          s.queryByRole('combobox', 'Reason code'),
          'the form removed the box the operator was about to fill in',
        )
      },
    )
  })

  it('will not send until the phrase is written out, and says so beside the control', async () => {
    await withScreen(
      detailAt(),
      { url: `${ORIGIN}/backups/${BACKUP_ID}`, storage: SIGNED_IN, routes: detailRoutes({}) },
      async (s) => {
        const { phrase, button } = await arm(s)
        assert.equal((button as unknown as { disabled: boolean }).disabled, true)

        await s.type(s.byRole('textbox', 'To confirm, type'), 'restore mainnet')
        assert.equal(
          (s.byRole('button', 'Ask two operators to restore mainnet') as unknown as {
            disabled: boolean
          }).disabled,
          true,
          'a partial phrase armed the control',
        )

        await s.type(s.byRole('textbox', 'To confirm, type'), phrase)
        assert.equal(
          (s.byRole('button', 'Ask two operators to restore mainnet') as unknown as {
            disabled: boolean
          }).disabled,
          false,
          'the correct phrase did not arm the control',
        )
      },
    )
  })

  it('raises an approval carrying the phrase it showed, against the backup on screen', async () => {
    await withScreen(
      detailAt(),
      {
        url: `${ORIGIN}/backups/${BACKUP_ID}`,
        storage: SIGNED_IN,
        routes: {
          ...detailRoutes({}),
          'POST /v1/approvals': { status: 201, body: { approval: { id: APPROVAL_ID } } },
        },
      },
      async (s) => {
        const { phrase } = await arm(s)
        await s.type(s.byRole('textbox', 'To confirm, type'), phrase)
        await s.click(s.byRole('button', 'Ask two operators to restore mainnet'))
        await s.settle(20)

        // NOTHING went to the restore route. That is the client-side fact this scenario exists for:
        // `POST /v1/restores` answers 400 for a live restore, so a console that posted there would
        // walk an operator through the whole ritual to reach an error message.
        assert.equal(s.api.matching('POST /v1/restores').length, 0)

        const sent = s.api.matching('POST /v1/approvals')
        assert.equal(sent.length, 1, 'the request did not leave the browser exactly once')
        const body = sent[0]?.json as Record<string, unknown>
        assert.equal(body['action'], 'estate.restore')
        // The SUBJECT is the backup that was on screen. Getting this wrong would have two operators
        // authorise a restore of a different backup than the one they were shown.
        assert.equal(body['subjectId'], BACKUP_ID)
        assert.equal(body['reasonCode'], 'incident')
        const params = body['params'] as Record<string, unknown>
        // What was displayed is what was sent.
        assert.equal(params['confirmation'], phrase)
        assert.deepEqual(params['targets'], [artefact().name])
        assert.ok(
          (sent[0]?.headers?.['idempotency-key'] ?? '').length >= 8,
          'the request carried no usable Idempotency-Key',
        )
      },
    )
  })

  it('tells the operator nothing has been restored, and where the request went', async () => {
    await withScreen(
      detailAt(),
      {
        url: `${ORIGIN}/backups/${BACKUP_ID}`,
        storage: SIGNED_IN,
        routes: {
          ...detailRoutes({}),
          'POST /v1/approvals': { status: 201, body: { approval: { id: APPROVAL_ID } } },
        },
      },
      async (s) => {
        const { phrase } = await arm(s)
        await s.type(s.byRole('textbox', 'To confirm, type'), phrase)
        await s.click(s.byRole('button', 'Ask two operators to restore mainnet'))
        await s.settle(20)

        assert.match(s.text(), /Nothing has been restored/)
        // And the address to send the second operator, which is the whole point of a queue.
        const link = s.queryByRole('link', APPROVAL_ID.slice(0, 8))
        assert.ok(link, 'the raised request is not followable')
        assert.equal(link.getAttribute('href'), `/approvals/${APPROVAL_ID}`)
      },
    )
  })
})

describe('the verify restore', () => {
  it('is a separate control, and sends neither a confirmation nor an approval', async () => {
    // The two modes are not two settings of one control. A mode toggle is something an operator
    // can change with one keystroke and no reading, and the difference between these two is a
    // throwaway database and the money data.
    await withScreen(
      detailAt(),
      {
        url: `${ORIGIN}/backups/${BACKUP_ID}`,
        storage: SIGNED_IN,
        routes: {
          ...detailRoutes({}),
          'POST /v1/restores': { status: 201, body: { restore: restore() } },
        },
      },
      async (s) => {
        await s.type(s.byRole('textbox', 'Why are you verifying this one?'), 'quarterly drill')
        await s.click(s.byRole('button', 'What will this do?'))
        await s.click(s.byRole('button', 'Run a verify restore'))
        await s.settle(20)

        const sent = s.api.matching('POST /v1/restores')
        assert.equal(sent.length, 1)
        const body = sent[0]?.json as Record<string, unknown>
        assert.equal(body['mode'], 'verify')
        // The contract says neither field applies to this mode; sending them empty would be this
        // client asserting they do.
        assert.equal(body['confirmation'], undefined)
        assert.equal(body['approvalId'], undefined)
        // The targets are the backup's own artefacts, not a vocabulary this console invented.
        assert.deepEqual(body['targets'], [artefact().name])
      },
    )
  })

  it('says plainly that nothing live is touched, before it is run', async () => {
    await withScreen(
      detailAt(),
      { url: `${ORIGIN}/backups/${BACKUP_ID}`, storage: SIGNED_IN, routes: detailRoutes({}) },
      async (s) => {
        await s.click(s.byRole('button', 'What will this do?'))
        const text = s.text()
        assert.match(text, /throwaway scratch database/)
        assert.match(text, /No live database, vault or file is written/)
      },
    )
  })

  it('offers nothing to restore from a pruned run, and says the files are gone', async () => {
    await withScreen(
      detailAt(),
      {
        url: `${ORIGIN}/backups/${BACKUP_ID}`,
        storage: SIGNED_IN,
        routes: detailRoutes({ backup: backup({ state: 'pruned' }) }),
      },
      async (s) => {
        assert.match(s.textOf(region(s, 'Verify restore')), /pruned/)
        assert.match(s.textOf(region(s, 'Live restore')), /pruned/)
        assert.equal(
          s.queryByRole('button', 'Run a verify restore'),
          null,
          'a pruned run still offered a restore control',
        )
      },
    )
  })
})

/* ══════════════════════════════ one press is one write ══════════════════════════════ */

/**
 * Two events in one tick, on both of this screen's writes.
 *
 * Doc 22 §3 forbids a browser scenario from asserting a business rule, and collapsing duplicates
 * IS a service's rule. HOW MANY TIMES A BROWSER SENDS is not: it is the one thing about a
 * duplicate that is squarely the client's own.
 *
 * It also costs more here than anywhere else in this console. A second live restore is a second
 * overwrite of the money data — and the two attempts present the SAME `Idempotency-Key`, so
 * admin-api's wrapper collapses them, which is exactly why the client must not lean on it: the
 * half that is already right is not a licence to send the second request.
 *
 * Both modes run under `<StrictMode>` as well as plain, because `src/main.tsx:29` renders under it
 * and a ref latch is created twice on a StrictMode mount — a guard proven only in the plain mode
 * has never been run the way the app runs it.
 */
for (const strict of [false, true]) {
  const mode = strict ? 'under StrictMode' : 'plain'

  describe(`one press is one write — ${mode}`, () => {
    it(`a live-restore request sends one POST, not two (${mode})`, async () => {
      await withScreen(
        detailAt(),
        {
          url: `${ORIGIN}/backups/${BACKUP_ID}`,
          strict,
          storage: SIGNED_IN,
          routes: {
            ...detailRoutes({}),
            'POST /v1/approvals': (_w, n) => ({
              status: n === 1 ? 201 : 200,
              body: { approval: { id: APPROVAL_ID } },
              delayMs: 30,
            }),
          },
        },
        async (s) => {
          await s.type(s.byRole('combobox', 'Reason code'), 'incident')
          await s.type(
            s.byRole('textbox', 'Why does this estate need restoring?'),
            'the host was lost',
          )
          await s.type(
            s.byRole('textbox', 'To confirm, type'),
            'restore mainnet from 2026-08-04T12:00:00Z',
          )
          const button = s.byRole('button', 'Ask two operators to restore mainnet')
          s.clickNoFlush(button)
          s.clickNoFlush(button)
          await s.settle(90)

          const sent = s.api.matching('POST /v1/approvals')
          assert.equal(
            sent.length,
            1,
            `a restore request left the browser ${sent.length} times for ONE double click. A guard ` +
              `read from component state cannot see the second event in the same tick — take the ` +
              `latch in a ref before the first await. The second request is a second pending ` +
              `authorisation to overwrite the money data, and a second operator could approve ` +
              `either of them.`,
          )
        },
      )
    })

    it(`taking a backup sends one POST, not two (${mode})`, async () => {
      await withScreen(
        listAt(),
        {
          url: `${ORIGIN}/backups`,
          strict,
          storage: SIGNED_IN,
          routes: {
            ...listRoutes({ backups: [backup()] }),
            'POST /v1/backups': (_w, n) => ({
              status: n === 1 ? 201 : 200,
              body: { backup: backup({ id: 'new', state: 'queued' }) },
              delayMs: 30,
            }),
          },
        },
        async (s) => {
          await s.type(s.byRole('textbox', 'Why are you taking this one?'), 'before the migration')
          // `ReversibleAction`'s first press only explains it; the second is the real control.
          await s.click(s.byRole('button', 'What will this do?'))
          const button = s.byRole('button', 'Take a full backup')
          s.clickNoFlush(button)
          s.clickNoFlush(button)
          await s.settle(90)

          const sent = s.api.matching('POST /v1/backups')
          assert.equal(
            sent.length,
            1,
            `a backup left the browser ${sent.length} times for ONE double click.`,
          )
          assert.ok(
            (sent[0]?.headers?.['idempotency-key'] ?? '').length >= 8,
            'the backup carried no usable Idempotency-Key, which is what makes a genuine RETRY safe',
          )
        },
      )
    })
  })
}

/**
 * Backups: what exists, what has ever been proved, and what none of it protects against.
 *
 * `GET /v1/backups` — **admin-api/src/server.ts:1332**. `POST /v1/backups` — **server.ts:1473**.
 * `GET /v1/restores` — **server.ts:1520**. `GET`/`PUT /v1/backups/settings` — **server.ts:1359,
 * 1387**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE TWO THINGS THIS SCREEN HAS TO GET RIGHT.
 *
 * **1. A backup nobody has restored is a wish.** `state: 'succeeded'` means the files were
 * written. It says nothing about whether they read back — and every incident report about a
 * failed restore begins with somebody who had a list of green rows. So "never verified" is a
 * column, a headline and a word, not the absence of a tick: `verificationTone` gives it the same
 * three-answer shape `chainTone` gives the audit chain, for the same reason.
 *
 * **2. The reassuring facts are all true and add up to the wrong conclusion.** Sizes, checksums
 * and green states are every fact on this page except the one that matters, which is that the
 * destination is a second disk in the same machine. `ProtectionPanel` is rendered on the empty
 * state as well as the populated one, and above the table rather than below it, for the reason
 * `support.tsx` renders its coverage panel on an empty result: the caveat is worth least exactly
 * where it is easiest to leave out.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The dangerous half is not here. Restoring is on `/backups/:id`, where the operator can see WHICH
 * backup, its artefacts and its restore history — and where the address itself is what gets pasted
 * to the second operator who has to approve a live one.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BACKUP_KINDS,
  loadBackups,
  loadRestores,
  startBackup,
  type BackupKind,
  type BackupRun,
  type BackupsPage as BackupsResponse,
  type RestoreRun,
} from '../lib/admin.ts'
import {
  custodyCoverage,
  environmentsSeen,
  estateEnvironment,
  neverVerified,
  newestFirst,
  restoresNewestFirst,
  verificationHeadline,
} from '../lib/backups.ts'
import {
  asOfLabel,
  backupTone,
  exactBytes,
  formatBytes,
  relative,
  restoreTone,
  shortHash,
  shortId,
  timestamp,
  verificationTone,
} from '../lib/format.ts'
import { idempotencyKeyFor, previewBackupRequest } from '../lib/gate.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { useSession } from '../lib/auth.tsx'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { AsOf, StatusWord } from '../components/tone.tsx'
import { ReversibleAction } from '../components/irreversible.tsx'
import { ProtectionPanel } from '../components/protection.tsx'
import { BackupSettingsPanel } from '../components/backup-settings.tsx'

/** How far back to read. A real query parameter, so it is a real dependency of the question. */
const LIMITS: readonly number[] = [20, 50, 200]

export function BackupsPage() {
  const [limit, setLimit] = useState<number>(LIMITS[1] as number)
  const [readAt, setReadAt] = useState<Date | null>(null)

  const load = useCallback(
    async (signal: AbortSignal) => {
      const page = await loadBackups({ limit }, { signal })
      setReadAt(new Date())
      return page
    },
    [limit],
  )

  const backups = useResource<BackupsResponse>(
    load,
    (page) => page.backups.length,
    'The backups could not be read.',
    // The limit is part of the question. Without it here the console would show the previous
    // answer under the new limit — twenty rows with "last 200" selected above them, and nothing on
    // screen to say why.
    [limit],
  )
  const now = new Date()

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">Backups</h1>
        <p className="aw-page-lede">
          What exists on disk, what a restore has ever proved, and what none of it protects
          against. A backup that has never been restored is a claim about the future — this screen
          says which ones are still claims.
        </p>
      </header>

      <div className="aw-toolbar">
        <label className="aw-field aw-field--inline">
          <span className="aw-field__label">Show</span>
          <select
            className="aw-field__input"
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {LIMITS.map((n) => (
              <option key={n} value={String(n)}>
                the last {n} runs
              </option>
            ))}
          </select>
        </label>
        {readAt !== null && <AsOf label={asOfLabel(readAt, now)} />}
        <button type="button" className="cf-btn cf-btn--quiet" onClick={backups.reload}>
          Read again
        </button>
      </div>

      {backups.state === 'loading' && <Loading label="Reading the backups" />}
      {backups.state === 'forbidden' && <Forbidden notice={backups.error ?? undefined} />}
      {backups.state === 'failed' && backups.error !== null && (
        <Failed
          notice={backups.error}
          onRetry={backups.reload}
          title="The backups did not load"
        />
      )}

      {/*
        `data` rather than `state === 'ok'`: an estate with no backups still has a destination and
        still has a protection statement, and that is the case where an operator most needs to read
        it. A 200 holding an empty list is an answer, not an absence of one.
      */}
      {backups.data !== null && (
        <BackupsBody page={backups.data} now={now} onDone={backups.reload} />
      )}

      <RecentRestores />
      <BackupSettingsPanel />
    </>
  )
}

function BackupsBody({
  page,
  now,
  onDone,
}: {
  page: BackupsResponse
  now: Date
  onDone: () => void
}) {
  const rows = newestFirst(page.backups)
  // Read from `page.estate`, which admin-api serves from the `estate_identity` row — the same row
  // `requestRestore` compares a backup against. This screen used to derive it from the runs; that
  // derivation was right and is gone, because a second opinion beside the enforcing service is the
  // copy that goes stale.
  const estate = estateEnvironment(page.estate, page.backups)
  const headline = verificationHeadline(page.backups)

  return (
    <>
      {/*
        The unflattering summary, above everything it summarises. `role="alert"` because it is the
        one line on this page that changes what the operator should do next.
      */}
      {headline !== null && (
        <p className="aw-note aw-note--warn" role="alert">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          {headline}
        </p>
      )}

      {/*
        A DIFFERENT alarm from the one above, and independent of it: `estate.environment` describes
        this estate, and this describes the DIRECTORY. Runs naming two environments means either the
        root path is shared between two estates or artefacts were copied in from elsewhere, and
        neither is something the estate_identity row can tell you.
      */}
      {estate.mixed && (
        <p className="aw-note aw-note--crit" role="alert">
          <span className="aw-note__icon" aria-hidden="true">
            ■
          </span>
          These runs name more than one environment ({environmentsSeen(page.backups).join(', ')}).
          Either this root path is shared between two estates or artefacts were copied in from
          elsewhere — check which before restoring anything.
        </p>
      )}

      <ProtectionPanel protection={page.protection} custody={custodyCoverage(page.backups)} />

      <TakeBackup
        settingsRetention={page.settings.retentionCopies}
        environment={estate.environment}
        onDone={onDone}
      />

      {rows.length === 0 ? (
        <Empty
          title="There is no backup of this estate"
          hint="Nothing on disk to restore from, and nothing for a verify restore to prove. Take one above — then restore it into a scratch database, because a backup nobody has restored has not been shown to work."
        />
      ) : (
        <section className="aw-panel" aria-label="Backup runs">
          <h2 className="aw-panel__title">Runs</h2>
          <p className="aw-panel__lede">
            This estate reads as <strong>{estate.environment ?? 'unestablished'}</strong> —{' '}
            {estate.basis}
          </p>
          <table className="aw-table">
            <caption className="aw-table__caption">
              {rows.length} run{rows.length === 1 ? '' : 's'}, newest first. Sizes are exact byte
              counts, formatted without going through a floating-point number.
            </caption>
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Taken</th>
                <th scope="col">State</th>
                <th scope="col">Size</th>
                <th scope="col">Files</th>
                <th scope="col">Manifest</th>
                <th scope="col">Proved by a restore?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((backup) => (
                <BackupRow key={backup.id} backup={backup} now={now} />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function BackupRow({ backup, now }: { backup: BackupRun; now: Date }) {
  const size = formatBytes(backup.totalBytes)
  const taken = new Date(backup.queuedAt)
  const readableDate = !Number.isNaN(taken.getTime())

  return (
    <tr>
      <th scope="row">
        <Link className="aw-link cf-num" to={`/backups/${backup.id}`}>
          {shortId(backup.id)}
        </Link>
        <span className="aw-row-sub">
          {backup.kind} · {backup.environment}
        </span>
      </th>
      <td>
        {/* Relative for "is this recent", absolute beside it because the browser's clock may be
            wrong — the same pairing the approval queue uses on a deadline. */}
        <span>{readableDate ? relative(taken, now) : 'unreadable timestamp'}</span>
        <span className="aw-row-sub cf-num">{timestamp(backup.queuedAt)}</span>
      </td>
      <td>
        <StatusWord tone={backupTone(backup.state)} />
        {backup.error !== null && <span className="aw-row-sub">{backup.error}</span>}
      </td>
      <td>
        {/* Missing is missing. A run that reported no size renders as that rather than as 0 B —
            `BigInt('')` is `0n`, and "0 B" is exactly the reading an absent size must not produce. */}
        {size === null ? (
          <span className="aw-absent__word">not measured</span>
        ) : (
          <span className="cf-num" title={exactBytes(backup.totalBytes) ?? undefined}>
            {size}
          </span>
        )}
      </td>
      <td className="cf-num">
        {backup.artefactCount === null ? (
          <span className="aw-absent__word">not counted</span>
        ) : (
          backup.artefactCount
        )}
      </td>
      <td>
        <span className="cf-num" title={backup.manifestSha256 ?? undefined}>
          {shortHash(backup.manifestSha256)}
        </span>
      </td>
      <td>
        <StatusWord
          tone={verificationTone({ verifiedAt: backup.verifiedAt, state: backup.state })}
        />
        {/* The word above is the fact. This line is what an operator does about it. */}
        {neverVerified(backup) && (
          <span className="aw-row-sub">
            <Link className="aw-link" to={`/backups/${backup.id}`}>
              verify it
            </Link>{' '}
            — restores into a scratch database and drops it
          </span>
        )}
        {backup.verifiedAt !== null && (
          <span className="aw-row-sub cf-num">{timestamp(backup.verifiedAt)}</span>
        )}
      </td>
    </tr>
  )
}

/**
 * Take a backup now.
 *
 * A `ReversibleAction` rather than the typed-phrase gate: taking a backup does not destroy
 * anything and can be undone by ignoring it. It still says what it will do first — an operator
 * should never learn what a button did by watching it happen — and it names the one part that IS a
 * deletion, which is retention pruning the oldest copy.
 *
 * ── Why the key is re-minted after a SUCCESS and not after a failure ──────────────────────────
 *
 * `idempotencyKeyFor` is per page view everywhere else in this console, because everywhere else
 * the action is decided once: a second decision on a decided approval is a mistake, and replaying
 * the first response is the right answer to it. A backup is not like that. Taking two in a row is
 * legitimate — before and after a migration, say — and a key frozen for the life of the page would
 * silently replay the first one's response and take no second backup.
 *
 * So the attempt number is part of the subject, and it advances only when a run actually came
 * back. A retry after a LOST response therefore presents the same key and replays, which is the
 * whole purpose of the header; a deliberate second backup presents a new one.
 */
function TakeBackup({
  settingsRetention,
  environment,
  onDone,
}: {
  settingsRetention: number
  environment: string | null
  onDone: () => void
}) {
  const { operator } = useSession()
  const [kind, setKind] = useState<BackupKind>('full')
  const [reason, setReason] = useState('')
  const [attempt, setAttempt] = useState(0)
  const mintedAt = useMemo(() => Date.now(), [])

  const take = useMutation<[], { backup: BackupRun }>(
    async () =>
      startBackup(
        { kind, reason: reason.trim() },
        idempotencyKeyFor('backup', `${kind}-${attempt}`, mintedAt),
      ),
    'The backup could not be started.',
  )

  const run = async () => {
    const result = await take.run()
    if (result !== null) {
      setAttempt((n) => n + 1)
      onDone()
    }
  }

  return (
    <ReversibleAction
      label="Take a backup now"
      summary="Runs a backup immediately, in addition to whatever the schedule does."
      consequences={[
        `Writes a new ${kind} run to the destination above — which is the destination whose limits are stated above, and those limits do not change because a run is manual.`,
        `The settings keep ${settingsRetention} cop${settingsRetention === 1 ? 'y' : 'ies'}. Once there are more, older runs reach the state "pruned" and their files are no longer on disk to restore from.`,
        'It does NOT prove anything reads back. Only a restore does that, and this console offers a verify restore on each run’s own page.',
        'The custody keyring is not included, here or in any other run. Its procedure is physical and off-site.',
      ]}
      previews={[previewBackupRequest({ actor: operator.principal, kind, environment })]}
      runLabel={`Take a ${kind} backup`}
      busy={take.busy}
      disabledReason={
        reason.trim().length === 0
          ? 'Say why you are taking this one — it is stored on the run and is what anyone reading the estate’s history later will have.'
          : null
      }
      onRun={() => void run()}
    >
      <label className="aw-field aw-field--inline">
        <span className="aw-field__label">What to back up</span>
        <select
          className="aw-field__input"
          value={kind}
          onChange={(e) => setKind(e.target.value as BackupKind)}
        >
          {BACKUP_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label className="aw-field">
        <span className="aw-field__label">Why are you taking this one?</span>
        <span className="aw-field__hint">
          Stored on the run. “before the ledger migration” is worth more in six months than a
          timestamp is.
        </span>
        <textarea
          className="aw-field__input"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {take.error !== null && (
        <Failed notice={take.error} title="The backup did not start" />
      )}
      {take.result !== null && (
        <p className="aw-note aw-note--good" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            ●
          </span>
          Run <code className="cf-num">{shortId(take.result.backup.id)}</code> is{' '}
          {take.result.backup.state}. It is not a backup you can rely on until a restore has read it
          back.
        </p>
      )}
    </ReversibleAction>
  )
}

/**
 * Every restore ever attempted, across all backups.
 *
 * Its own read rather than a column on the table above, because the question it answers is the
 * other way round: not "was this backup proved" but "has this estate ever restored anything at
 * all". An estate whose restore list is empty has a disaster-recovery procedure nobody has run,
 * and that is invisible from a list of backups however green it is.
 */
function RecentRestores() {
  const [readAt, setReadAt] = useState<Date | null>(null)
  const load = useCallback(async (signal: AbortSignal) => {
    const result = await loadRestores({ limit: 20 }, { signal })
    setReadAt(new Date())
    return result.restores
  }, [])
  const restores = useResource<readonly RestoreRun[]>(
    load,
    (rows) => rows.length,
    'The restore history could not be read.',
  )
  const now = new Date()

  return (
    <section className="aw-panel" aria-label="Restores">
      <h2 className="aw-panel__title">Restores</h2>
      <p className="aw-panel__lede">
        The only evidence in this estate that any backup has ever read back.
      </p>

      {restores.state === 'loading' && <Loading label="Reading the restore history" />}
      {restores.state === 'forbidden' && <Forbidden notice={restores.error ?? undefined} />}
      {restores.state === 'failed' && restores.error !== null && (
        <Failed
          notice={restores.error}
          onRetry={restores.reload}
          title="The restore history did not load"
        />
      )}
      {restores.state === 'empty' && (
        <Empty
          title="Nothing has ever been restored here"
          hint="Every backup on this page is untested. A verify restore reads one back into a throwaway database and drops it — nothing live is touched, and it is the only thing that turns a backup into a fact."
        />
      )}

      {restores.state === 'ok' && restores.data !== null && (
        <>
          {readAt !== null && <AsOf label={asOfLabel(readAt, now)} />}
          <table className="aw-table">
            <caption className="aw-table__caption">
              {restores.data.length} restore{restores.data.length === 1 ? '' : 's'}, newest first.
            </caption>
            <thead>
              <tr>
                <th scope="col">Restore</th>
                <th scope="col">Mode</th>
                <th scope="col">From</th>
                <th scope="col">State</th>
                <th scope="col">Checksums</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {restoresNewestFirst(restores.data).map((restore) => (
                <tr key={restore.id}>
                  <th scope="row" className="cf-num">
                    {shortId(restore.id)}
                    <span className="aw-row-sub">{restore.targets.join(', ') || 'no targets'}</span>
                  </th>
                  <td>
                    {/* A word, and the two words mean entirely different things. */}
                    <strong className={restore.mode === 'live' ? 'aw-you' : ''}>
                      {restore.mode === 'live' ? 'LIVE' : 'verify'}
                    </strong>
                  </td>
                  <td>
                    <Link className="aw-link cf-num" to={`/backups/${restore.backupRunId}`}>
                      {shortId(restore.backupRunId)}
                    </Link>
                    <span className="aw-row-sub cf-num">
                      {restore.artefactEnvironment ?? 'environment not recorded'}
                    </span>
                  </td>
                  <td>
                    <StatusWord tone={restoreTone(restore.state)} />
                    {restore.error !== null && <span className="aw-row-sub">{restore.error}</span>}
                  </td>
                  <td>
                    {/* Three answers, not two: null is "the run did not say", which is not the
                        same as "they did not match" and must never render as it. */}
                    {restore.checksumsVerified === null ? (
                      <span className="aw-absent__word">not reported</span>
                    ) : (
                      <span className={restore.checksumsVerified ? 'aw-on' : 'aw-off'}>
                        {restore.checksumsVerified ? 'MATCHED' : 'DID NOT MATCH'}
                      </span>
                    )}
                  </td>
                  <td className="cf-num">{timestamp(restore.queuedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

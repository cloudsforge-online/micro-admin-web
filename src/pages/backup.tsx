/**
 * One backup run — what is in it, what it has ever proved, and the two ways to restore it.
 *
 * `GET /v1/backups/:id` — **admin-api/src/server.ts**. `GET /v1/backups` — **server.ts**,
 * for the estate's own environment. `GET /v1/actions` — **server.ts**, for the closed reason-code
 * list. `POST /v1/restores` — **server.ts**, verify only. `POST /v1/approvals` —
 * **server.ts**, which is the only door to a live restore.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIVE THINGS THIS SCREEN HAS TO GET RIGHT.
 *
 * **1. Verify and live are not two settings of one control — and the SERVICE agrees.** A verify
 * restore reads the artefacts into a throwaway scratch database, proves they read back, and drops
 * it: nothing live is touched, and `POST /v1/restores` takes it with one operator. That same route
 * **refuses `mode: "live"` outright** (server.ts), answering 400 with the route to use
 * instead. So the two halves of this screen are not two shapes of one form; they are two different
 * routes, and the console could not merge them if it wanted to.
 *
 * **2. A live restore is a REQUEST, not an action.** The dangerous half raises an `estate.restore`
 * approval — two operators, and `approvals.ts`'s executor creates the restore itself with the
 * approval id on it. The typed confirmation phrase becomes `params.confirmation` on that request,
 * which means the operator who raises it types the phrase and the SECOND operator sees the exact
 * string they are signing for before they decide. That is strictly better than a phrase typed into
 * a form only one person ever saw.
 *
 * **3. The two environments are side by side, above the action.** admin-api compares the
 * environment stamped inside the artefacts against the estate it is running in and refuses the
 * pair. A console that let an operator type "restore mainnet from …" for testnet artefacts and
 * then showed them a 4xx has spent their attention on a ritual that could never have worked; worse,
 * it has walked them through the ceremony that means "I have read this and I mean it".
 *
 * **4. The phrase is the service's, and is now literally served.** `GET /v1/backups/:id` returns
 * `liveConfirmationPhrase` (server.ts), built by the same `expectedConfirmation` that
 * `requestRestore` compares with `!==` (backups.ts). The screen renders THAT, so the string an
 * operator types cannot diverge from the string that will be checked.
 * `restoreConfirmationPhrase` in lib/gate.ts remains only as the fallback for a response without
 * it, and when neither yields a phrase the action is not offered at all rather than offered with a
 * guess.
 *
 * **5. Nothing here renders key material.** The artefact table carries names, relative paths,
 * sizes and checksums. There is no route in this client that returns a byte of an artefact, and
 * the custody keyring is not in any backup at all — that is restated beside the action, because an
 * operator about to overwrite live data needs to know that what they are restoring does not
 * include the thing that decrypts it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  loadActions,
  loadBackup,
  loadBackups,
  requestApproval,
  startVerifyRestore,
  type Approval,
  type Artefact,
  type BackupDetail,
  type BackupRun,
  type Protection,
  type RestoreMode,
  type RestoreRun,
} from '../lib/admin.ts'
import {
  custodyCoverage,
  estateEnvironment,
  restoresNewestFirst,
  targetNamesOf,
  type EstateEnvironment,
} from '../lib/backups.ts'
import {
  backupTone,
  exactBytes,
  formatBytes,
  restoreTone,
  shortHash,
  shortId,
  timestamp,
  verificationTone,
} from '../lib/format.ts'
import {
  idempotencyKeyFor,
  previewRequest,
  previewVerifyRestore,
  restoreGate,
  restoreRecordLines,
} from '../lib/gate.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { useSession } from '../lib/auth.tsx'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { Facts, StatusWord } from '../components/tone.tsx'
import { IrreversibleAction, ReversibleAction } from '../components/irreversible.tsx'
import { CustodyKeyringNote } from '../components/protection.tsx'

/** The action `admin-api` runs a live restore through. `admin-api/src/actions.ts`. */
const RESTORE_ACTION = 'estate.restore'

interface View {
  readonly detail: BackupDetail
  readonly estate: EstateEnvironment
  readonly protection: Protection
  readonly custodyRuns: number
  readonly custodyLastAt: string | null
  /** The CLOSED reason-code list `POST /v1/approvals` validates against. */
  readonly reasonCodes: readonly string[]
}

export function BackupPage() {
  const { id = '' } = useParams()

  const load = useCallback(
    async (signal: AbortSignal): Promise<View> => {
      // Three reads, and each is needed BEFORE anything can be offered:
      //
      //   * the run itself, with its artefacts and the phrase the service will compare;
      //   * the list, for `estate` — the environment admin-api will check this backup against, and
      //     the other half of the comparison this screen exists to show;
      //   * the catalogue, for the CLOSED reason-code list `POST /v1/approvals` validates against
      //     (server.ts). Hard-coding those would be a second copy of a list the service owns,
      //     and the copy is the one that goes stale.
      //
      // `Promise.all` rather than `allSettled`: unlike the estate view, this screen has no partial
      // rendering worth offering. A restore decided without the comparison is the thing to prevent.
      const [detail, page, catalogue] = await Promise.all([
        loadBackup(id, { signal }),
        loadBackups({ limit: 200 }, { signal }),
        loadActions({ signal }),
      ])
      const custody = custodyCoverage(page.backups)
      return {
        detail,
        estate: estateEnvironment(page.estate, page.backups),
        protection: page.protection,
        custodyRuns: custody.runs,
        custodyLastAt: custody.lastAt,
        reasonCodes: catalogue.reasonCodes,
      }
    },
    [id],
  )

  // The id is part of the question: navigating between two runs reuses this component, and without
  // `[id]` the second would render the first one's artefacts under the second one's address — on
  // the screen whose whole job is to say which backup is about to be restored.
  const view = useResource<View>(load, () => 1, 'That backup could not be read.', [id])

  return (
    <>
      <nav className="aw-crumbs" aria-label="Breadcrumb">
        <Link className="aw-link" to="/backups">
          Backups
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="cf-num">{shortId(id)}</span>
      </nav>

      {view.state === 'loading' && <Loading label="Reading the backup" />}
      {view.state === 'forbidden' && <Forbidden notice={view.error ?? undefined} />}
      {view.state === 'failed' && view.error !== null && (
        <Failed
          notice={view.error}
          onRetry={view.reload}
          title={
            view.error.message.includes('no such') || view.error.message.includes('not found')
              ? 'There is no backup with that id'
              : 'That backup did not load'
          }
        />
      )}

      {view.data !== null && <BackupDetailBody view={view.data} onDone={view.reload} />}
    </>
  )
}

function BackupDetailBody({ view, onDone }: { view: View; onDone: () => void }) {
  const { backup, artefacts, restores } = view.detail

  return (
    <>
      <header className="aw-page-head">
        <h1 className="aw-page-title">
          <span className="cf-num">{backup.kind}</span> backup
        </h1>
        <div className="aw-page-badges">
          <StatusWord tone={backupTone(backup.state)} />
          <StatusWord
            tone={verificationTone({ verifiedAt: backup.verifiedAt, state: backup.state })}
          />
        </div>
        <p className="aw-page-lede">{backup.reason ?? 'No reason was recorded for this run.'}</p>
      </header>

      <EnvironmentComparison backup={backup} estate={view.estate} />

      <section className="aw-panel" aria-label="The run">
        <h2 className="aw-panel__title">The run</h2>
        <Facts
          rows={[
            { label: 'Run id', value: <code className="cf-num">{backup.id}</code> },
            { label: 'Environment', value: <code className="cf-num">{backup.environment}</code> },
            {
              label: 'Compose project',
              value: <code className="cf-num">{backup.composeProject}</code>,
            },
            { label: 'What was taken', value: <code className="cf-num">{backup.kind}</code> },
            { label: 'State', value: <StatusWord tone={backupTone(backup.state)} /> },
            { label: 'Asked for by', value: <code className="cf-num">{backup.requestedBy}</code> },
            { label: 'Reason', value: backup.reason ?? '—' },
            { label: 'Root path', value: <code className="cf-num">{backup.rootPath}</code> },
            {
              label: 'Directory',
              value:
                backup.directory === null ? (
                  <span className="aw-absent__word">not written yet</span>
                ) : (
                  <code className="cf-num">{backup.directory}</code>
                ),
            },
            { label: 'Queued', value: <span className="cf-num">{timestamp(backup.queuedAt)}</span> },
            {
              label: 'Started',
              value: <span className="cf-num">{timestamp(backup.startedAt)}</span>,
            },
            {
              label: 'Finished',
              value: <span className="cf-num">{timestamp(backup.finishedAt)}</span>,
            },
            {
              label: 'Size',
              value:
                formatBytes(backup.totalBytes) === null ? (
                  // Missing is missing. `BigInt('')` is `0n`, and "0 B" is exactly the reading an
                  // absent size must never produce on the screen that decides a restore.
                  <span className="aw-absent__word">not measured</span>
                ) : (
                  <span className="cf-num" title={exactBytes(backup.totalBytes) ?? undefined}>
                    {formatBytes(backup.totalBytes)}
                  </span>
                ),
            },
            {
              label: 'Files',
              value:
                backup.artefactCount === null ? (
                  <span className="aw-absent__word">not counted</span>
                ) : (
                  <span className="cf-num">{backup.artefactCount}</span>
                ),
            },
            {
              label: 'Manifest sha256',
              value:
                backup.manifestSha256 === null ? (
                  <span className="aw-absent__word">no manifest was written</span>
                ) : (
                  <code className="cf-num">{backup.manifestSha256}</code>
                ),
            },
            {
              label: 'Cluster system id',
              value:
                backup.clusterSystemId === null ? (
                  <span className="aw-absent__word">not recorded</span>
                ) : (
                  <code className="cf-num">{backup.clusterSystemId}</code>
                ),
            },
            {
              label: 'Custody vault included',
              value: backup.includesCustody ? 'yes — the encrypted blobs, never the keyring' : 'no',
            },
            {
              label: 'Proved by a restore',
              value:
                backup.verifiedAt === null ? (
                  <span className="aw-absent__word">
                    never — nothing has read these files back
                  </span>
                ) : (
                  <span className="cf-num">
                    {timestamp(backup.verifiedAt)}
                    {backup.verifiedByRestore === null
                      ? ''
                      : ` by restore ${shortId(backup.verifiedByRestore)}`}
                  </span>
                ),
            },
            { label: 'Error', value: backup.error ?? '—' },
          ]}
        />
      </section>

      <Artefacts artefacts={artefacts} />

      <CustodyKeyringNote
        note={view.protection.custodyKeyringNote}
        custody={{ runs: view.custodyRuns, lastAt: view.custodyLastAt }}
      />

      <RestoreHistory restores={restores} />

      <RestoreSection
        backup={backup}
        artefacts={artefacts}
        estate={view.estate}
        reasonCodes={view.reasonCodes}
        // The service's own phrase when it sent one; this console's reproduction of it otherwise.
        // See point 4 in the header: the operator must type the string that will be compared.
        servedPhrase={view.detail.liveConfirmationPhrase ?? null}
        onDone={onDone}
      />
    </>
  )
}

/**
 * The two environments, beside each other, before anything can be typed.
 *
 * The mismatch is the refusal an operator is most likely to walk into and the one they can see
 * coming from here. It is a word and a sentence rather than a colour, like every other state in
 * this console.
 */
function EnvironmentComparison({
  backup,
  estate,
}: {
  backup: BackupRun
  estate: EstateEnvironment
}) {
  const mismatch = estate.environment !== null && estate.environment !== backup.environment

  return (
    <section className="aw-panel aw-envs" aria-label="Which estate, and which backup">
      <h2 className="aw-panel__title">Environments</h2>
      <div className="aw-envs__pair">
        <div className="aw-envs__side">
          <span className="aw-envs__label">These artefacts were taken from</span>
          <strong className="aw-envs__value cf-num">{backup.environment}</strong>
        </div>
        <div className="aw-envs__side">
          <span className="aw-envs__label">This estate reads as</span>
          <strong className="aw-envs__value cf-num">
            {estate.environment ?? 'not established'}
          </strong>
        </div>
      </div>

      {mismatch ? (
        <p className="aw-note aw-note--crit" role="alert">
          <span className="aw-note__icon" aria-hidden="true">
            ■
          </span>
          These are not the same environment. admin-api compares the environment stamped inside the
          artefacts against the estate it is running in and refuses the pair — and it is right to.
          No live restore is offered below.
        </p>
      ) : (
        <p className="aw-panel__aside">{estate.basis}</p>
      )}
    </section>
  )
}

/**
 * What is inside the backup: names, paths, sizes and checksums.
 *
 * **There is no column here that could carry contents, and no route in this client that returns
 * any.** A checksum proves a file is the file without being the file, which is the whole reason
 * `deploy/docs/custody-backup-restore.md` proves the presence of a secret with a checksum or a
 * length rather than by displaying it.
 */
function Artefacts({ artefacts }: { artefacts: readonly Artefact[] }) {
  if (artefacts.length === 0) {
    return (
      <section className="aw-panel" aria-label="Files">
        <h2 className="aw-panel__title">Files</h2>
        <p className="aw-panel__lede">
          This run wrote no artefacts admin-api can list. A run with no files is a run with nothing
          to restore, whatever its state says.
        </p>
      </section>
    )
  }

  return (
    <section className="aw-panel" aria-label="Files">
      <h2 className="aw-panel__title">Files</h2>
      <table className="aw-table">
        <caption className="aw-table__caption">
          {artefacts.length} artefact{artefacts.length === 1 ? '' : 's'}. Names and checksums only —
          nothing on this screen shows the inside of a file, and there is no route that would.
        </caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Kind</th>
            <th scope="col">Path in the backup</th>
            <th scope="col">Size</th>
            <th scope="col">Entries</th>
            <th scope="col">sha256</th>
          </tr>
        </thead>
        <tbody>
          {artefacts.map((artefact) => (
            <tr key={artefact.id}>
              <th scope="row" className="cf-num">
                {artefact.name}
              </th>
              <td className="cf-num">{artefact.kind}</td>
              <td className="cf-num">{artefact.relPath}</td>
              <td className="cf-num" title={exactBytes(artefact.bytes) ?? undefined}>
                {formatBytes(artefact.bytes) ?? (
                  <span className="aw-absent__word">not measured</span>
                )}
              </td>
              <td className="cf-num">
                {artefact.entryCount === null ? (
                  <span className="aw-absent__word">—</span>
                ) : (
                  artefact.entryCount
                )}
              </td>
              <td className="cf-num" title={artefact.sha256}>
                {shortHash(artefact.sha256)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function RestoreHistory({ restores }: { restores: readonly RestoreRun[] }) {
  return (
    <section className="aw-panel" aria-label="Restores from this backup">
      <h2 className="aw-panel__title">Restores from this backup</h2>
      {restores.length === 0 ? (
        <p className="aw-note aw-note--warn" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          Nothing has ever been restored from this backup. It has not been shown to work — a
          successful run means the files were written, not that they read back.
        </p>
      ) : (
        <table className="aw-table">
          <caption className="aw-table__caption">
            {restores.length} attempt{restores.length === 1 ? '' : 's'}, newest first.
          </caption>
          <thead>
            <tr>
              <th scope="col">Restore</th>
              <th scope="col">Mode</th>
              <th scope="col">State</th>
              <th scope="col">Checksums</th>
              <th scope="col">Authorised by</th>
              <th scope="col">When</th>
            </tr>
          </thead>
          <tbody>
            {restoresNewestFirst(restores).map((restore) => (
              <tr key={restore.id}>
                <th scope="row" className="cf-num">
                  {shortId(restore.id)}
                  <span className="aw-row-sub">{restore.targets.join(', ') || 'no targets'}</span>
                </th>
                <td>
                  <strong className={restore.mode === 'live' ? 'aw-you' : ''}>
                    {restore.mode === 'live' ? 'LIVE' : 'verify'}
                  </strong>
                </td>
                <td>
                  <StatusWord tone={restoreTone(restore.state)} />
                  {restore.error !== null && <span className="aw-row-sub">{restore.error}</span>}
                </td>
                <td>
                  {restore.checksumsVerified === null ? (
                    <span className="aw-absent__word">not reported</span>
                  ) : (
                    <span className={restore.checksumsVerified ? 'aw-on' : 'aw-off'}>
                      {restore.checksumsVerified ? 'MATCHED' : 'DID NOT MATCH'}
                    </span>
                  )}
                </td>
                <td>
                  {restore.approvalId === null ? (
                    <span className="aw-absent__word">no approval — a verify needs none</span>
                  ) : (
                    <Link className="aw-link cf-num" to={`/approvals/${restore.approvalId}`}>
                      {shortId(restore.approvalId)}
                    </Link>
                  )}
                </td>
                <td className="cf-num">{timestamp(restore.queuedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/* ══════════════════════════ restoring ══════════════════════════ */

function RestoreSection({
  backup,
  artefacts,
  estate,
  reasonCodes,
  servedPhrase,
  onDone,
}: {
  backup: BackupRun
  artefacts: readonly Artefact[]
  estate: EstateEnvironment
  reasonCodes: readonly string[]
  servedPhrase: string | null
  onDone: () => void
}) {
  const all = targetNamesOf(artefacts)
  // Minted once per page view, per direction. A retry after a lost response has to present THE
  // SAME key or it is a new operation. See `idempotencyKeyFor` in lib/gate.ts.
  const mintedAt = useMemo(() => Date.now(), [])

  return (
    <>
      <VerifyRestore
        backup={backup}
        all={all}
        estate={estate}
        mintedAt={mintedAt}
        onDone={onDone}
      />
      <LiveRestore
        backup={backup}
        all={all}
        estate={estate}
        reasonCodes={reasonCodes}
        servedPhrase={servedPhrase}
        mintedAt={mintedAt}
        onDone={onDone}
      />
    </>
  )
}

/** The chooser, shared in shape by both actions and never in state: each owns its own selection. */
function Targets({
  all,
  chosen,
  onToggle,
  name,
}: {
  all: readonly string[]
  chosen: readonly string[]
  onToggle: (target: string, on: boolean) => void
  /** Distinguishes the two choosers' input ids, since both are on the page at once. */
  name: string
}) {
  if (all.length === 0) {
    return (
      <p className="aw-field__hint aw-field__hint--block">
        This run lists no artefacts, so there is nothing to choose and nothing to restore.
      </p>
    )
  }
  return (
    <fieldset className="aw-choice">
      <legend className="aw-choice__legend">What to restore</legend>
      {all.map((target) => (
        <label className="aw-choice__option" key={target} htmlFor={`${name}-${target}`}>
          <input
            id={`${name}-${target}`}
            type="checkbox"
            checked={chosen.includes(target)}
            onChange={(e) => onToggle(target, e.target.checked)}
          />
          <span className="aw-choice__word cf-num">{target}</span>
        </label>
      ))}
    </fieldset>
  )
}

/** Toggle helper: kept out of the components so both use the same one and neither reorders. */
function toggled(chosen: readonly string[], target: string, on: boolean): string[] {
  return on ? [...chosen, target] : chosen.filter((t) => t !== target)
}

/**
 * The safe half: restore into a throwaway scratch database, prove it reads back, drop it.
 *
 * `POST /v1/restores` — **admin-api/src/server.ts**, with `mode` fixed to `verify` because
 * that is the only value the route accepts.
 *
 * A `ReversibleAction`, because nothing live is touched and the service asks for neither a
 * confirmation phrase nor an approval. That asymmetry is the service's own and it is load-bearing
 * rather than lenient (server.ts): "if the only available restore were the terrifying
 * one, no restore would ever be rehearsed and every backup would stay a wish."
 */
function VerifyRestore({
  backup,
  all,
  estate,
  mintedAt,
  onDone,
}: {
  backup: BackupRun
  all: readonly string[]
  estate: EstateEnvironment
  mintedAt: number
  onDone: () => void
}) {
  const { operator } = useSession()
  const [chosen, setChosen] = useState<readonly string[] | null>(null)
  const [reason, setReason] = useState('')
  const [attempt, setAttempt] = useState(0)
  const targets = chosen ?? all

  const gate = restoreGate({
    backup,
    estateEnvironment: estate.environment,
    mode: 'verify',
    reasonCode: '',
    targets,
  })

  const verify = useMutation<[], { restore: RestoreRun }>(
    async () =>
      startVerifyRestore(
        { backupRunId: backup.id, targets, reason: reason.trim() },
        // The attempt advances only on a run that came back, so a retry after a lost response
        // replays and a deliberate second verification is a new operation.
        idempotencyKeyFor('restore-verify', `${backup.id}-${attempt}`, mintedAt),
      ),
    'The verify restore could not be started.',
  )

  const run = async () => {
    const result = await verify.run()
    if (result !== null) {
      setAttempt((n) => n + 1)
      onDone()
    }
  }

  if (!gate.offered && !gate.needsOperatorInput) {
    return (
      <section className="aw-panel aw-panel--refusal" aria-label="Verify restore">
        <h2 className="aw-panel__title">
          <span aria-hidden="true">⊘</span> This backup cannot be verified
        </h2>
        <p>{gate.reason}</p>
      </section>
    )
  }

  return (
    <ReversibleAction
      label="Verify restore"
      summary="Reads these artefacts back into a throwaway scratch database, checks them, and drops it. Nothing live is touched."
      consequences={[
        'A scratch database is created, the chosen artefacts are restored into it, and it is dropped afterwards. No live database, vault or file is written.',
        'The service asks for no confirmation phrase and no approval for this mode, because there is nothing to undo.',
        'On success this backup is marked verified — which is the only evidence anywhere in the estate that these files read back at all.',
        'Only one restore runs at a time across the whole estate. If another is queued or running this is refused out loud rather than queued behind it, because a restore that silently waits is a restore an operator believes has already happened.',
        'It proves the ARTEFACTS. It does not prove the destination survives losing this machine, and nothing on this console can.',
      ]}
      previews={[
        previewVerifyRestore({ actor: operator.principal, backupId: backup.id, targets }),
      ]}
      runLabel="Run a verify restore"
      busy={verify.busy}
      disabledReason={
        gate.reason ??
        (reason.trim().length === 0
          ? 'Say why you are verifying — it is stored on the restore row, and a drill nobody wrote a reason for is a drill nobody can tell from an incident later.'
          : null)
      }
      onRun={() => void run()}
    >
      <Targets
        name="verify"
        all={all}
        chosen={targets}
        onToggle={(target, on) => setChosen(toggled(targets, target, on))}
      />
      <label className="aw-field">
        <span className="aw-field__label">Why are you verifying this one?</span>
        <textarea
          className="aw-field__input"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <RestoreRecord mode="verify" backup={backup} targets={targets} />
      {verify.error !== null && (
        <Failed notice={verify.error} title="The verify restore did not start" />
      )}
      {verify.result !== null && (
        <p className="aw-note aw-note--good" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            ●
          </span>
          Restore <code className="cf-num">{shortId(verify.result.restore.id)}</code> is{' '}
          {verify.result.restore.state}. This backup is proved only once that run succeeds.
        </p>
      )}
    </ReversibleAction>
  )
}

/**
 * The destructive half: ask two operators to overwrite the live estate with this backup.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS RAISES A REQUEST. IT DOES NOT RESTORE ANYTHING.
 *
 * `POST /v1/restores` refuses `mode: "live"` (server.ts) and names the way in: an
 * `estate.restore` approval. So this control posts to `POST /v1/approvals` (server.ts), the
 * request sits in the queue until a SECOND operator decides it, and the executor
 * (`admin-api/src/approvals.ts` `estate.restore`) is what creates the live restore.
 *
 * The typed phrase is therefore not a client-side ceremony that ends at this form. It becomes
 * `params.confirmation` on the request, `requestRestore` compares it with `!==` at execution time
 * (backups.ts), and — the part that makes this better than a modal — the second operator reads
 * it on the approval page before they sign. One person types "restore mainnet from
 * 2026-08-04T12:00:00Z"; another person reads it and agrees.
 *
 * Never a single click, and never "Are you sure?". The phrase cannot be written by somebody who
 * has not read which estate they are about to overwrite and which moment they are about to
 * overwrite it with, which is exactly the pair of facts a misclick gets wrong.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
function LiveRestore({
  backup,
  all,
  estate,
  reasonCodes,
  servedPhrase,
  mintedAt,
  onDone,
}: {
  backup: BackupRun
  all: readonly string[]
  estate: EstateEnvironment
  reasonCodes: readonly string[]
  servedPhrase: string | null
  mintedAt: number
  onDone: () => void
}) {
  const { operator } = useSession()
  const [chosen, setChosen] = useState<readonly string[] | null>(null)
  const [reasonCode, setReasonCode] = useState('')
  const [attempt, setAttempt] = useState(0)
  const targets = chosen ?? all

  const gate = restoreGate({
    backup,
    estateEnvironment: estate.environment,
    mode: 'live',
    reasonCode,
    targets,
  })

  // The SERVED phrase wins. `gate.phrase` reproduces it from the same fields and exists for a
  // response that did not carry one; if the two ever disagree, the service's is the one it will
  // compare against, so preferring it is the difference between a refusal and a restore.
  const phrase = servedPhrase ?? gate.phrase

  const raise = useMutation<[string], { approval: Approval }>(
    async (rationale: string) =>
      requestApproval(
        {
          action: RESTORE_ACTION,
          // `estate.restore`'s subject is the BACKUP RUN — admin-api/src/actions.ts — and the
          // executor reads `ctx.approval.subjectId` as the backup to restore from. Getting this
          // wrong would authorise a restore of a different backup than the one on screen.
          subjectId: backup.id,
          reasonCode,
          reason: rationale,
          params: {
            // The canonical phrase, not the operator's keystrokes. `confirmationGate` accepts a
            // different case and different spacing — deliberately, so the mechanism is not defeated
            // by teaching people to paste — but `requestRestore` compares with `!==`, so what is
            // STORED has to be the exact string.
            confirmation: phrase ?? '',
            targets: [...targets],
          },
        },
        idempotencyKeyFor('restore-live', `${backup.id}-${attempt}`, mintedAt),
      ),
    'The restore request could not be raised.',
  )

  const run = async (rationale: string) => {
    const result = await raise.run(rationale)
    if (result !== null) {
      setAttempt((n) => n + 1)
      onDone()
    }
  }

  // A STRUCTURAL refusal replaces the controls entirely: nothing an operator can type changes a
  // pruned run or an environment mismatch, and a disabled control reads as "not yet" and gets
  // clicked at. See `RestoreGate.needsOperatorInput` in lib/gate.ts for why the other kind must
  // NOT do this — hiding the reason-code selector because no reason code is chosen would be a form
  // that removes the box you were about to fill in.
  if ((!gate.offered && !gate.needsOperatorInput) || phrase === null) {
    return (
      <section className="aw-panel aw-panel--refusal" aria-label="Live restore">
        <h2 className="aw-panel__title">
          <span aria-hidden="true">⊘</span> No live restore is available here
        </h2>
        <p>
          {gate.reason ??
            'This console has no confirmation phrase for this backup — neither admin-api nor this ' +
              'bundle could build one from its queued-at timestamp, and asking you to guess at the ' +
              'exact string the service compares would be worse than refusing.'}
        </p>
        {gate.mismatch && (
          <p className="aw-panel__aside">
            A verify restore is a different question and may still be worth running: it reads these
            artefacts into a throwaway database and proves them, without touching this estate.
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="aw-live" aria-label="Live restore setup">
      <h2 className="aw-panel__title">Live restore</h2>
      <p className="aw-panel__lede">
        This asks two operators to overwrite the running estate’s data with what is in this backup.
        Nothing happens when you send it: it becomes an <code className="cf-num">estate.restore</code>{' '}
        request in the{' '}
        <Link className="aw-link" to="/approvals">
          approval queue
        </Link>
        , and a second operator — not you — decides it. The restore runs when they do.
      </p>

      <Targets
        name="live"
        all={all}
        chosen={targets}
        onToggle={(target, on) => setChosen(toggled(targets, target, on))}
      />

      <label className="aw-field" htmlFor="aw-live-reason-code">
        <span className="aw-field__label">Reason code</span>
        <span className="aw-field__hint">
          A closed list admin-api validates against — it is how the second operator sorts and
          searches the queue.
        </span>
        <select
          id="aw-live-reason-code"
          className="aw-field__input"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
        >
          <option value="">Choose one…</option>
          {reasonCodes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>

      {gate.offered ? (
        <IrreversibleAction
          label="Live restore"
          summary={`Ask for ${backup.environment} to be overwritten with the contents of this backup, taken ${timestamp(
            backup.queuedAt,
          )}.`}
          consequences={[
            `Everything written since ${timestamp(backup.queuedAt)} is gone when this runs. Balances, ledger entries, orders, moderation decisions — anything that happened after this backup was taken is not in it.`,
            'It is not a rollback that can be rolled forward. There is no undo, and the only way back is another backup taken later, if one exists.',
            'A second operator has to approve it, and it may not be you. What they will read is this request, its reason, and the confirmation phrase you type below — so write the phrase for somebody who has to agree with it.',
            'One approval authorises exactly one restore, for ever: a partial unique index refuses a second restore against the same approval, so a retry cannot start a second one over the top of the first.',
            'The custody keyring is not in this backup and is not restored by it. If the keyring is what was lost, this restores ciphertext nobody can decrypt — its procedure is physical and off-site.',
          ]}
          previews={[
            previewRequest({
              actor: operator.principal,
              action: RESTORE_ACTION,
              subjectKind: 'backup_run',
              subjectId: backup.id,
              reasonCode,
            }),
          ]}
          phrase={phrase}
          rationaleLabel="Why does this estate need restoring?"
          rationaleHint="Stored as the request’s reason, and it is the first thing the second operator reads. Write it for them."
          runLabel={`Ask two operators to restore ${backup.environment}`}
          busy={raise.busy}
          onRun={(rationale) => void run(rationale)}
        >
          <div className="aw-recap">
            <p className="aw-recap__line">
              <span className="aw-recap__label">You are asking to overwrite</span>{' '}
              <code className="cf-num">{estate.environment ?? 'this estate'}</code>
            </p>
            <p className="aw-recap__line">
              <span className="aw-recap__label">with artefacts taken from</span>{' '}
              <code className="cf-num">{backup.environment}</code>{' '}
              <span className="aw-recap__label">at</span>{' '}
              <code className="cf-num">{timestamp(backup.queuedAt)}</code>
            </p>
            <p className="aw-recap__line">
              <span className="aw-recap__label">restoring</span>{' '}
              <code className="cf-num">{targets.join(', ') || 'everything in the backup'}</code>
            </p>
          </div>
          <RestoreRecord mode="live" backup={backup} targets={targets} />
        </IrreversibleAction>
      ) : (
        // The INPUT refusal: the controls above stay on screen and this says what is still needed.
        <p className="aw-danger__why" aria-live="polite">
          {gate.reason}
        </p>
      )}

      {raise.error !== null && (
        <Failed notice={raise.error} title="The restore request was not raised" />
      )}
      {raise.result !== null && (
        <p className="aw-note aw-note--warn" role="alert">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          Request{' '}
          <Link className="aw-link cf-num" to={`/approvals/${raise.result.approval.id}`}>
            {shortId(raise.result.approval.id)}
          </Link>{' '}
          is waiting for a second operator. Nothing has been restored. Send them that address — it
          is the whole request, including the phrase you typed.
        </p>
      )}
    </section>
  )
}

/**
 * What the eventual restore RUN will record — beside the audit preview, not instead of it.
 *
 * The audit row is real and cited (`previewVerifyRestore` / `previewRequest` in lib/gate.ts), and
 * `IrreversibleAction` renders it above this. These sentences describe the `restore_runs` row,
 * which is where `checksumsVerified`, `artefactEnvironment` and the outcome live — what the estate
 * will be able to tell afterwards, as opposed to what it records about the asking.
 */
function RestoreRecord({
  mode,
  backup,
  targets,
}: {
  mode: RestoreMode
  backup: BackupRun
  targets: readonly string[]
}) {
  const lines = restoreRecordLines({ mode, backup, targets })
  return (
    <section className="aw-audit-preview" aria-label="What this records">
      <h4 className="aw-audit-preview__title">
        <span className="aw-audit-preview__icon" aria-hidden="true">
          ▤
        </span>
        What this records
      </h4>
      <p className="aw-audit-preview__lede">
        The <code className="cf-num">restore_runs</code> row, which is not the audit event above it.
        The audit records that somebody asked; this is what the estate will be able to tell about
        whether it worked.
      </p>
      <ul className="aw-audit-preview__notes">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}

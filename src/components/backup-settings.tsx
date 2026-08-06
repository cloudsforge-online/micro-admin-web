/**
 * The backup settings, and the bounds the service enforces on them.
 *
 * `GET /v1/backups/settings` — **admin-api/src/server.ts**.
 * `PUT /v1/backups/settings` — **admin-api/src/server.ts**.
 *
 * ── Why the ceilings are rendered rather than reimplemented ───────────────────────────────────
 *
 * `admin-api` holds the bounds and is the thing that refuses. A client-side copy of a bound is a
 * second, unversioned opinion about it — and the copy is the one that goes stale, silently, on the
 * day somebody tightens the real one. So the form's own checks cover only what is knowable here
 * without inventing a number (is this a whole number, is that path absolute), the service's
 * ceilings are printed beside the fields as facts, and `settingsProblems` in lib/backups.ts says
 * plainly which of the two is talking.
 *
 * ── Why the form only sends four fields ───────────────────────────────────────────────────────
 *
 * The retention ceiling, the free-space floor and the verification schedule are not edited here,
 * so they are not sent. A PUT that echoed back every field it had read would let a form opened
 * before a bound was tightened overwrite the tightening — the classic lost update, on the settings
 * that decide whether there is a backup at all.
 */
import { useCallback, useState } from 'react'
import {
  loadBackupSettings,
  saveBackupSettings,
  type BackupCeilings,
  type BackupSettings,
  type Protection,
} from '../lib/admin.ts'
import { ceilingRows, draftFrom, settingsProblems, type SettingsDraft } from '../lib/backups.ts'
import { exactBytes, formatBytes, timestamp } from '../lib/format.ts'
import { useMutation } from '../lib/mutation.ts'
import { useResource } from '../lib/resource.ts'
import { Failed, Forbidden, Loading } from './states.tsx'

export function BackupSettingsPanel() {
  const load = useCallback(
    async (signal: AbortSignal) => loadBackupSettings({ signal }),
    [],
  )
  // Never empty: the route answers a settings object or it fails. An "empty" branch here would be
  // unreachable, and an unreachable branch on a settings screen is a branch nobody maintains.
  const settings = useResource<{
    settings: BackupSettings
    ceilings: BackupCeilings
    protection: Protection
  }>(
    load,
    () => 1,
    'The backup settings could not be read.',
  )

  return (
    <section className="aw-panel" aria-label="Backup settings">
      <h2 className="aw-panel__title">Settings</h2>

      {settings.state === 'loading' && <Loading label="Reading the settings" />}
      {settings.state === 'forbidden' && <Forbidden notice={settings.error ?? undefined} />}
      {settings.state === 'failed' && settings.error !== null && (
        <Failed
          notice={settings.error}
          onRetry={settings.reload}
          title="The settings did not load"
        />
      )}

      {settings.data !== null && (
        <SettingsForm
          // Remounted when the stored settings change, so the draft is re-seeded from the answer
          // rather than an effect syncing two copies of the same state. `updatedAt` moves on every
          // successful write, which is exactly when the form should start again.
          key={settings.data.settings.updatedAt}
          settings={settings.data.settings}
          ceilings={settings.data.ceilings}
          onSaved={settings.reload}
        />
      )}
    </section>
  )
}

function SettingsForm({
  settings,
  ceilings,
  onSaved,
}: {
  settings: BackupSettings
  ceilings: BackupCeilings
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFrom(settings))
  const problems = settingsProblems(draft)

  const save = useMutation<[], { settings: BackupSettings }>(
    async () =>
      saveBackupSettings({
        rootPath: draft.rootPath.trim(),
        retentionCopies: Number(draft.retentionCopies.trim()),
        scheduleEnabled: draft.scheduleEnabled,
        scheduleEveryMinutes: Number(draft.scheduleEveryMinutes.trim()),
      }),
    'The settings could not be saved.',
  )

  const run = async () => {
    if (problems.length > 0) return
    const result = await save.run()
    if (result !== null) onSaved()
  }

  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }))

  return (
    <>
      <label className="aw-field" htmlFor="aw-backup-root">
        <span className="aw-field__label">Where artefacts are written</span>
        <span className="aw-field__hint">
          An absolute path on the backup destination. Changing it does not move what is already
          there — older runs keep the path they were written to, which is why each run carries its
          own.
        </span>
        <input
          id="aw-backup-root"
          className="aw-field__input cf-num"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={draft.rootPath}
          onChange={(e) => set('rootPath', e.target.value)}
        />
      </label>

      <label className="aw-field" htmlFor="aw-backup-retention">
        <span className="aw-field__label">Copies to keep</span>
        <span className="aw-field__hint">
          Once there are more than this, older runs are pruned and their files are no longer on disk
          to restore from. Lowering it is a deletion that happens later.
        </span>
        <input
          id="aw-backup-retention"
          className="aw-field__input cf-num"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={draft.retentionCopies}
          onChange={(e) => set('retentionCopies', e.target.value)}
        />
      </label>

      <label className="aw-field aw-field--inline" htmlFor="aw-backup-schedule">
        <span className="aw-field__label">Take one automatically</span>
        <input
          id="aw-backup-schedule"
          type="checkbox"
          checked={draft.scheduleEnabled}
          onChange={(e) => set('scheduleEnabled', e.target.checked)}
        />
      </label>

      <label className="aw-field" htmlFor="aw-backup-every">
        <span className="aw-field__label">How often, in minutes</span>
        <span className="aw-field__hint">
          {draft.scheduleEnabled
            ? 'The interval between scheduled runs.'
            : 'The schedule is off, so this is not in use. It is kept so turning the schedule back on does not need it typed again.'}
        </span>
        <input
          id="aw-backup-every"
          className="aw-field__input cf-num"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={draft.scheduleEveryMinutes}
          onChange={(e) => set('scheduleEveryMinutes', e.target.value)}
        />
      </label>

      <ServerBounds settings={settings} ceilings={ceilings} />

      <div className="aw-danger__foot">
        <button
          type="button"
          className="cf-btn"
          disabled={save.busy || problems.length > 0}
          onClick={() => void run()}
        >
          {save.busy ? 'Working…' : 'Save these settings'}
        </button>
        {/* The reason beside the disabled control, always, and in a live region because it changes
            as the operator types. A disabled button with no explanation is one they retry until
            they conclude the console is broken. */}
        {problems.length > 0 && (
          <p className="aw-danger__why" aria-live="polite">
            {problems.join(' ')}
          </p>
        )}
      </div>

      {save.error !== null && <Failed notice={save.error} title="The settings were not saved" />}

      <p className="aw-panel__aside">
        Last changed {timestamp(settings.updatedAt)} by{' '}
        <code className="cf-num">{settings.updatedBy}</code>.
      </p>
    </>
  )
}

/**
 * The bounds the SERVICE enforces, printed rather than enforced here.
 *
 * Every entry admin-api sent is rendered whatever it is called — see `BackupCeilings` in
 * lib/admin.ts for why the shape is open rather than declared. A key ending in `Bytes` whose value
 * is a digit string additionally gets a human size, which is the contract's own naming convention
 * read back rather than a guess about the field.
 */
function ServerBounds({
  settings,
  ceilings,
}: {
  settings: BackupSettings
  ceilings: BackupCeilings
}) {
  const rows = ceilingRows(ceilings)
  return (
    <div className="aw-bounds">
      <h3 className="aw-honesty__heading">What admin-api will refuse</h3>
      <p className="aw-field__hint aw-field__hint--block">
        These are the service’s, not this form’s. The checks beside the fields above catch a typo;
        these are what actually refuse a value, and they are shown rather than copied so a bound
        tightened on the service cannot go stale here.
      </p>
      <dl className="aw-facts aw-facts--tight">
        <div className="aw-facts__row">
          <dt className="aw-facts__label">ceiling</dt>
          <dd className="aw-facts__value cf-num" title={exactBytes(settings.ceilingBytes) ?? undefined}>
            {formatBytes(settings.ceilingBytes) ?? settings.ceilingBytes}
          </dd>
        </div>
        <div className="aw-facts__row">
          <dt className="aw-facts__label">keep free</dt>
          <dd className="aw-facts__value cf-num" title={exactBytes(settings.minFreeBytes) ?? undefined}>
            {formatBytes(settings.minFreeBytes) ?? settings.minFreeBytes}
          </dd>
        </div>
        <div className="aw-facts__row">
          <dt className="aw-facts__label">verification</dt>
          <dd className="aw-facts__value">
            {settings.verifyEnabled
              ? `automatic, every ${settings.verifyEveryMinutes} minutes`
              : 'off — nothing is proving these backups read back unless somebody runs a verify restore'}
          </dd>
        </div>
        {rows.map((row) => (
          <div className="aw-facts__row" key={row.key}>
            <dt className="aw-facts__label">{row.key}</dt>
            <dd className="aw-facts__value cf-num">
              {row.min} to {row.max}
              {/* Both ends, always. A ceiling shown without its floor is half the answer, and the
                  floor is the one that refuses a schedule of "every minute". */}
              {row.bytes && (
                <span className="aw-row-sub">
                  {formatBytes(row.min) ?? row.min} to {formatBytes(row.max) ?? row.max}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

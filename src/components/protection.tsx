/**
 * What the backup actually protects against — said plainly, and never dressed up.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THERE IS NO GREEN TICK ON THIS PANEL, AND THAT IS THE WHOLE DESIGN.
 *
 * A second physical disk in the same machine protects against ONE failure: that disk dying. It
 * does not protect against the machine being lost, stolen, flooded, burnt, encrypted by
 * ransomware, or emptied by an `rm -rf` that reaches both mounts — which is most of the ways an
 * estate loses its data, and all of the ways it loses it suddenly.
 *
 * The reason this needs a whole component rather than a sentence is that every OTHER fact on the
 * backup screens is reassuring by default. A row of green states, a size in gibibytes, a matching
 * checksum: none of them is wrong, and a reader who stops there has concluded something false. A
 * "✓ Protected" badge above them would not be a shortcut, it would be the console adding the
 * conclusion the facts do not support.
 *
 * So: the verdict sentence first, then what is NOT covered, then what is. That ordering is
 * deliberate and it is the opposite of the flattering one. `covers` and `doesNotCover` come from
 * the service and are rendered verbatim — this console does not edit them in either direction,
 * because a client that rewrote the service's list of what it cannot do would be the exact failure
 * this panel exists to prevent, one layer up.
 *
 * ── The custody keyring, which is deliberately not in any of it ───────────────────────────────
 *
 * `Protection.custodyKeyringIncluded` is typed as the literal `false`, not as a boolean: it is a
 * statement rather than a flag. The keyring is a key-encryption key, and the vault it unlocks is
 * inside these backups — so a backup set containing both would be one medium holding the coins.
 * `deploy/docs/custody-backup-restore.md` §4 puts it in one line: "the vault and the keyring must
 * never share a medium, a backup set, a cloud bucket or a filesystem. Either one alone is safe to
 * lose to a thief. Together they are the coins."
 *
 * Its backup is therefore physical, off-site and manual, and §4 is the procedure. What this panel
 * shows about custody is that a backup of the VAULT exists — a count and a date — and nothing
 * else. No slot, no filename, no key version, no length, no ciphertext. See `custodyCoverage` in
 * lib/backups.ts for why those two numbers are the only ones this console may hold.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import type { Protection } from '../lib/admin.ts'
import type { CustodyCoverage } from '../lib/backups.ts'
import { timestamp } from '../lib/format.ts'

/** Where §4 lives, written once so the two places that cite it cannot drift apart. */
export const CUSTODY_PROCEDURE = 'deploy/docs/custody-backup-restore.md §4'

export function ProtectionPanel({
  protection,
  custody,
}: {
  protection: Protection
  custody: CustodyCoverage
}) {
  return (
    <section className="aw-panel aw-honesty" aria-label="What this protects against">
      <h2 className="aw-panel__title">What this protects against, and what it does not</h2>

      {/*
        The verdict, before the lists. `role="alert"` rather than `status` when the destination is
        on the same machine, because that is not a detail of the configuration — it is the sentence
        that decides what an operator should do next, and it must reach somebody who is skimming.
      */}
      {protection.sameHost ? (
        <p className="aw-note aw-note--warn" role="alert">
          <span className="aw-note__icon" aria-hidden="true">
            ▲
          </span>
          <span>
            The backup is written to <code className="cf-num">{protection.destinationDevice}</code>,
            which is <strong>a second disk in the same machine</strong>. That protects against{' '}
            <strong>one</strong> thing: that disk failing. It does not protect against losing the
            machine — theft, fire, flood, a failed host, ransomware that reaches both mounts, or an{' '}
            <code className="cf-num">rm -rf</code> with the wrong argument. Every one of those takes
            the estate and the backup together.
          </span>
        </p>
      ) : (
        <p className="aw-note" role="status">
          <span className="aw-note__icon" aria-hidden="true">
            ●
          </span>
          <span>
            The backup is written to <code className="cf-num">{protection.destinationDevice}</code>,
            which admin-api reports is not on this host. Read the two lists below for what that does
            and does not cover — this console states what the service said and adds nothing to it.
          </span>
        </p>
      )}

      {/*
        NOT COVERED FIRST. The flattering order puts the protections at the top and leaves the
        limits to somebody who scrolls, and on this screen the limits are the half that changes
        what an operator does.
      */}
      <div className="aw-honesty__lists">
        <div className="aw-honesty__list aw-honesty__list--no">
          <h3 className="aw-honesty__heading">
            <span aria-hidden="true">⊘</span> Does not protect against
          </h3>
          {protection.doesNotCover.length === 0 ? (
            <p className="aw-honesty__empty">
              admin-api listed nothing here. That is not the same as “nothing is uncovered” — it is
              the service having said nothing, and this console will not read it as reassurance.
            </p>
          ) : (
            <ul className="aw-honesty__items">
              {protection.doesNotCover.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="aw-honesty__list aw-honesty__list--yes">
          <h3 className="aw-honesty__heading">
            {/* A neutral mark, not a tick. A tick is a verdict about the whole arrangement. */}
            <span aria-hidden="true">·</span> Protects against
          </h3>
          {protection.covers.length === 0 ? (
            <p className="aw-honesty__empty">admin-api listed nothing here.</p>
          ) : (
            <ul className="aw-honesty__items">
              {protection.covers.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CustodyKeyringNote note={protection.custodyKeyringNote} custody={custody} />
    </section>
  )
}

/**
 * The custody keyring: absent from every backup, on purpose, and where its real procedure lives.
 *
 * Exported separately so the restore screen can restate it beside the action. An operator about to
 * overwrite live data needs to know that what they are restoring does not include the thing that
 * decrypts it, and finding that out afterwards is finding it out too late.
 */
export function CustodyKeyringNote({
  note,
  custody,
}: {
  /** `Protection.custodyKeyringNote`, rendered verbatim. */
  note: string
  custody: CustodyCoverage
}) {
  return (
    <div className="aw-honesty__custody">
      <h3 className="aw-honesty__heading">
        <span aria-hidden="true">⊘</span> The custody keyring is not in any of this
      </h3>
      <p>{note}</p>
      <p>
        It is deliberate rather than missing. The keyring is the key-encryption key for the vault,
        and the vault <em>is</em> in these backups — so a backup set holding both would be one
        medium holding the coins. Its backup is physical, off-site and manual, and the procedure is{' '}
        <code className="cf-num">{CUSTODY_PROCEDURE}</code>. Nothing on this screen can perform it
        and nothing on this screen can check it.
      </p>
      {/*
        THE COUNT AND THE DATE, AND NOTHING ELSE.
        An operator has to be able to answer "is the vault being backed up at all". That question is
        answered by two numbers. It is not answered by a filename, a slot, a key version or a
        length, and there is no field in this client that could carry one.
      */}
      <dl className="aw-facts aw-facts--tight">
        <div className="aw-facts__row">
          <dt className="aw-facts__label">vault in backups</dt>
          <dd className="aw-facts__value">
            {custody.runs === 0 ? (
              <span className="aw-absent__word">
                no completed backup here has carried the custody vault
              </span>
            ) : (
              <>
                <span className="cf-num">{custody.runs}</span> completed run
                {custody.runs === 1 ? '' : 's'} carried it
              </>
            )}
          </dd>
        </div>
        <div className="aw-facts__row">
          <dt className="aw-facts__label">most recent</dt>
          <dd className="aw-facts__value cf-num">
            {custody.lastAt === null ? '—' : timestamp(custody.lastAt)}
          </dd>
        </div>
        <div className="aw-facts__row">
          <dt className="aw-facts__label">contents</dt>
          <dd className="aw-facts__value">
            never shown here, at any zoom level. This console reads names, sizes and checksums; it
            has no route that returns a byte of an artefact.
          </dd>
        </div>
      </dl>
    </div>
  )
}

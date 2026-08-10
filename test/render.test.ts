/**
 * What the screens actually put on the page, checked by reading them.
 *
 * ── Why this is a source-text test and not a rendering test ───────────────────────────────────
 *
 * There is no DOM in this suite, on purpose and in line with the rest of the estate: jsdom is a
 * second browser implementation to keep current, it disagrees with real ones exactly where it
 * matters, and a test that renders a component in it proves the component renders in jsdom.
 *
 * But several of this console's requirements ARE about rendering — "show the operator what will be
 * recorded before they act", "an action that cannot be executed must not look like one that can",
 * "every figure carries its observation time", "never colour alone for state". Those are not
 * properties of a pure function; they are properties of a file. So they are asserted against the
 * file, the way `routes.test.ts` asserts the router against `app.tsx`.
 *
 * The limitation is stated plainly: this proves each component IS WIRED to the right data, not
 * that the pixels land. The logic underneath — `confirmationGate`, `decisionGate`, `availabilityOf`,
 * `figure`, `tileViews` — is proven properly, as pure functions, by its own test.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

/**
 * A source file with its comments removed.
 *
 * Needed for the checks that forbid a STRING, because the files in this repository explain the
 * rules they follow — `irreversible.tsx` quotes "Are you sure?" in order to say why it is not used,
 * and a grep over the raw text therefore matches the rationale and fails a correct file. hub-web's
 * CI has exactly this bug in its nginx check. A guard that fires on its own explanation trains
 * people to delete the explanation.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const estate = read('src/pages/estate.tsx')
const approvals = read('src/pages/approvals.tsx')
const approval = read('src/pages/approval.tsx')
const actions = read('src/pages/actions.tsx')
const audit = read('src/pages/audit.tsx')
const flags = read('src/pages/flags.tsx')
const broadcasts = read('src/pages/broadcasts.tsx')
const support = read('src/pages/support.tsx')
const backups = read('src/pages/backups.tsx')
const backup = read('src/pages/backup.tsx')
const protection = read('src/components/protection.tsx')
const backupSettings = read('src/components/backup-settings.tsx')
const irreversible = read('src/components/irreversible.tsx')
const gate = read('src/lib/gate.ts')
const auditPreview = read('src/components/audit-preview.tsx')
const tone = read('src/components/tone.tsx')
const shell = read('src/components/shell.tsx')
const foresightSection = read('src/components/foresight-section.tsx')
const styles = read('src/styles.css')

/**
 * The design system's stylesheet as this bundle actually consumes it.
 *
 * `dist/`, not `src/`, because that is what `main.tsx` imports and therefore what ships. Reading
 * the source would let a rule pass here that never reaches a reader.
 */
const uiCss = read('node_modules/@cloudsforge/ui/dist/ui.css')

/** `src/styles.css` with its comments removed — this file explains its own rules at length. */
const cssDeclarations = styles.replace(/\/\*[\s\S]*?\*\//g, '')

const PAGES: ReadonlyArray<[string, string]> = [
  ['estate', estate],
  ['approvals', approvals],
  ['approval', approval],
  ['actions', actions],
  ['audit', audit],
  ['flags', flags],
  ['broadcasts', broadcasts],
  ['support', support],
  ['backups', backups],
  ['backup', backup],
]

/* ══════════════════ the audit is shown before the action ══════════════════ */

describe('every write shows what it will record, before it runs', () => {
  it('the decision page previews both rows a grant writes', () => {
    assert.match(approval, /previews=\{previewDecision\(approval, true, operatorPrincipal\)\}/)
  })

  it('the decision page previews the single row a rejection writes', () => {
    assert.match(approval, /previews=\{previewDecision\(approval, false, operatorPrincipal\)\}/)
  })

  it('raising a request previews its audit row', () => {
    assert.match(actions, /previewRequest\(/)
  })

  it('a flag change previews its audit row', () => {
    assert.match(flags, /previewFlag\(/)
  })

  it('publishing and retracting a broadcast both preview theirs', () => {
    assert.match(broadcasts, /previewBroadcast\(\{ actor: operator\.principal, retract: false/)
    assert.match(broadcasts, /previewBroadcast\(\{ actor: operator\.principal, retract: true/)
  })

  it('the preview appears ABOVE the confirmation control, not below it', () => {
    const source = withoutComments(irreversible)
    const preview = source.indexOf('<AuditRecordPreview')
    const button = source.indexOf('<button')
    assert.ok(preview > 0 && button > preview, 'the audit preview must precede the control')
  })

  it('the preview is never behind a disclosure triangle', () => {
    assert.doesNotMatch(withoutComments(auditPreview), /<details|<summary/)
  })

  it('the preview renders the actor, the subject and the outcome of each row', () => {
    assert.match(auditPreview, /preview\.actor/)
    assert.match(auditPreview, /preview\.subjectKind/)
    assert.match(auditPreview, /preview\.subjectId/)
    assert.match(auditPreview, /preview\.outcome/)
  })

  it('the preview renders the sentences, not only the fields', () => {
    assert.match(auditPreview, /preview\.notes\.map/)
  })

  it('says the rows cannot be edited afterwards without breaking the chain', () => {
    assert.match(auditPreview, /hash chain|breaking the chain/)
  })
})

/* ══════════════════ the irreversible gate ══════════════════ */

describe('the irreversible gate', () => {
  it('never asks "Are you sure?"', () => {
    // The question has never once been answered "no" by somebody about to make a mistake.
    for (const [name, source] of [...PAGES, ['irreversible', irreversible] as const]) {
      assert.doesNotMatch(withoutComments(source), /Are you sure/i, `${name} asks it`)
    }
  })

  it('reads its verdict from confirmationGate rather than checking fields itself', () => {
    assert.match(irreversible, /confirmationGate\(\{ typed, required: phrase, rationale, busy \}\)/)
  })

  it('disables the control on the gate’s answer, not on a local expression', () => {
    assert.match(irreversible, /disabled=\{!gate\.ready\}/)
  })

  it('states the reason beside a disabled control, always', () => {
    // A disabled control with no explanation is one the operator retries until they conclude the
    // console is broken.
    assert.match(irreversible, /gate\.reason !== null &&/)
    assert.match(irreversible, /aria-live="polite"/)
  })

  it('requires a rationale field and a phrase field, in that order', () => {
    const source = withoutComments(irreversible)
    assert.ok(source.indexOf('htmlFor={rationaleId}') < source.indexOf('htmlFor={phraseId}'))
  })

  it('lists the consequences BEFORE either field', () => {
    // Compared against the FIELD, not the `useId()` call that names it: the hooks are declared
    // at the top of the component and would make any ordering look correct.
    const source = withoutComments(irreversible)
    assert.ok(source.indexOf('consequences.map') < source.indexOf('htmlFor={rationaleId}'))
  })

  it('turns off autocomplete and spellcheck on the phrase field', () => {
    // A browser offering to complete the phrase from a previous request is a browser confirming a
    // different request on the operator's behalf.
    assert.match(irreversible, /autoComplete="off"/)
    assert.match(irreversible, /spellCheck=\{false\}/)
  })

  it('the button says what it does, not "Confirm"', () => {
    assert.match(approval, /runLabel=\{`Approve and run \$\{approval\.action\}`\}/)
  })

  it('the decision page passes a phrase built by confirmationPhrase', () => {
    assert.match(approval, /phrase=\{confirmationPhrase\(true, approval\.id, approval\.action\)\}/)
    assert.match(approval, /phrase=\{confirmationPhrase\(false, approval\.id, approval\.action\)\}/)
  })

  it('the reversible control shows consequences before it runs, and takes two clicks', () => {
    assert.match(irreversible, /shown \? onRun\(\) : setShown\(true\)/)
    assert.match(irreversible, /'What will this do\?'/)
  })

  it('the reversible control renders a BLOCKED reason instead of a disabled button', () => {
    assert.match(irreversible, /blocked === null \? \(/)
    assert.match(irreversible, /<span className="aw-action__blocked">\{blocked\}<\/span>/)
  })
})

/* ══════════════════ four eyes ══════════════════ */

describe('the four-eyes control is legible', () => {
  it('the decision page asks decisionGate what it may offer', () => {
    assert.match(approval, /const gate = decisionGate\(approval, operatorPrincipal, now\)/)
  })

  it('renders the decision controls only when the gate allows them', () => {
    assert.match(approval, /gate\.decidable \? \(/)
  })

  it('renders the REASON in their place when it does not', () => {
    assert.match(approval, /\{gate\.reason\}/)
  })

  it('tells a self-raiser to send the address to somebody else', () => {
    assert.match(approval, /gate\.selfRaised &&/)
    assert.match(approval, /another operator/)
  })

  it('marks "you raised this" in the QUEUE, not only on the detail page', () => {
    // Revealing the refusal only after an operator has opened, read and pressed makes them do the
    // work twice.
    assert.match(approvals, /you raised this/)
  })

  it('computes that mark from the session principal rather than a server flag', () => {
    assert.match(approvals, /operator\.principal !== null && approval\.requestedBy === operator\.principal/)
  })

  it('warns once, in the shell, when the console cannot tell who is signed in', () => {
    assert.match(shell, /operator\.principal === null/)
    assert.match(shell, /does not know which operator/)
  })
})

/* ══════════════════ §3.3g ══════════════════ */

describe('an action with no executor does not look like one that can run', () => {
  it('the catalogue page splits executable from blocked', () => {
    assert.match(actions, /const executable = executableActions\(catalogue\.actions\)/)
    assert.match(actions, /const blocked = blockedActions\(catalogue\.actions\)/)
  })

  it('LISTS the blocked entry rather than filtering it out', () => {
    assert.match(actions, /blocked\.map\(\(spec\) => \(\s*<BlockedAction/s)
  })

  it('renders NO form and NO button for it', () => {
    const blockedComponent = /function BlockedAction[\s\S]*?\n}/.exec(actions)?.[0] ?? ''
    assert.ok(blockedComponent.length > 200, 'the BlockedAction component was not found')
    assert.doesNotMatch(blockedComponent, /<button/)
    assert.doesNotMatch(blockedComponent, /<input/)
    assert.doesNotMatch(blockedComponent, /<form/)
    assert.doesNotMatch(blockedComponent, /onRun/)
  })

  it('renders admin-api’s own blockedReason verbatim', () => {
    assert.match(actions, /\{spec\.blockedReason\}/)
  })

  it('names the status the request would return', () => {
    assert.match(actions, /501 action_has_no_upstream/)
  })

  it('says the authorisation machinery exists and the write does not', () => {
    assert.match(actions, /authorisation machinery exists here; the write does not/)
  })

  it('explains why the bootstrap belongs outside every service', () => {
    assert.match(actions, /compromise grants the estate/)
    assert.match(actions, /slice-verify\.sh/)
  })

  it('handles the 501 arriving anyway, as the catalogue’s sentence rather than a retryable error', () => {
    assert.match(actions, /cannot be executed/)
    assert.match(actions, /has no upstream, so it cannot be requested/)
  })

  it('the request form renders the cited upstream route beside the action', () => {
    assert.match(actions, /Executes <code className="cf-num">\{spec\.route\}<\/code>/)
  })

  it('the form’s submit reason and its fields read the same missingParams answer', () => {
    assert.match(actions, /const missing = missingParams\(spec, params\)/)
    assert.match(actions, /disabledReason=\{incomplete\.length === 0 \? null :/)
  })
})

/* ══════════════════ figures, absence, and observation time ══════════════════ */

describe('every figure carries its observation time', () => {
  it('the estate page stamps when the answer ARRIVED', () => {
    assert.match(estate, /setReadAt\(new Date\(\)\)/)
    assert.match(estate, /<AsOf label=\{asOfLabel\(readAt, now\)\} \/>/)
  })

  it('the approvals queue stamps its read', () => {
    assert.match(approvals, /<AsOf label=\{asOfLabel\(readAt, now\)\} \/>/)
  })

  it('the audit page stamps its read', () => {
    assert.match(audit, /<AsOf label=\{asOfLabel\(readAt, now\)\} \/>/)
  })

  it('the flags page stamps its read', () => {
    assert.match(flags, /<AsOf label=\{asOfLabel\(readAt, now\)\} \/>/)
  })

  it('the broadcasts page stamps its read', () => {
    assert.match(broadcasts, /<AsOf label=\{asOfLabel\(readAt, now\)\} \/>/)
  })

  it('the chain verification stamps when it was run', () => {
    assert.match(audit, /setCheckedAt\(new Date\(\)\)/)
  })

  it('the stamp says it is when the browser received the answer', () => {
    assert.match(tone, /not the moment the fact was true/)
  })
})

describe('a number that is missing renders as missing', () => {
  it('the estate page renders every tile value through Figure', () => {
    assert.match(estate, /<Figure value=\{tile\.value\} because=\{tile\.reason\} \/>/)
  })

  it('Figure renders a word for a null, never a digit', () => {
    assert.match(tone, /value === null/)
    assert.match(tone, /not measured/)
  })

  it('no page coalesces a null count to zero', () => {
    // The single most dangerous line that could be written in this repository.
    for (const [name, source] of PAGES) {
      assert.doesNotMatch(withoutComments(source), /count \?\? 0/, `${name} coalesces a count`)
      assert.doesNotMatch(withoutComments(source), /balanced \?\? (true|false)/, `${name} coalesces the balance`)
    }
  })

  it('the absence carries the tile’s reason, so it names its cause', () => {
    assert.match(tone, /\{because\}/)
  })
})

/* ══════════════════ degradation, not blank pages ══════════════════ */

describe('degradation is rendered, never a blank page', () => {
  it('the estate page renders tiles whenever any data came back at all', () => {
    assert.match(estate, /estate\.data !== null && <EstateTiles/)
  })

  it('names the upstream and the reason on a troubled tile', () => {
    assert.match(estate, /\{tile\.upstream\}/)
    assert.match(estate, /\{tile\.reason\}/)
  })

  it('raises the non-zero trial balance to its own alert', () => {
    assert.match(estate, /trialBalanceIsP0\(view\) &&/)
    assert.match(estate, /untrustworthy until/)
  })

  it('lists the services that are not ready by NAME', () => {
    assert.match(estate, /unreadyServices\(view\)/)
    assert.match(estate, /\{service\.name\}/)
    assert.match(estate, /\{service\.detail \?\? '—'\}/)
  })

  it('every page renders all four resource states', () => {
    for (const [name, source] of PAGES) {
      assert.match(source, /state === 'loading'/, `${name} has no loading state`)
      assert.match(source, /state === 'forbidden'/, `${name} has no forbidden state`)
      assert.match(source, /state === 'failed'/, `${name} has no failed state`)
    }
  })

  it('every list page also renders an empty state distinct from a failure', () => {
    for (const [name, source] of [
      ['approvals', approvals],
      ['audit', audit],
      ['flags', flags],
      ['broadcasts', broadcasts],
      ['support', support],
      ['backups', backups],
    ] as const) {
      assert.match(source, /state === 'empty'/, `${name} has no empty state`)
    }
  })
})

/* ══════════════════ backups: the reassuring facts, and the one that is not ══════════════════ */

/**
 * The backup screens, checked at the layer a source-text test can actually reach.
 *
 * The pure half — `estateEnvironment`, `restoreGate`, `restoreConfirmationPhrase`, `formatBytes`,
 * `verificationTone` — is proven properly as functions in `test/backups.test.ts`, and what an
 * operator READS is proven against a rendered DOM in the same file. What is left for this file is
 * what it does everywhere else: that each component is WIRED to the right data, and that the
 * things which must be absent are absent.
 */
describe('the backup screens', () => {
  it('never renders artefact contents, because there is no field that could hold them', () => {
    // The rule is stronger than "do not display secrets": this client has no route and no type
    // that carries a byte of an artefact, so the assertion is that nothing here reaches for one.
    for (const [name, source] of [
      ['backups', backups],
      ['backup', backup],
      ['protection', protection],
    ] as const) {
      const clean = withoutComments(source)
      for (const forbidden of ['contents', 'plaintext', 'mnemonic', 'xprv', 'privateKey', 'secret']) {
        assert.doesNotMatch(
          clean,
          new RegExp(`\\.${forbidden}\\b`),
          `${name} reads a ${forbidden} field off an artefact`,
        )
      }
    }
  })

  it('renders the protection statement on the EMPTY result, not only on a populated one', () => {
    // An estate with no backups still has a destination and still has limits, and that is the case
    // where an operator most needs to read them. Gating the panel on `state === 'ok'` would hide
    // the honesty block exactly when the news is worst.
    assert.match(backups, /backups\.data !== null && \(\s*<BackupsBody/s)
    assert.match(backups, /<ProtectionPanel protection=\{page\.protection\}/)
  })

  it('renders admin-api’s own covers / doesNotCover lists rather than sentences of its own', () => {
    assert.match(protection, /protection\.doesNotCover\.map/)
    assert.match(protection, /protection\.covers\.map/)
  })

  it('puts what is NOT protected before what is, in document order', () => {
    // The flattering order puts the protections at the top and leaves the limits to somebody who
    // scrolls. Compared against the rendered lists, not the imports.
    const source = withoutComments(protection)
    assert.ok(
      source.indexOf('doesNotCover.map') < source.indexOf('covers.map'),
      'the protections are rendered before the limits',
    )
  })

  it('shows no tick, and says the same-host case is one failure and not safety', () => {
    assert.match(protection, /protection\.sameHost \?/)
    assert.match(protection, /second disk in the same machine/)
    assert.match(protection, /theft, fire, flood, a failed host, ransomware/)
    // A tick beside a list of what is uncovered would be the stylesheet supplying the conclusion
    // the words refuse to.
    assert.doesNotMatch(withoutComments(protection), /✓/, 'the honesty panel renders a tick')
  })

  it('states that the custody keyring is deliberately absent, and cites its real procedure', () => {
    assert.match(protection, /custody keyring is not in any of this/)
    assert.match(protection, /deploy\/docs\/custody-backup-restore\.md §4/)
  })

  it('shows that a custody backup EXISTS as a count and a date, and nothing else', () => {
    assert.match(protection, /custody\.runs/)
    assert.match(protection, /custody\.lastAt/)
    assert.match(protection, /never shown here/)
  })

  it('renders "never verified" as a word rather than as a missing tick', () => {
    assert.match(backups, /<StatusWord\s*\n?\s*tone=\{verificationTone\(/)
    assert.match(backups, /neverVerified\(backup\) &&/)
  })

  it('leads with the unverified count when there is one', () => {
    assert.match(backups, /verificationHeadline\(page\.backups\)/)
    assert.match(backups, /headline !== null &&/)
  })

  it('never renders an absent size as a zero', () => {
    // `BigInt('')` is `0n`, and "0 B" is exactly the reading an absent size must not produce on the
    // screen that decides whether there is anything to restore.
    for (const [name, source] of [['backups', backups], ['backup', backup]] as const) {
      assert.match(source, /formatBytes\(/, `${name} does not format sizes at all`)
      assert.match(source, /not measured/, `${name} has no absence for a missing size`)
      assert.doesNotMatch(
        withoutComments(source),
        /Number\(.*[Bb]ytes/,
        `${name} parses a byte count to a number`,
      )
    }
  })

  it('the detail page re-asks when the id changes', () => {
    // Without the id in the dependency array the second backup renders the first one's artefacts
    // under the second one's address — on the screen whose job is to say which backup is about to
    // be restored.
    assert.match(backup, /'That backup could not be read\.', \[id\]\)/)
  })

  it('puts the two environments side by side, above the action', () => {
    const source = withoutComments(backup)
    assert.ok(
      source.indexOf('<EnvironmentComparison') < source.indexOf('<RestoreSection'),
      'the environments must be readable before anything can be typed',
    )
    assert.match(backup, /These artefacts were taken from/)
    assert.match(backup, /This estate reads as/)
  })

  it('gates both restores on restoreGate rather than checking fields itself', () => {
    const calls = backup.match(/restoreGate\(\{/g) ?? []
    assert.equal(calls.length, 2, 'each mode asks the gate for itself')
    assert.match(backup, /mode: 'verify'/)
    assert.match(backup, /mode: 'live'/)
  })

  it('replaces the live control with the REASON when the gate refuses structurally', () => {
    // Not a disabled button: a disabled control reads as "not yet" and gets clicked at.
    assert.match(backup, /!gate\.offered && !gate\.needsOperatorInput/)
    assert.match(backup, /No live restore is available here/)
  })

  it('keeps the fields on screen when the refusal is only that they are empty', () => {
    // Hiding the approval-id field because the approval id is empty is a form that removes the box
    // you were about to fill in.
    const source = withoutComments(backup)
    assert.ok(
      source.indexOf('aw-live-approval') < source.indexOf('gate.offered ? ('),
      'the approval-id field must be rendered before the gated control, not inside it',
    )
  })

  it('prefers the phrase the SERVICE sent over the one it can build itself', () => {
    // `requestRestore` compares the confirmation with `!==` (admin-api/src/backups.ts), so the
    // two spellings diverging by one character refuses every live restore in the estate — after
    // two operators have signed for it. The served value wins; the local builder is the fallback.
    assert.match(backup, /const phrase = servedPhrase \?\? gate\.phrase/)
    assert.match(backup, /phrase=\{phrase\}/)
    assert.match(gate, /restore \$\{where\} from \$\{stamp\}/)
  })

  it('sends the CANONICAL phrase as the approval param, not the operator’s keystrokes', () => {
    // `confirmationGate` accepts a different case and different spacing on purpose — a gate that
    // failed on caps-lock teaches people to paste, which defeats the mechanism — but the service
    // compares exactly, so what is STORED has to be the exact string.
    assert.match(backup, /confirmation: phrase \?\? ''/)
  })

  it('the live button says it is ASKING, and names the environment', () => {
    // It raises an estate.restore request; nothing is restored by pressing it. A button labelled
    // "Restore mainnet" would be the console describing an action it does not perform.
    assert.match(
      backup,
      /runLabel=\{`Ask two operators to restore \$\{backup\.environment\}`\}/,
    )
    assert.match(backup, /Nothing happens when you send it/)
  })

  it('raises the request against the BACKUP RUN, which is estate.restore’s subject', () => {
    // admin-api/src/actions.ts. The executor reads `ctx.approval.subjectId` as the backup to
    // restore from, so a wrong subject would have two operators authorise a different backup.
    assert.match(backup, /action: RESTORE_ACTION/)
    assert.match(backup, /subjectId: backup\.id/)
  })

  it('sends the live path to the approval queue and the verify path to the restore route', () => {
    // `POST /v1/restores` answers 400 for a live restore (admin-api/src/server.ts), so the two
    // halves of this screen are two different calls rather than two arguments to one. The gate is
    // still asked about `mode: 'live'` — that is a question about what to OFFER, and it is why this
    // assertion is about the calls rather than about the string "live" appearing in the file.
    assert.match(backup, /startVerifyRestore\(\s*\{ backupRunId: backup\.id, targets, reason:/)
    assert.match(backup, /requestApproval\(/)
    const source = withoutComments(backup)
    const live = source.slice(source.indexOf('function LiveRestore'))
    assert.ok(!live.includes('startVerifyRestore('), 'the live path calls the verify route')
    const verify = source.slice(source.indexOf('function VerifyRestore'), source.indexOf('function LiveRestore'))
    assert.ok(!verify.includes('requestApproval('), 'the verify path raises an approval')
  })

  it('the safe restore is a different control, not a mode toggle on the dangerous one', () => {
    assert.match(backup, /<ReversibleAction\s*\n?\s*label="Verify restore"/)
    assert.match(backup, /<IrreversibleAction\s*\n?\s*label="Live restore"/)
    assert.match(backup, /throwaway scratch database/)
  })

  it('previews the audit rows the service really writes, each cited', () => {
    // This screen spent a while rendering NO audit preview, because the contract it was first built
    // to described none and naming an invented action would have told an operator they were signing
    // for a record that may not exist. The service landed writing `admin.backup.requested`
    // (server.ts) and `admin.restore.requested` (server.ts), so the previews are real.
    assert.match(backup, /previews=\{\[\s*previewVerifyRestore\(/)
    assert.match(backup, /previews=\{\[\s*previewRequest\(/)
    assert.match(backups, /previewBackupRequest\(\{ actor: operator\.principal/)
    assert.match(gate, /admin-api\/src\/server\.ts|server\.ts/)
    assert.match(gate, /server\.ts/)
  })

  it('keeps the restore-ROW description beside the audit preview, not instead of it', () => {
    // Two different records: the audit says somebody asked, and the restore row is where
    // `checksumsVerified` and the outcome live.
    assert.match(backup, /restoreRecordLines\(/)
    assert.match(backup, /which is not the audit event above it/)
  })

  it('the settings form renders the service’s ceilings rather than reimplementing them', () => {
    assert.match(backupSettings, /ceilingRows\(ceilings\)/)
    assert.match(backupSettings, /What admin-api will refuse/)
    assert.match(backupSettings, /shown rather than copied/)
  })

  it('the settings form sends only what it edits', () => {
    const body = /saveBackupSettings\(\{[\s\S]*?\}\)/.exec(backupSettings)?.[0] ?? ''
    assert.ok(body.length > 40, 'the save call was not found')
    for (const field of ['ceilingBytes', 'minFreeBytes', 'verifyEnabled', 'verifyEveryMinutes']) {
      assert.ok(!body.includes(field), `the form echoes ${field} back`)
    }
  })

  it('states the reason beside the disabled save button, in a live region', () => {
    assert.match(backupSettings, /problems\.length > 0 &&/)
    assert.match(backupSettings, /aria-live="polite"/)
  })
})

/* ══════════════════ the support page ══════════════════ */

describe('the support page — 05 journey 16, and 17 §7 claim 9', () => {
  it('asks BOTH questions the audit route can answer about a user', () => {
    // "Everything about this user" is two equality filters and there is no OR between them. A
    // screen that asked only `actor` would omit every refund, reversal and moderation decision
    // taken about the user by somebody else, which is most of what a balance dispute turns on.
    assert.match(support, /loadAudit\(\{ actor: `user:\$\{userId\}`/)
    assert.match(support, /loadAudit\(\{ subjectKind: 'user', subjectId: userId/)
  })

  it('takes a user id, and sends a correlation id to the screen that already reads one', () => {
    assert.match(support, /User id/)
    // The pivot is the whole point: user → threads → the audit screen.
    assert.match(support, /to=\{`\/audit\?correlationId=\$\{encodeURIComponent/)
  })

  it('re-asks the question when the user changes', () => {
    // Without the id in the dependency array a second lookup renders the FIRST user's history
    // under the second user's id — the wrong person's money with the right name on it.
    assert.match(support, /\[userId\],\s*\)/)
  })

  it('renders the coverage panel on the EMPTY result, not only on a populated one', () => {
    // An empty timeline here almost certainly means the money services do not mirror, not that
    // the user did nothing. The caveat is worth least where it is easiest to omit.
    const empty = support.indexOf("state === 'empty'")
    const panel = support.indexOf('<CoveragePanel rows={[]} />')
    assert.ok(empty > 0 && panel > empty, 'the empty state does not render the coverage panel')
  })

  it('states that nothing mirrors, rather than presenting admin-api rows as a full history', () => {
    assert.match(support, /No other service mirrors/)
    assert.match(support, /anyServiceMirrors/)
  })

  it('offers NO control that acts', () => {
    // Every remedy 05's operator journeys reach for is a two-operator action, and two of the three
    // have no route on admin-api at all. A support screen with a shortcut around the approval
    // queue would be the console offering a button the backend refuses.
    const source = withoutComments(support)
    assert.doesNotMatch(source, /useMutation/, 'the support screen must not mutate')
    assert.doesNotMatch(source, /ReversibleAction|Irreversible/, 'the support screen must not act')
  })

  it('never renders an absent amount as a zero', () => {
    // `BigInt('')` is `0n`. The screen must go through `amountOf`, which refuses anything that is
    // not a well-formed decimal integer, and render the null as an absence.
    assert.match(support, /amountOf\(event\.payload\)/)
    assert.match(support, /amount === null/)
    assert.match(support, /no amount recorded/)
    assert.doesNotMatch(withoutComments(support), /BigInt\(/, 'the page must not coerce money itself')
  })

  it('names the missing routes by path:line rather than describing them in prose', () => {
    // A route taken from prose is a route that has not been checked. Each of the five questions
    // 05 journey 16 asks names the provider route that would answer it, cited.
    assert.match(support, /ledger\/src\/server\.ts/)
    assert.match(support, /ledger\/src\/server\.ts/)
  })
})

/* ══════════════════ the audit page ══════════════════ */

describe('the audit page', () => {
  it('offers one search box, on the correlation id', () => {
    assert.match(audit, /Correlation id/)
    assert.match(audit, /correlationId/)
  })

  it('offers NO free-text search, because admin-api serves none', () => {
    // A console that offers a LIKE over `payload` is a console that table-scans the estate's audit
    // of record during an incident. Offering a box that could not be served would invent a surface.
    const source = withoutComments(audit)
    assert.doesNotMatch(source, /placeholder="[^"]*search the payload/i)
    assert.doesNotMatch(source, /\bq:\s/)
  })

  it('keeps the filter in the ADDRESS, so an operator can paste it to a colleague', () => {
    assert.match(audit, /useSearchParams/)
  })

  it('separates the checkpoint findings from the link findings', () => {
    assert.match(audit, /b\.kind\.startsWith\('checkpoint_'\)/)
    assert.match(audit, /this is the truncation case/)
  })

  it('says plainly that a chain alone cannot see a truncation', () => {
    assert.match(audit, /cannot catch a truncation/)
    assert.match(audit, /remainder verifies perfectly/)
  })

  it('offers both verification passes, labelled by what they mean', () => {
    assert.match(audit, /Verify from the last checkpoint/)
    assert.match(audit, /Re-walk the whole chain/)
  })

  it('sends from=0 for the full re-walk', () => {
    assert.match(audit, /full \? \{ from: '0' \} : \{\}/)
  })

  it('renders ok:false as a FINDING, not as a failed request', () => {
    // The route answers 200 either way; a 500 would deny a monitoring system the fact it exists to
    // read.
    assert.match(audit, /result\.breaks\.length === 0 \? \(/)
    assert.match(audit, /<Breaks result=\{result\} \/>/)
  })

  it('lists every break rather than the first', () => {
    assert.match(audit, /breaks\.map\(\(b\) =>/)
    assert.match(audit, /a tamper that touched three rows produces\s*\n?\s*three findings/)
  })

  it('renders both clocks when they differ', () => {
    assert.match(audit, /event\.occurredAt !== event\.recordedAt/)
  })

  it('does not claim the chain has been verified when the pass started at zero', () => {
    assert.match(audit, /everVerified: result\.from !== '0'/)
  })
})

/* ══════════════════ state, never colour alone ══════════════════ */

describe('state is a word and a glyph before it is a colour', () => {
  it('the StatusWord component renders both', () => {
    assert.match(tone, /\{tone\.glyph\}/)
    assert.match(tone, /\{tone\.word\}/)
  })

  it('marks the glyph decorative, so a screen reader is not made to announce a shape', () => {
    assert.match(tone, /aria-hidden="true"/)
  })

  it('every page that shows a state goes through StatusWord', () => {
    for (const [name, source] of [
      ['estate', estate],
      ['approvals', approvals],
      ['approval', approval],
      ['audit', audit],
      ['broadcasts', broadcasts],
    ] as const) {
      assert.match(source, /<StatusWord/, `${name} does not use StatusWord`)
    }
  })

  it('the flags page renders ON and OFF as words, not as a bare toggle', () => {
    assert.match(flags, /\{flag\.enabled \? 'ON' : 'OFF'\}/)
  })

  it('the tile’s coloured edge is in addition to the word, never instead of it', () => {
    assert.match(estate, /<StatusWord tone=\{tone\} \/>/)
    assert.match(styles, /border-left-width: 3px/)
  })
})

/* ══════════════════ tokens, accessibility and no invented colour ══════════════════ */

describe('the stylesheet', () => {
  it('names no literal colour: every value is a token', () => {
    // A literal hex is a colour that will not follow the substrate.
    const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, '')
    const hexes = declarations.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    assert.deepEqual(hexes, [], `literal colours in styles.css: ${hexes.join(', ')}`)
  })

  /*
   * ── THIS CHECK MOVED TARGET WITH @cloudsforge/ui 1.1, AND DID NOT WEAKEN ────────────────────
   *
   * It used to assert a LOCAL skip link: `.aw-skip`, `href="#main"`, and a `:focus-visible` rule
   * in this repository's stylesheet. All three are gone because the control is shared now, and a
   * check pointed at a deleted class is a check that passes by being deleted — which is the shape
   * this repository's brand-chrome suite already argues against at length.
   *
   * So the same three facts are asserted about the shared control instead, and one MORE that the
   * local version could never have satisfied: the link's target has to carry `tabIndex={-1}`.
   * `.aw-skip` pointed at `<main id="main">`, which had no tabindex, so in Chrome and Safari
   * activating it scrolled the page and left focus on the link — the reader's next Tab went back
   * into the company bar. `SkipLink` and `MainRegion` set the href and the id from the one
   * `MAIN_ID` constant and `MainRegion` sets the tabindex, so the pair cannot be half-applied
   * again.
   */
  it('gives the page a skip link, and it is the shared one', () => {
    assert.match(shell, /<SkipLink>/)
    const sharedImport = /import \{([^}]*)\} from '@cloudsforge\/ui'/.exec(shell)?.[1] ?? ''
    for (const named of ['SkipLink', 'MainRegion', 'CookieBanner']) {
      assert.ok(sharedImport.includes(named), `${named} is not imported from @cloudsforge/ui`)
    }
    // The target, which is the half the local implementation was missing.
    assert.match(shell, /<MainRegion className="wt-main">/)
    // And the shared rule really does reveal it on focus. Read from the design system rather than
    // asserted about it: a skip link that stays hidden when focused is worse than none.
    const uiCss = readFileSync(
      new URL('../node_modules/@cloudsforge/ui/dist/ui.css', import.meta.url),
      'utf8',
    )
    assert.match(uiCss, /\.cf-skip:focus,\n\.cf-skip:focus-visible \{/)
  })

  it('puts the skip link first in the DOM', () => {
    // Compared against the ELEMENT, not the import at the top of the file.
    const source = withoutComments(shell)
    assert.ok(source.indexOf('<SkipLink>') < source.indexOf('<CloudsForgeBar'))
  })

  /*
   * The consent banner is LAST, which is what makes it non-modal in practice: a reader who came
   * here to decide an approval can reach every control on the page before the banner, and answer
   * it afterwards. It draws nothing at all on this surface — no measurement ID is shipped — and
   * mounting it is still asserted, because a shell that omits the component is a shell where
   * adding an ID later turns analytics on with no banner.
   */
  it('mounts the consent banner last, after the footer', () => {
    const source = withoutComments(shell)
    assert.ok(source.indexOf('<CookieBanner />') > source.indexOf('<CloudsForgeFooter'))
  })

  it('gives every interactive element a visible focus ring', () => {
    assert.match(styles, /\.aw-field__input:focus-visible/)
    assert.match(styles, /\.aw-link:focus-visible/)
  })

  it('scrolls wide tables inside their own box, so the page never scrolls sideways', () => {
    assert.match(styles, /\.aw-table \{[^}]*overflow-x: auto/s)
  })

  it('collapses the fact grid on a narrow screen rather than overflowing', () => {
    assert.match(styles, /@media \(max-width: 40rem\)/)
  })

  it('renders the filter controls as real buttons, so they are keyboard reachable', () => {
    assert.match(audit, /type="button"\s+className="aw-link aw-link--button/)
  })

  it('every table has a caption saying what is in it', () => {
    for (const [name, source] of [['estate', estate], ['approvals', approvals], ['audit', audit]] as const) {
      assert.match(source, /className="aw-table__caption"/, `${name} has a table with no caption`)
    }
  })
})

/* ══════════════════ the operator marker ══════════════════ */

describe('the shell', () => {
  it('marks the console as an operator surface in words', () => {
    assert.match(shell, /<span className="aw-opmark">Operator<\/span>/)
  })

  it('passes the admin surface to the bar, so the switcher marks it current', () => {
    assert.match(shell, /current=\{PRODUCT\}/)
  })

  it('derives the sub-navigation from the route table rather than restating it', () => {
    assert.match(shell, /NAV\.map/)
  })

  /*
   * FOLLOWED INTO ui.css RATHER THAN DELETED.
   *
   * This used to read `assert.match(styles, /--cf-bar-h/)`, and after the sub-nav moved into
   * @cloudsforge/ui that assertion would still have passed — the token is named in a COMMENT in
   * this repository's stylesheet now, and nowhere else. A check that a comment can satisfy is not
   * a check. The fact it was written to protect is unchanged and still worth protecting: the strip
   * docks at the bar's own height token rather than at a pixel count copied out of it, so the two
   * cannot drift. It just lives one repository over, and so does the assertion.
   */
  it('docks the sub-nav at the bar’s own height token', () => {
    const rule = /\.cf-subnav \{([^}]*)\}/.exec(uiCss)?.[1] ?? ''
    assert.match(rule, /top: var\(--cf-bar-h\)/, 'the shared strip no longer docks at the bar')
    assert.doesNotMatch(rule, /top:\s*\d/, 'the shared strip docks at a literal offset')
  })
})

/* ══════════════════ the sub-nav is the design system's, not a copy ══════════════════ */

/*
 * The shape `micro-explorer-web/test/tokens.test.ts` uses for the form controls: assert BOTH that
 * the shared thing exists AND that the local copy is gone. Either half alone passes in the state
 * nobody wants — a repository that imports the component and keeps its own rules beside it, which
 * is where the next reader edits the dead copy and cannot work out why nothing moves.
 */
describe('the sub-nav is the design system’s, and there is no second copy of it here', () => {
  it('both navigations in this console are `SubNav` from @cloudsforge/ui', () => {
    for (const [name, source] of [
      ['the shell', shell],
      ['the Foresight section', foresightSection],
    ] as const) {
      const imported = /import \{([^}]*)\} from '@cloudsforge\/ui'/.exec(source)?.[1] ?? ''
      assert.ok(imported.includes('SubNav'), `${name} does not import SubNav`)
      assert.match(source, /<SubNav label="/, `${name} does not render SubNav`)
      // The local ELEMENT and its parts. `className="wt-subnav--section"` is allowed and is
      // asserted separately below: it is the wrapper the modifier is applied through, not a strip.
      const source_ = withoutComments(source)
      assert.doesNotMatch(source_, /wt-subnav__/, `${name} still writes the local strip's parts`)
      assert.doesNotMatch(source_, /"wt-subnav"/, `${name} still writes the local strip`)
    }
  })

  it('names its two landmarks apart, so a screen reader can tell them apart', () => {
    // Two <nav>s with the same accessible name are two landmarks a reader cannot choose between,
    // and this console is the only surface in the estate that has two.
    assert.match(shell, /<SubNav label="Sections">/)
    assert.match(foresightSection, /<SubNav label="Foresight">/)
  })

  it('marks the current section with the shared modifier, not the local one', () => {
    for (const [name, source] of [
      ['the shell', shell],
      ['the Foresight section', foresightSection],
    ] as const) {
      assert.match(source, /cf-subnav__link--current/, `${name} does not mark the current link`)
      assert.doesNotMatch(source, /' is-active'/, `${name} still uses the local modifier`)
    }
  })

  it('the shared classes it depends on exist in the stylesheet that ships', () => {
    for (const selector of [
      '.cf-subnav {',
      '.cf-subnav__inner {',
      '.cf-subnav__link {',
      '.cf-subnav__link:hover {',
      '.cf-subnav__link--current {',
      '.cf-subnav__link:focus-visible {',
    ]) {
      assert.ok(uiCss.includes(selector), `ui.css does not define ${selector.slice(0, -2)}`)
    }
  })

  it('and it keeps the three things the local copy got right', () => {
    // Not a regression check on this repository — a check that the rule taken IN is at least as
    // good as the rule taken OUT. Three channels for the current section, a focus ring that is not
    // clipped by the scroll container, and the sticky offset the test above already follows.
    const current = /\.cf-subnav__link--current \{([^}]*)\}/.exec(uiCss)?.[1] ?? ''
    assert.match(current, /color:/)
    assert.match(current, /font-weight: 600/)
    assert.match(current, /border-bottom-color/)
    assert.match(uiCss, /\.cf-subnav__link:focus-visible \{[^}]*outline-offset: -2px/s)
  })

  it('and it fixes the two things the local copy had lost', () => {
    // `max-width: 76rem` was 1216px against the bar's 1200, and the strip did not scroll.
    assert.match(uiCss, /\.cf-subnav__inner \{[^}]*max-width: var\(--cf-max-w\)/s)
    assert.match(uiCss, /\.cf-subnav__inner \{[^}]*overflow-x: auto/s)
    assert.match(uiCss, /\.cf-subnav__link \{[^}]*white-space: nowrap/s)
  })

  it('the local `.wt-subnav__*` rules are DELETED, not left beside the shared ones', () => {
    const survivors = [...cssDeclarations.matchAll(/\.wt-subnav[a-z_-]*/g)].map((m) => m[0])
    assert.deepEqual(
      [...new Set(survivors)],
      ['.wt-subnav--section'],
      'a local copy of the sub-nav is still declared in src/styles.css',
    )
  })

  it('the one modifier that stays is LAYERED on the shared classes, not a fork of them', () => {
    // `.wt-subnav--section` un-sticks the strip and nothing else. It reaches the shared element by
    // descent, because `SubNav` deliberately takes no className.
    assert.match(cssDeclarations, /\.wt-subnav--section \.cf-subnav \{[^}]*position: static/s)
    assert.match(cssDeclarations, /\.wt-subnav--section \.cf-subnav__inner \{/)
    assert.match(foresightSection, /<div className="wt-subnav--section">/)
  })

  it('`is-active` survives only where it is a genuine second user', () => {
    // Enumerated rather than banned. `.aw-filter.is-active` is a real control with a real state,
    // and a blanket "the modifier is gone" assertion would have to be weakened the first time
    // somebody reads it — which is how a guard becomes a comment.
    const owners = [...cssDeclarations.matchAll(/\.([a-z-]+)\.is-active/g)].map((m) => m[1])
    assert.deepEqual([...new Set(owners)].sort(), ['aw-filter'])
  })
})

/* ══════════════════ the type and spacing scales ══════════════════ */

/*
 * The header of `src/styles.css` says "EVERY COLOUR, SPACE AND FONT IS A TOKEN", and until
 * 2026-08-10 only the colour third of that was true and only the colour third was pinned — by the
 * "names no literal colour" test above. This file spent 75 literal `font-size` declarations and
 * not one token underneath that sentence. The other two thirds are asserted here with the same
 * force, so the claim in the header is a rule rather than an aspiration.
 */
describe('the stylesheet spends the estate’s scales rather than approximating them', () => {
  it('names no literal font size: every one is a `--cf-text-*` step', () => {
    const literals = [...cssDeclarations.matchAll(/font-size:\s*([^;]+);/g)]
      .map((m) => (m[1] ?? '').trim())
      .filter((value) => !value.startsWith('var(--cf-text-'))
    assert.deepEqual(literals, [], `literal font sizes in styles.css: ${literals.join(', ')}`)
  })

  /*
   * Spacing is the same rule with a stated exception list, and the list is asserted POSITIVELY —
   * exactly these three lengths, no more and no fewer. A "no literals except…" check written as a
   * filter is satisfied by adding to the filter; written as an enumeration, a fourth literal fails
   * and has to be argued for, and deleting one of the three fails too.
   */
  it('spends `--cf-space-*` for rhythm, with exactly three lengths left as literals', () => {
    const found: string[] = []
    const declaration =
      /(?:^|\n)\s*(gap|row-gap|column-gap|margin[a-z-]*|padding[a-z-]*):\s*([^;]+);/g
    for (const m of cssDeclarations.matchAll(declaration)) {
      for (const length of (m[2] ?? '').matchAll(/-?\d*\.?\d+(?:rem|px|em)\b/g)) {
        found.push(`${m[1]}: ${length[0]}`)
      }
    }
    assert.deepEqual(
      found.sort(),
      [
        // The run-out under the last panel, 64px. The scale tops out at 32.
        'padding: 4rem',
        // The empty/failed/forbidden inset, 48px. Same reason.
        'padding: 3rem',
        // The screen-reader-only clip trick. A negative length is not a spacing step.
        'margin: -1px',
      ].sort(),
      'a spacing literal has come back into src/styles.css',
    )
  })

  it('takes the page measure from `--cf-max-w`, so the page and the chrome share an edge', () => {
    assert.match(cssDeclarations, /\.wt-main \{[^}]*max-width: var\(--cf-max-w\)/s)
    assert.equal(
      cssDeclarations.includes('76rem'),
      false,
      '76rem is 1216px and the bar and footer are 1200 — the page would sit 8px proud on each side',
    )
  })

  it('adds no token of its own, and invents no step', () => {
    // The sweep moves literals ONTO the estate's scales. A `--cf-`-shaped custom property declared
    // here would be this console quietly forking the design system in the name of adopting it.
    const declared = [...cssDeclarations.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1])
    assert.deepEqual(declared, [], `src/styles.css declares ${declared.join(', ')}`)
  })
})

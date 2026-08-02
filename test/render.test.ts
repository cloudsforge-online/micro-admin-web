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
const irreversible = read('src/components/irreversible.tsx')
const auditPreview = read('src/components/audit-preview.tsx')
const tone = read('src/components/tone.tsx')
const shell = read('src/components/shell.tsx')
const styles = read('src/styles.css')

const PAGES: ReadonlyArray<[string, string]> = [
  ['estate', estate],
  ['approvals', approvals],
  ['approval', approval],
  ['actions', actions],
  ['audit', audit],
  ['flags', flags],
  ['broadcasts', broadcasts],
  ['support', support],
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
    ] as const) {
      assert.match(source, /state === 'empty'/, `${name} has no empty state`)
    }
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
    assert.match(support, /ledger\/src\/server\.ts:499/)
    assert.match(support, /ledger\/src\/server\.ts:369/)
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

  it('gives the page a skip link', () => {
    assert.match(shell, /className="aw-skip"/)
    assert.match(shell, /href="#main"/)
    assert.match(styles, /\.aw-skip:focus-visible/)
  })

  it('puts the skip link first in the DOM', () => {
    // Compared against the ELEMENT, not the import at the top of the file.
    const source = withoutComments(shell)
    assert.ok(source.indexOf('aw-skip') < source.indexOf('<CloudsForgeBar'))
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

  it('docks the sub-nav at the bar’s own height token', () => {
    assert.match(styles, /--cf-bar-h/)
  })
})

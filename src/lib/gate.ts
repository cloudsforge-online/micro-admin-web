/**
 * The gates in front of an operator action, and the audit row each one will write.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THREE THINGS THIS FILE EXISTS TO MAKE TRUE.
 *
 * **1. The irreversible action is legible, not fast.** Everything else in a console should get
 * out of the way. A decision on an approval must not: granting one runs a ledger reversal, a
 * marketplace case resolution or an entitlement revocation against a real upstream, and
 * `admin-api` does not roll it back if it fails (server.ts). Rejecting one is terminal —
 * `decide()` refuses any transition out of a decided state (approvals.ts). So the shape
 * is: the consequence in SENTENCES, then the facts the decision turns on, then a rationale, then
 * a phrase the operator writes out naming the request AND the outcome. Never "Are you sure?" —
 * that question has never once been answered "no" by somebody about to make a mistake, because
 * the person about to make a mistake believes they are sure.
 *
 * **2. The four-eyes control is legible, not merely obeyed.** `admin-api` enforces it three
 * times — the route (`SelfApprovalError`, approvals.ts), the UPDATE's `and requested_by <>
 * ${operator}` (approvals.ts), and the `approvals_no_self_approval` CHECK constraint. A
 * console that simply let the operator press the button and read the 403 has obeyed the rule and
 * taught them nothing. So the control is replaced by a sentence naming who raised it and what has
 * to happen next.
 *
 * **3. The operator sees what will be recorded before they act.** Every action on this surface
 * writes a hash-chained audit row in the same transaction as the change (SD-15), and the audit is
 * the point of the surface. `auditPreview` reproduces the row `admin-api` will write — actor,
 * action, subject, outcome, reason code — from the same fields the service reads, so an operator
 * signs for a record they have seen rather than one they will find later.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Everything here is a pure function, so `test/gate.test.ts` proves every refusal in every
 * direction without rendering anything.
 */
import type { Approval, ApprovalState, BackupRun, RestoreMode } from './admin.ts'
import { utcSecondStamp } from './format.ts'

/* ══════════════════════════════ the confirmation phrase ══════════════════════════════ */

/**
 * The phrase an operator must write out before a decision will be sent.
 *
 * It names the REQUEST and the OUTCOME, because those are the two facts a misclick gets wrong. A
 * checkbox or a second button confirms that a hand moved; writing "approve 3f2a1b9c
 * ledger.entry.reverse" confirms that a person read which request and which way they are about to
 * decide it.
 *
 * The request is identified by the first eight characters of its uuid — long enough that two rows
 * in one queue will not collide, short enough to be typed without a mistake that reads as a
 * refusal to confirm. The ACTION NAME is in the approve phrase and not the reject phrase on
 * purpose: approving is what causes an upstream write, and the action name is the fact an
 * operator most needs to have read before it happens.
 */
export function confirmationPhrase(grant: boolean, approvalId: string, action: string): string {
  const short = approvalId.slice(0, 8)
  return grant ? `approve ${short} ${action}` : `reject ${short}`
}

export interface GateInput {
  /** What the operator typed into the confirmation field. */
  readonly typed: string
  /** The phrase they were asked for. */
  readonly required: string
  /** The rationale. Recorded as the decision note; this console requires it either way. */
  readonly rationale: string
  /** True while a request for this action is in flight. */
  readonly busy?: boolean
}

export interface GateResult {
  readonly ready: boolean
  /** Why not, in the operator's words. Null when ready. */
  readonly reason: string | null
}

/**
 * May the irreversible action run?
 *
 * Comparison is trimmed, whitespace-collapsed and case-insensitive. The guard is that the
 * operator wrote THE RIGHT REQUEST AND THE RIGHT OUTCOME — a caps-lock key is not evidence of
 * anything, and a gate that fails on it teaches people to copy and paste the phrase, which
 * defeats the entire mechanism.
 *
 * `busy` is checked FIRST and is not cosmetic. A double click that fires two decisions is exactly
 * the shape the service's `Idempotency-Key` exists to survive, and surviving it is not a reason
 * to cause it — the second request would either replay (200, no second execution) or, with a
 * fresh key, be refused as `state_conflict`. Neither is a thing an operator should have to read.
 */
export function confirmationGate(input: GateInput): GateResult {
  if (input.busy === true) return { ready: false, reason: 'this decision is already being sent' }
  if (input.rationale.trim().length === 0) {
    return {
      ready: false,
      reason:
        'say what this decision is based on — it is written into the audit row, and it is what ' +
        'anyone reading this in six months will have',
    }
  }
  if (normalise(input.typed) !== normalise(input.required)) {
    return { ready: false, reason: `type “${input.required}” to confirm` }
  }
  return { ready: true, reason: null }
}

function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/* ══════════════════════════════ four eyes, and the other refusals ══════════════════════════════ */

export interface DecisionGate {
  /** True when this console may offer a decision control at all. */
  readonly decidable: boolean
  /** Why not, in the operator's words. Null when decidable. */
  readonly reason: string | null
  /** The operator signed in raised this request. The single most important reason of the four. */
  readonly selfRaised: boolean
  /** Past its deadline, whatever the stored state still says. */
  readonly pastDeadline: boolean
  /** The console could not establish which principal is signed in. */
  readonly unknownOperator: boolean
}

/**
 * May THIS operator decide THIS request, now?
 *
 * The order of the checks is the order an operator would ask the questions, and each answer is
 * different enough to be worth its own sentence.
 *
 * ── Why `pastDeadline` is computed here rather than read off `state` ──────────────────────────
 *
 * An approval expires when its deadline passes, but the ROW only says `expired` once the leased
 * job has run (`expirePending`, approvals.ts). Between the deadline and the sweep the row
 * still reads `pending` and `decide()` will answer 409 (approvals.ts). A console that
 * trusted `state` alone would offer a live-looking Approve button for a request that cannot be
 * approved — so the deadline is compared against a clock the caller passes in.
 *
 * The clock is a parameter and never `new Date()` inside this function, so the test can hold it
 * still. `expiresAt` is the SERVICE's timestamp; the browser's clock may be wrong, and that is a
 * real limitation rather than a hidden one — the console shows the deadline itself beside the
 * verdict so an operator with a skewed clock can see the disagreement.
 *
 * ── Why an unknown operator is not a refusal ──────────────────────────────────────────────────
 *
 * `/auth/me` is allowed to fail quietly (see auth.tsx): an unreachable account service must not
 * sign an operator out mid-incident. When it has failed, this console does not know which
 * principal is signed in — and REFUSING then would block a legitimate approver on the strength of
 * a guess. So the control is offered with the four-eyes rule stated, and `admin-api` remains the
 * thing that actually refuses. The console is honest about which of the two is talking.
 */
export function decisionGate(
  approval: Approval,
  operatorPrincipal: string | null,
  now: Date,
): DecisionGate {
  const selfRaised = operatorPrincipal !== null && approval.requestedBy === operatorPrincipal
  const expiresAt = Date.parse(approval.expiresAt)
  const pastDeadline = Number.isFinite(expiresAt) && expiresAt <= now.getTime()
  const unknownOperator = operatorPrincipal === null

  if (approval.state !== 'pending') {
    return {
      decidable: false,
      reason: alreadyDecided(approval),
      selfRaised,
      pastDeadline,
      unknownOperator,
    }
  }
  if (selfRaised) {
    return {
      decidable: false,
      reason:
        'You raised this request, so you cannot decide it. Two operators are required, and the ' +
        'second one has to be somebody else — admin-api refuses this at the route, in the UPDATE ' +
        'and at a database constraint.',
      selfRaised,
      pastDeadline,
      unknownOperator,
    }
  }
  if (pastDeadline) {
    return {
      decidable: false,
      reason:
        'This request passed its deadline and can no longer be decided. It is still listed as ' +
        'pending because the expiry job has not swept it yet; admin-api will refuse a decision ' +
        'either way. Raise it again if it is still needed — an approval is consent to an action ' +
        'in a context, and the context does not keep.',
      selfRaised,
      pastDeadline,
      unknownOperator,
    }
  }
  return { decidable: true, reason: null, selfRaised, pastDeadline, unknownOperator }
}

function alreadyDecided(approval: Approval): string {
  const who = approval.decidedBy ?? 'nobody'
  const states: Readonly<Record<ApprovalState, string>> = {
    pending: 'pending',
    approved: `already approved by ${who}`,
    rejected: `already rejected by ${who}`,
    expired: 'expired: no second operator answered before the deadline, so nobody decided it',
  }
  return `This request is ${states[approval.state]}. A decision is made once.`
}

/* ══════════════════════════════ restoring over live data ══════════════════════════════ */

/**
 * The phrase an operator must write out before a LIVE restore will be sent.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS ONE IS NOT THIS CONSOLE'S INVENTION. THE SERVICE COMPARES IT WITH `!==`.
 *
 * `confirmationPhrase` above is a client-side ceremony: `admin-api` never sees it, and its exact
 * words are this console's choice. This is the opposite. A live restore's `confirmation` must
 * equal, exactly,
 *
 *     restore <environment> from <the backup's queuedAt as YYYY-MM-DDTHH:MM:SSZ>
 *
 * and `requestRestore` compares it with `!==` (admin-api/src/backups.ts). Getting the format
 * wrong is not a cosmetic bug — it is every live restore in the estate being refused, discovered
 * during the incident that made somebody need one.
 *
 * **So this is the FALLBACK, not the source.** `GET /v1/backups/:id` serves the phrase the service
 * itself will compare (`expectedConfirmation`, server.ts), and the screen uses that. This
 * function reproduces it from the same fields — `utcSecondStamp` matches the service's own
 * `toISOString().slice(0, 19) + 'Z'` — so a response without the field still yields a usable
 * phrase, and `test/backups.test.ts` pins the spelling against the service's.
 *
 * ── Why the operator types it rather than confirming it ───────────────────────────────────────
 *
 * Because it names the three facts a mistaken restore gets wrong: WHAT is being restored, FROM
 * WHEN, and INTO WHICH ESTATE. "restore mainnet from 2026-08-04T12:00:00Z" cannot be written by
 * somebody who has not read which environment and which backup — and the environment is the word
 * that stands between a rehearsal on testnet and overwriting customer balances.
 *
 * Null when the environment is blank or the timestamp will not parse. The caller must then refuse
 * to offer the action: asking an operator to type a phrase this console could not construct would
 * be asking them to guess at the one string the service checks.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function restoreConfirmationPhrase(
  environment: string,
  queuedAt: string,
): string | null {
  const stamp = utcSecondStamp(queuedAt)
  const where = environment.trim()
  if (stamp === null || where.length === 0) return null
  return `restore ${where} from ${stamp}`
}

export interface RestoreGate {
  /** True when this console may offer the control at all. */
  readonly offered: boolean
  /** Why not, in the operator's words. Null when offered. */
  readonly reason: string | null
  /**
   * The refusal is "you have not finished filling this in" rather than "this can never run here".
   *
   * ── WHY THE TWO ARE DISTINGUISHED, AND WHY THE CALLER MUST ────────────────────────────────
   *
   * They lead to opposite renderings, and getting it wrong produces a screen with no way out. A
   * STRUCTURAL refusal — a pruned run, an environment mismatch — replaces the controls with a
   * sentence, because there is nothing an operator can type that would change it. An INPUT
   * refusal must leave the controls on screen: hiding the approval-id field because the approval
   * id is empty is a form that removes the box you were about to fill in.
   *
   * That trap is not hypothetical; it is what the first version of this screen did.
   */
  readonly needsOperatorInput: boolean
  /** The backup was taken from a different estate than the one this console is looking at. */
  readonly mismatch: boolean
  /** The phrase for a live restore. Null for `verify`, which the service does not ask one for. */
  readonly phrase: string | null
}

/**
 * May THIS restore be offered, from THIS backup, in THIS mode?
 *
 * The checks are in the order an operator would ask them, and each answer gets its own sentence.
 *
 * ── Why an unknown estate environment is NOT a refusal ────────────────────────────────────────
 *
 * The same decision `decisionGate` makes about an unknown operator principal, for the same reason.
 * `admin-api` serves no field naming the estate's own environment, so this console derives it from
 * the backups the estate has taken (see `estateEnvironment` in lib/backups.ts) — and refusing on
 * the strength of a derivation that came back empty would block a legitimate restore during an
 * incident. So the control is offered with the comparison shown, and the service remains the thing
 * that actually refuses: it compares `artefactEnvironment` against the estate it is running in,
 * which is a fact it holds and this console does not.
 *
 * ── Why a MISMATCH is a refusal ───────────────────────────────────────────────────────────────
 *
 * Because when the two ARE known and differ, this is not a guess. The service will refuse it, and
 * a console that let the operator type a confirmation phrase for a mainnet restore of testnet
 * artefacts has spent their attention to arrive at a 4xx — worse, it has walked them through the
 * exact ritual that means "I have read this and I mean it" for something that was never going to
 * happen. The mismatch is named BEFORE the phrase, not after it.
 */
export function restoreGate(input: {
  readonly backup: BackupRun
  /** What this console believes the estate is. Null when it could not establish it. */
  readonly estateEnvironment: string | null
  readonly mode: RestoreMode
  /**
   * The reason code chosen for the `estate.restore` request. Only `live` needs one.
   *
   * `POST /v1/approvals` validates it against a CLOSED list (admin-api/src/approvals.ts) and
   * answers 400 for anything else, so an empty box here is a refusal the console can state rather
   * than a 400 the operator has to interpret.
   */
  readonly reasonCode: string
  readonly targets: readonly string[]
}): RestoreGate {
  const { backup, estateEnvironment, mode } = input
  const mismatch = estateEnvironment !== null && estateEnvironment !== backup.environment
  const phrase =
    mode === 'live' ? restoreConfirmationPhrase(backup.environment, backup.queuedAt) : null
  const no = (reason: string, needsOperatorInput = false): RestoreGate => ({
    offered: false,
    reason,
    needsOperatorInput,
    mismatch,
    phrase,
  })

  if (backup.state === 'pruned') {
    return no(
      'This run has been pruned: the files it wrote are gone, and there is nothing on disk to ' +
        'restore from. Retention removed them to stay inside the ceiling — pick a later backup.',
    )
  }
  if (backup.state !== 'succeeded') {
    return no(
      `This run is ${backup.state}, so it has no complete set of artefacts to restore from. A ` +
        'restore reads what a finished run wrote; there is nothing yet.',
    )
  }
  if (input.targets.length === 0) {
    return no(
      'Choose at least one thing to restore. An empty restore does nothing and records it.',
      true,
    )
  }
  if (mode === 'live' && mismatch) {
    return no(
      `This backup was taken from ${backup.environment} and this estate is ${String(
        estateEnvironment,
      )}. admin-api compares the environment stamped inside the artefacts against the estate it ` +
        'is running in and refuses the pair with EnvironmentMismatchError ' +
        '(admin-api/src/backups.ts), and it is right to: restoring one environment’s data over ' +
        'another’s is how a rehearsal becomes an incident. Nothing here will raise it.',
    )
  }
  if (mode === 'live' && phrase === null) {
    return no(
      'This console cannot build the confirmation phrase for this backup — its queued-at ' +
        'timestamp did not parse, so there is no way to produce the exact string admin-api ' +
        'compares. Asking you to guess at it would be worse than refusing.',
    )
  }
  if (mode === 'live' && input.reasonCode.trim().length === 0) {
    return no(
      'Choose a reason code. admin-api validates it against a closed list and refuses anything ' +
        'else, and it is the field the second operator will sort and search this request by.',
      true,
    )
  }
  return { offered: true, reason: null, needsOperatorInput: false, mismatch, phrase }
}

/**
 * What a restore run RECORDS on its own row, beside the audit preview rather than instead of it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY BOTH, NOW THAT THERE IS AN AUDIT ROW TO CITE.
 *
 * The first version of this screen was written against a contract that said nothing about audit
 * rows, so it rendered these sentences INSTEAD of an `AuditRecordPreview` — naming an action the
 * service might not write would have told an operator they were signing for a record that does not
 * exist. The service landed writing `admin.backup.requested` (server.ts) and
 * `admin.restore.requested` (server.ts), so the preview is real and is rendered.
 *
 * These stay, because they describe something the audit row does not: the `restore_runs` row, which
 * is where `checksumsVerified`, `artefactEnvironment` and the eventual outcome live. The audit says
 * an operator asked; this says what the estate will be able to tell afterwards.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function restoreRecordLines(input: {
  readonly mode: RestoreMode
  readonly backup: BackupRun
  readonly targets: readonly string[]
}): readonly string[] {
  const what = input.targets.length === 0 ? 'everything in the backup' : input.targets.join(', ')
  const common = [
    `A restore row is created against backup ${input.backup.id}, naming the operator who asked for ` +
      'it, the reason, the mode, and the exact list of targets chosen.',
    `The targets on this run are: ${what}.`,
    'It records the environment stamped inside the artefacts, and whether their checksums verified ' +
      '— so a restore that ran and a restore that ran and matched are distinguishable afterwards.',
  ]
  return input.mode === 'live'
    ? [
        ...common,
        'It carries the id of the approval that authorised it, and a partial unique index makes one ' +
          'approval one restore for ever — so a retry after a lost answer cannot start a second ' +
          'restore over the top of the first.',
        'On success the backup is marked verified by this restore. That mark is the only evidence ' +
          'in the estate that these files read back at all.',
      ]
    : [
        ...common,
        'No approval id, because nothing live is touched and the service asks for none — a schema ' +
          'constraint refuses a verify row that names one.',
        'On success the backup is marked verified by this restore — which is the whole point of ' +
          'running one.',
      ]
}

/* ══════════════════════════════ what will be recorded ══════════════════════════════ */

/**
 * The audit row an action is about to write, as the operator will find it later.
 *
 * Reproduced from `admin-api`'s own `appendAudit` calls rather than invented:
 *
 *   * raising a request — `admin.approval.requested`, subject `approval`, outcome `allowed`
 *     (admin-api/src/approvals.ts)
 *   * granting — `admin.approval.granted` (approvals.ts)
 *   * rejecting — `admin.approval.rejected` (the same call, with `input.grant` false)
 *   * the execution that follows a grant — `admin.approval.executed`, and note that its SUBJECT
 *     is the approval's subject rather than the approval, with outcome `allowed` on success and
 *     `failed` on failure (approvals.ts)
 *   * a flag change — `admin.flag.created` on the first write of a key and
 *     `admin.flag.changed` afterwards (flags.ts)
 *   * a broadcast — `admin.broadcast.published` / `admin.broadcast.retracted`
 *     (broadcasts.ts)
 *
 * The ACTOR is always the signed-in operator and is never a field this console sends: `admin-api`
 * derives it from the verified bearer on every mutating route. It is shown here because the
 * operator should see their own name on the record they are about to create — not because the
 * console decides it.
 */
export interface AuditPreview {
  /** `user:<uuid>`, or a placeholder when the console could not establish it. */
  readonly actor: string
  readonly action: string
  readonly subjectKind: string
  readonly subjectId: string
  readonly outcome: 'allowed' | 'refused' | 'failed'
  readonly reasonCode: string | null
  /** Sentences, not fields: what an operator reading this row later will be able to tell. */
  readonly notes: readonly string[]
}

const UNKNOWN_ACTOR = 'the operator signed in (admin-api takes this from your token, not from this page)'

export function previewRequest(input: {
  actor: string | null
  action: string
  subjectKind: string
  subjectId: string
  reasonCode: string
}): AuditPreview {
  return {
    actor: input.actor ?? UNKNOWN_ACTOR,
    action: 'admin.approval.requested',
    subjectKind: 'approval',
    // The id does not exist until the row does. Saying so beats printing a plausible blank.
    subjectId: 'the id of the request this creates',
    outcome: 'allowed',
    reasonCode: input.reasonCode.length > 0 ? input.reasonCode : null,
    notes: [
      `The row records that you asked for ${input.action} on ${input.subjectKind} ${input.subjectId}, with your reason and reason code.`,
      'It does not record that the action happened. Nothing happens until a second operator approves it.',
      'The request expires if nobody answers it, and the expiry is recorded too.',
    ],
  }
}

/**
 * The audit row `POST /v1/restores` writes — **admin-api/src/server.ts**.
 *
 * Note the SUBJECT: `backup_run` and the backup's id, not the restore's. The row records what was
 * acted on rather than the record of the acting, exactly as `admin.approval.executed` does
 * (approvals.ts), so an operator searching the audit for a backup finds every restore ever
 * attempted from it.
 */
export function previewVerifyRestore(input: {
  actor: string | null
  backupId: string
  targets: readonly string[]
}): AuditPreview {
  return {
    actor: input.actor ?? UNKNOWN_ACTOR,
    action: 'admin.restore.requested',
    subjectKind: 'backup_run',
    subjectId: input.backupId,
    outcome: 'allowed',
    reasonCode: null,
    notes: [
      'The row records mode "verify", the id of the restore run this queues, and the targets.',
      'It says the restore was ASKED FOR. Whether the artefacts read back is on the restore row, ' +
        'and it is not known until the run finishes.',
      'admin-api serialises restores estate-wide: a second one queued while this is running is ' +
        'refused out loud rather than queued behind it, because a restore that silently waits is a ' +
        'restore an operator believes has already happened.',
    ],
  }
}

/**
 * The audit row `POST /v1/backups` writes — **admin-api/src/server.ts**.
 */
export function previewBackupRequest(input: {
  actor: string | null
  kind: string
  environment: string | null
}): AuditPreview {
  return {
    actor: input.actor ?? UNKNOWN_ACTOR,
    action: 'admin.backup.requested',
    subjectKind: 'backup_run',
    subjectId: 'the id of the run this creates',
    outcome: 'allowed',
    reasonCode: null,
    notes: [
      `The row records that you asked for a ${input.kind} backup of ${
        input.environment ?? 'this estate'
      }, with the root path it will be written to.`,
      'The job and the row commit together, so a backup that is recorded is a backup that was ' +
        'genuinely queued.',
      'It does NOT record that the backup is usable. Only a restore establishes that.',
    ],
  }
}

export function previewDecision(approval: Approval, grant: boolean, actor: string | null): readonly AuditPreview[] {
  const decision: AuditPreview = {
    actor: actor ?? UNKNOWN_ACTOR,
    action: grant ? 'admin.approval.granted' : 'admin.approval.rejected',
    subjectKind: 'approval',
    subjectId: approval.id,
    outcome: 'allowed',
    reasonCode: approval.reasonCode,
    notes: [
      `Both operators are named on this row: ${approval.requestedBy} raised it and you decided it.`,
      'Your rationale is stored on the row as the decision note.',
      grant
        ? 'This row says the action was authorised. A second row says whether it ran.'
        : 'Nothing runs. The request is closed and cannot be decided again.',
    ],
  }
  if (!grant) return [decision]

  return [
    decision,
    {
      actor: actor ?? UNKNOWN_ACTOR,
      // The execution row's subject is the THING ACTED ON, not the approval — approvals.ts.
      action: 'admin.approval.executed',
      subjectKind: approval.subjectKind,
      subjectId: approval.subjectId,
      outcome: 'allowed',
      reasonCode: approval.reasonCode,
      notes: [
        `Written after ${approval.action} runs against its upstream, whether it succeeds or fails.`,
        'A failure is recorded as outcome "failed" and the request stays approved and unexecuted — which is the honest state, and the one that can be retried without a third signature.',
      ],
    },
  ]
}

export function previewFlag(input: {
  actor: string | null
  key: string
  exists: boolean
  /**
   * The value the flag holds NOW, not the one it is about to take.
   *
   * Named for what it is because the sentence below turns on it, and the first version of this
   * function took the two meanings for the same field: the caller passed the current value and
   * the note read it as the incoming one, so a flag being switched OFF was previewed as having
   * been "off until now". A preview that describes the record wrongly is worse than no preview —
   * the operator signs for it.
   */
  wasEnabled: boolean
}): AuditPreview {
  return {
    actor: input.actor ?? UNKNOWN_ACTOR,
    action: input.exists ? 'admin.flag.changed' : 'admin.flag.created',
    subjectKind: 'feature_flag',
    subjectId: input.key,
    outcome: 'allowed',
    reasonCode: null,
    notes: [
      input.exists
        ? `The row records the value BEFORE and AFTER, so the record will say it was ${input.wasEnabled ? 'ON' : 'OFF'} until now rather than only what it becomes.`
        : 'This is the first write of this key, so the row records a creation with no previous value.',
      'An admin.flag.changed event is emitted whether or not the boolean moved, because an owner change is still a change.',
    ],
  }
}

export function previewBroadcast(input: {
  actor: string | null
  retract: boolean
  id: string | null
  severity?: string
}): AuditPreview {
  return {
    actor: input.actor ?? UNKNOWN_ACTOR,
    action: input.retract ? 'admin.broadcast.retracted' : 'admin.broadcast.published',
    subjectKind: 'broadcast',
    subjectId: input.id ?? 'the id of the broadcast this creates',
    outcome: 'allowed',
    reasonCode: null,
    notes: input.retract
      ? [
          'Retraction is claimed with `where retracted_at is null`, so a second attempt matches no row and is refused rather than recorded twice.',
          'The broadcast is not deleted. It stays in the record with the time it was retracted and by whom.',
        ]
      : [
          `Published at ${input.severity ?? 'the severity you choose'}, visible to everyone the estate shows broadcasts to.`,
          'It carries your principal as the publisher, and stays in the record after it ends.',
        ],
  }
}

/* ══════════════════════════════ idempotency keys ══════════════════════════════ */

/**
 * A key for one INTENTION, not one click.
 *
 * `withIdempotentRoute` requires 8 to 200 characters and answers 400 without one
 * (admin-api/src/server.ts), and its whole purpose is that a retry after a lost response
 * presents THE SAME key and gets the same answer instead of a second artefact. A key generated
 * inside a click handler would make every retry a fresh operation — the failure the header exists
 * to prevent, implemented by the client that was supposed to prevent it.
 *
 * So the key is derived from what the operator is deciding about, plus a mint time held for the
 * life of the page. Reloading the page mints a new one, which is correct: a reload is a new
 * intention, and the service's own state checks refuse a second decision on a decided request
 * anyway (`state_conflict`, server.ts).
 */
export function idempotencyKeyFor(scope: string, subject: string, mintedAt: number): string {
  // ── THE SUBJECT IS NOT ALWAYS A UUID, AND THIS IS A HEADER VALUE.
  //
  // The broadcast composer keys on the notice's TITLE, because a retry of the same notice must
  // present the same key and a genuinely different notice a different one. An operator's title is
  // free text: it can carry a newline pasted out of an incident channel, and a header value
  // containing one makes `fetch` throw before the request is sent — which the console would show
  // as an unexplained failure to publish, during an incident, on the screen that exists for
  // incidents. Everything outside the safe set collapses to `-`.
  const safe = subject.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const key = `admin-web-${scope}-${safe}-${mintedAt.toString(36)}`
  // The floor is the service's, restated: a subject shorter than expected must not produce a key
  // the route answers 400 for, which would read to an operator as "the form is broken".
  return key.length >= 8 ? key.slice(0, 200) : `${key}-padded-to-length`
}

/**
 * The audit row a cap LOWERING will write — docs/ecosystem/21 §7.7.
 *
 * Lowering is the only direction this console can take on its own. Raising is
 * `engagement.policy.set` through the approval queue, and both `admin-api`'s route and the
 * `engagement_raise_needs_approval` trigger refuse a raise that arrives any other way. The notes
 * say so, because the asymmetry is the thing an operator most needs to know BEFORE they lower: a
 * lowering is easy and undoing one is not.
 */
export function previewEngagementLower(input: {
  actor: string | null
  service: string
  what: string
  from: string
  to: string
}): AuditPreview {
  return {
    actor: input.actor ?? UNKNOWN_ACTOR,
    action:
      input.service === 'platform'
        ? 'admin.engagement.recycle.lowered'
        : 'admin.engagement.policy.lowered',
    subjectKind: 'engagement_policy',
    subjectId: input.service === 'platform' ? 'fee-recycle' : input.service,
    outcome: 'allowed',
    reasonCode: null,
    notes: [
      `The row records ${input.what} BEFORE and AFTER, so the record will say it was ${input.from} until now rather than only that it is ${input.to}.`,
      'Lowering takes one operator. RAISING it back takes two, through engagement.policy.set in the approval queue — so this is easy to do and deliberately harder to undo.',
      'The cap in the schema is what actually refuses an over-cap transfer, so this takes effect for every write path at once, not only for this console.',
    ],
  }
}

/**
 * The audit rows the four Forge Worlds actions write — **admin-api/src/server.ts**.
 *
 * All four are `subject_kind: 'world'` against the world's own id, so an operator searching the
 * audit for a world finds its whole life in one thread: who generated it, who opened it, who
 * forced a day, who changed the bots.
 *
 * ── WHY THESE ROWS EXIST WHEN nda ALREADY HAS AN OUTBOX ───────────────────────────────────────
 *
 * nda emits its own events for what happens INSIDE the game. These record what an operator did to
 * it from outside, in this console's hash-chained log, against the human named on the bearer — the
 * two answer different questions, and "who generated that world" is this one's.
 */
export function previewWorld(
  input:
    | { actor: string | null; kind: 'create'; name: string; seed: string }
    | { actor: string | null; kind: 'start'; id: string; name: string }
    | { actor: string | null; kind: 'tick'; id: string; name: string; day: number }
    | { actor: string | null; kind: 'bots'; id: string; name: string; from: number; to: number },
): AuditPreview {
  const common = {
    actor: input.actor ?? UNKNOWN_ACTOR,
    subjectKind: 'world',
    outcome: 'allowed' as const,
    reasonCode: null,
  }
  if (input.kind === 'create') {
    return {
      ...common,
      action: 'admin.world.created',
      // The id does not exist until nda has generated the map. Saying so beats printing a blank.
      subjectId: 'the id of the world this generates',
      notes: [
        `The row records the name, the size, the season length, the tick interval and the seed${
          input.seed === '' ? ' nda chooses' : ` — ${input.seed}`
        }.`,
        'The seed is what makes a world reproducible: the same seed and the same inputs resolve identically, which is why it is on the record rather than only in the database.',
        'Generating a world does not open it. Nobody can join until it is started.',
      ],
    }
  }
  if (input.kind === 'start') {
    return {
      ...common,
      action: 'admin.world.started',
      subjectId: input.id,
      notes: [
        `${input.name} moves from lobby to active, and days begin resolving on its own schedule.`,
        'There is no route back to lobby. A world that should not have been opened is archived, not un-started.',
      ],
    }
  }
  if (input.kind === 'tick') {
    return {
      ...common,
      action: 'admin.world.ticked',
      subjectId: input.id,
      notes: [
        `Day ${input.day + 1} of ${input.name} is queued for resolution now instead of at the next tick.`,
        'The row is written when the day is ACCEPTED, not when it resolves — the job runs behind the world\'s lease, which is what stops this and the scheduler advancing the same day twice.',
      ],
    }
  }
  return {
    ...common,
    action: 'admin.world.bots.changed',
    subjectId: input.id,
    notes: [
      `The row records ${input.from} bots BEFORE and ${input.to} after, so the record says what it was until now rather than only what it becomes.`,
      input.to > input.from
        ? `${input.to - input.from} more bots join ${input.name} and start acting on the next day it resolves.`
        : input.to < input.from
          ? `${input.from - input.to} bots are retired from ${input.name}. What they built stays in the world.`
          : 'The count is unchanged, so this writes a row that says so and nothing else happens.',
    ],
  }
}

/**
 * The gates in front of an operator action, and the audit row each one will write.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THREE THINGS THIS FILE EXISTS TO MAKE TRUE.
 *
 * **1. The irreversible action is legible, not fast.** Everything else in a console should get
 * out of the way. A decision on an approval must not: granting one runs a ledger reversal, a
 * marketplace case resolution or an entitlement revocation against a real upstream, and
 * `admin-api` does not roll it back if it fails (server.ts:753-767). Rejecting one is terminal —
 * `decide()` refuses any transition out of a decided state (approvals.ts:258-260). So the shape
 * is: the consequence in SENTENCES, then the facts the decision turns on, then a rationale, then
 * a phrase the operator writes out naming the request AND the outcome. Never "Are you sure?" —
 * that question has never once been answered "no" by somebody about to make a mistake, because
 * the person about to make a mistake believes they are sure.
 *
 * **2. The four-eyes control is legible, not merely obeyed.** `admin-api` enforces it three
 * times — the route (`SelfApprovalError`, approvals.ts:262), the UPDATE's `and requested_by <>
 * ${operator}` (approvals.ts:277), and the `approvals_no_self_approval` CHECK constraint. A
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
import type { Approval, ApprovalState } from './admin.ts'

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
 * job has run (`expirePending`, approvals.ts:404). Between the deadline and the sweep the row
 * still reads `pending` and `decide()` will answer 409 (approvals.ts:263-265). A console that
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

/* ══════════════════════════════ what will be recorded ══════════════════════════════ */

/**
 * The audit row an action is about to write, as the operator will find it later.
 *
 * Reproduced from `admin-api`'s own `appendAudit` calls rather than invented:
 *
 *   * raising a request — `admin.approval.requested`, subject `approval`, outcome `allowed`
 *     (admin-api/src/approvals.ts:208-227)
 *   * granting — `admin.approval.granted` (approvals.ts:284-306)
 *   * rejecting — `admin.approval.rejected` (the same call, `input.grant` false at :288)
 *   * the execution that follows a grant — `admin.approval.executed`, and note that its SUBJECT
 *     is the approval's subject rather than the approval, with outcome `allowed` on success and
 *     `failed` on failure (approvals.ts:346-365)
 *   * a flag change — `admin.flag.created` on the first write of a key and
 *     `admin.flag.changed` afterwards (flags.ts:126-142)
 *   * a broadcast — `admin.broadcast.published` / `admin.broadcast.retracted`
 *     (broadcasts.ts:124-131, :187-194)
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
      // The execution row's subject is the THING ACTED ON, not the approval — approvals.ts:350-351.
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
 * (admin-api/src/server.ts:988-998), and its whole purpose is that a retry after a lost response
 * presents THE SAME key and gets the same answer instead of a second artefact. A key generated
 * inside a click handler would make every retry a fresh operation — the failure the header exists
 * to prevent, implemented by the client that was supposed to prevent it.
 *
 * So the key is derived from what the operator is deciding about, plus a mint time held for the
 * life of the page. Reloading the page mints a new one, which is correct: a reload is a new
 * intention, and the service's own state checks refuse a second decision on a decided request
 * anyway (`state_conflict`, server.ts:395).
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

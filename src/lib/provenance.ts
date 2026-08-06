/**
 * Provenance: what the pipeline did, and the gate that makes an operator look at it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE FAILURE THIS SCREEN EXISTS TO PREVENT IS AN OPERATOR APPROVING WITHOUT SEEING WHY.
 *
 * "Nothing the model produces can open a market. An operator approves, edits, or discards —
 * because a market is a financial instrument and its resolution criteria are a contract with
 * strangers" (19-new-products.md §2.3.3; restated at foresight/src/ideas.ts).
 *
 * A queue of cards with an Approve button on each one satisfies that rule on paper and defeats it
 * in practice: the fast path through the screen becomes clicking Approve, and the sources — which
 * are the entire reason the proposal can be judged at all — are a panel nobody opens. So the
 * approval control on a MODEL proposal is not enabled until its sources have been opened, and a
 * model proposal that cites no sources cannot be approved at all.
 *
 * That second rule is the stronger one and it is deliberate. `ideas_model_has_provenance` means a
 * model-origin row cannot even be stored without provenance (ideas.ts), so a sourceless model
 * proposal arriving here is not a shape to render defensively around — it is a signal that
 * something upstream is wrong, and approving it would be authoring resolution criteria from
 * nothing at all.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * An OPERATOR-origin proposal has no sources and needs none: a person wrote the question, and the
 * accountable author is the person about to approve it. Gating that on a panel with nothing in it
 * would be a ritual, and rituals are what people learn to click through.
 */
import type { Idea, IdeaSource } from './foresight.ts'
import { hostOf, safeHref, utcStamp } from './format.ts'

/** One line of the provenance block. `mono` is set for a hash or an id nobody reads as prose. */
export interface ProvenanceRow {
  readonly label: string
  readonly value: string
  readonly mono: boolean
}

/**
 * The five provenance fields, in the order an operator needs them.
 *
 * The query first, because "what was this looking for" frames everything under it. The prompt
 * hash last, because it answers a question — "was this the prompt we published" — that only comes
 * up after the rest has been read. A field the service sent as null is rendered as an explicit
 * "not recorded" ROW rather than dropped: a missing model id on a model proposal is information,
 * and a silently absent row is the one an operator does not notice is absent.
 */
export function provenanceRows(idea: Idea): readonly ProvenanceRow[] {
  const missing = 'not recorded'
  return [
    { label: 'Origin', value: idea.origin === 'model' ? 'proposed by the idea pipeline' : 'written by an operator', mono: false },
    { label: 'Search query', value: idea.searchQuery ?? missing, mono: false },
    { label: 'Model', value: idea.modelId ?? missing, mono: true },
    { label: 'Prompt SHA-256', value: idea.promptSha256 ?? missing, mono: true },
    { label: 'Proposed', value: utcStamp(idea.proposedAt) ?? missing, mono: false },
  ]
}

/** A cited source, prepared for rendering: the link is checked, the host is pulled out. */
export interface PreparedSource {
  readonly title: string
  readonly url: string
  /** Null when the URL is not an http(s) one — see `safeHref`. The row then renders as text. */
  readonly href: string | null
  readonly host: string | null
  readonly retrievedAt: string | null
}

/**
 * Prepare the cited sources for display.
 *
 * A source with no usable title falls back to its host and then to the raw URL, in that order —
 * never to "Untitled", which tells the operator nothing about what is being cited. A source whose
 * URL will not parse is still SHOWN, as inert text: it is evidence about what the pipeline
 * returned, and hiding it would make a broken run look like a clean one.
 */
export function prepareSources(sources: readonly IdeaSource[]): readonly PreparedSource[] {
  return sources.map((source) => {
    const href = safeHref(source.url)
    const host = hostOf(source.url)
    const title = source.title?.trim() ? source.title.trim() : (host ?? source.url)
    return {
      title,
      url: source.url,
      href,
      host,
      retrievedAt: utcStamp(source.retrievedAt),
    }
  })
}

export interface ApprovalGateInput {
  readonly idea: Idea
  /** True once the operator has opened this proposal's sources panel. */
  readonly sourcesReviewed: boolean
  /** True while an approve request for this proposal is in flight. */
  readonly busy?: boolean
}

export interface ApprovalGate {
  readonly ready: boolean
  /** Why not, in the operator's words. Null when ready. */
  readonly reason: string | null
  /** True when no amount of reading will help: the control is disabled, not merely waiting. */
  readonly permanent: boolean
}

/**
 * May this proposal be approved right now?
 *
 * The order of the checks is the order of how hopeless they are: already decided and sourceless
 * are permanent, unread is temporary and tells the operator exactly what to do about it.
 */
export function approvalGate(input: ApprovalGateInput): ApprovalGate {
  const { idea, sourcesReviewed, busy } = input

  if (idea.status !== 'proposed') {
    return {
      ready: false,
      reason: `this proposal is already ${idea.status}`,
      permanent: true,
    }
  }
  if (idea.origin === 'model' && idea.sources.length === 0) {
    return {
      ready: false,
      reason:
        'this proposal cites no sources, so there is nothing to check its resolution criteria against. Discard it as unverifiable rather than approving it.',
      permanent: true,
    }
  }
  if (busy) return { ready: false, reason: 'this approval is already running', permanent: false }
  if (idea.origin === 'model' && !sourcesReviewed) {
    return {
      ready: false,
      reason: `read the ${idea.sources.length} cited source${idea.sources.length === 1 ? '' : 's'} first — approving a market means standing behind its resolution criteria`,
      permanent: false,
    }
  }
  return { ready: true, reason: null, permanent: false }
}

/**
 * Does this proposal have enough provenance to be judged at all?
 *
 * Shown as a warning banner on the card, separately from the gate: a model proposal missing its
 * model id or prompt hash is still approvable — the sources are what the criteria are checked
 * against — but the operator should know the audit trail behind it is incomplete before they put
 * their name on it.
 */
export function provenanceGaps(idea: Idea): readonly string[] {
  if (idea.origin !== 'model') return []
  const gaps: string[] = []
  if (!idea.searchQuery) gaps.push('the search query that produced it')
  if (!idea.modelId) gaps.push('which model wrote it')
  if (!idea.promptSha256) gaps.push('the hash of the prompt it was written from')
  return gaps
}

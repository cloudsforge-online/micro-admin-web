/**
 * The gate that makes an operator look at why a market was proposed, and the sources it shows.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * "NOTHING THE MODEL PRODUCES CAN OPEN A MARKET" IS ONLY TRUE IF THE PERSON READ SOMETHING.
 *
 * foresight enforces the letter of the rule: `operatorOf` refuses a service principal, the schema
 * refuses an unapproved proposal, and a human token is the only thing that can approve. None of
 * that is worth anything if the console's fast path is a row of Approve buttons — the rule then
 * says a person clicked, which is not the same claim as a person judged.
 *
 * So `approvalGate` is the mechanism, and this file proves it refuses:
 *   * a model proposal whose sources have not been opened,
 *   * a model proposal that cites no sources AT ALL — permanently, not pending a click,
 *   * anything already decided.
 *
 * And proves it does NOT refuse an operator's own question, where gating on an empty panel would
 * be a ritual, and rituals are what people learn to click through.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Idea, IdeaSource } from '../src/lib/foresight.ts'
import { approvalGate, prepareSources, provenanceGaps, provenanceRows } from '../src/lib/provenance.ts'

const SOURCE: IdeaSource = {
  url: 'https://explorer.example/height',
  title: 'Hearth block explorer — current height',
  retrievedAt: '2026-07-31T09:15:00.000Z',
}

function idea(over: Partial<Idea> = {}): Idea {
  return {
    id: '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a',
    status: 'proposed',
    question: 'Will block 9,000,000 be mined by 2027-01-01?',
    resolutionCriteria: 'YES if the explorer shows height >= 9000000 at the close time.',
    category: 'protocol_network',
    categoryVersion: 1,
    resolutionSourceKind: 'block_explorer',
    resolutionSourceRef: 'https://explorer.example/height',
    suggestedCloseTime: '2027-01-01T00:00:00.000Z',
    origin: 'model',
    searchQuery: 'hearth chain block height milestone',
    sources: [SOURCE],
    modelId: 'some-model-v3',
    promptSha256: 'a'.repeat(64),
    proposedAt: '2026-07-31T09:16:00.000Z',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    refusalId: null,
    ...over,
  }
}

/* ══════════════════════════════ the gate ══════════════════════════════ */

describe('a model proposal cannot be approved unread', () => {
  it('refuses before the sources have been opened', () => {
    const gate = approvalGate({ idea: idea(), sourcesReviewed: false })
    assert.equal(gate.ready, false)
    assert.equal(gate.permanent, false)
    // The reason is rendered beside the disabled control, so it has to say what to DO.
    assert.match(gate.reason ?? '', /read the 1 cited source first/)
  })

  it('releases once they have been', () => {
    const gate = approvalGate({ idea: idea(), sourcesReviewed: true })
    assert.equal(gate.ready, true)
    assert.equal(gate.reason, null)
  })

  it('counts the sources correctly in the plural', () => {
    const two = idea({ sources: [SOURCE, { ...SOURCE, url: 'https://other.example/' }] })
    assert.match(
      approvalGate({ idea: two, sourcesReviewed: false }).reason ?? '',
      /read the 2 cited sources first/,
    )
  })

  it('refuses while an approval is already in flight', () => {
    const gate = approvalGate({ idea: idea(), sourcesReviewed: true, busy: true })
    assert.equal(gate.ready, false)
    assert.match(gate.reason ?? '', /already running/)
  })
})

describe('a model proposal with no sources cannot be approved at all', () => {
  it('refuses permanently, and says to discard it instead', () => {
    // The stronger of the two rules. `ideas_model_has_provenance` means a model-origin row cannot
    // be stored without provenance (ideas.ts), so a sourceless one arriving here means
    // something upstream is wrong — and approving it would be authoring resolution criteria from
    // nothing at all.
    const gate = approvalGate({ idea: idea({ sources: [] }), sourcesReviewed: true })
    assert.equal(gate.ready, false)
    assert.equal(gate.permanent, true)
    assert.match(gate.reason ?? '', /cites no sources/)
    assert.match(gate.reason ?? '', /Discard it as unverifiable/)
  })

  it('is not released by clicking anything', () => {
    // Both directions of the flag, so the "permanent" claim is actually tested rather than
    // asserted once in the state that happens to be false.
    for (const reviewed of [true, false]) {
      assert.equal(approvalGate({ idea: idea({ sources: [] }), sourcesReviewed: reviewed }).ready, false)
    }
  })
})

describe('an operator’s own question is not gated on an empty panel', () => {
  it('is approvable without opening sources it does not have', () => {
    const own = idea({ origin: 'operator', sources: [], searchQuery: null, modelId: null, promptSha256: null })
    const gate = approvalGate({ idea: own, sourcesReviewed: false })
    assert.equal(gate.ready, true)
  })
})

describe('an already-decided proposal', () => {
  for (const status of ['approved', 'discarded'] as const) {
    it(`refuses to be re-approved when it is ${status}`, () => {
      const gate = approvalGate({ idea: idea({ status }), sourcesReviewed: true })
      assert.equal(gate.ready, false)
      assert.equal(gate.permanent, true)
      assert.match(gate.reason ?? '', new RegExp(`already ${status}`))
    })
  }
})

/* ══════════════════════════════ what is rendered ══════════════════════════════ */

describe('the provenance rows', () => {
  it('carry all five recorded fields, in reading order', () => {
    const rows = provenanceRows(idea())
    assert.deepEqual(rows.map((r) => r.label), [
      'Origin',
      'Search query',
      'Model',
      'Prompt SHA-256',
      'Proposed',
    ])
    assert.equal(rows[1]?.value, 'hearth chain block height milestone')
    assert.equal(rows[2]?.value, 'some-model-v3')
    assert.equal(rows[3]?.value, 'a'.repeat(64))
  })

  it('says "not recorded" rather than dropping an absent field', () => {
    // A silently absent row is the one nobody notices is absent. A missing model id on a model
    // proposal is information.
    const rows = provenanceRows(idea({ modelId: null, searchQuery: null, promptSha256: null }))
    assert.equal(rows.length, 5)
    for (const label of ['Search query', 'Model', 'Prompt SHA-256']) {
      assert.equal(rows.find((r) => r.label === label)?.value, 'not recorded')
    }
  })

  it('renders the hash and the model id in monospace and the prose in prose', () => {
    const rows = provenanceRows(idea())
    assert.equal(rows.find((r) => r.label === 'Prompt SHA-256')?.mono, true)
    assert.equal(rows.find((r) => r.label === 'Search query')?.mono, false)
  })

  it('names who wrote the question, in words rather than a code', () => {
    assert.match(provenanceRows(idea())[0]?.value ?? '', /proposed by the idea pipeline/)
    assert.match(provenanceRows(idea({ origin: 'operator' }))[0]?.value ?? '', /written by an operator/)
  })
})

describe('preparing the cited sources', () => {
  it('keeps the title, the host and the retrieval time', () => {
    const [prepared] = prepareSources([SOURCE])
    assert.equal(prepared?.title, 'Hearth block explorer — current height')
    assert.equal(prepared?.host, 'explorer.example')
    assert.equal(prepared?.href, 'https://explorer.example/height')
    assert.equal(prepared?.retrievedAt, '2026-07-31 09:15 UTC')
  })

  it('falls back to the host, then to the raw URL — never to "Untitled"', () => {
    const [byHost] = prepareSources([{ ...SOURCE, title: '  ' }])
    assert.equal(byHost?.title, 'explorer.example')
    const [byUrl] = prepareSources([{ url: 'not a url', title: '', retrievedAt: '' }])
    assert.equal(byUrl?.title, 'not a url')
  })

  it('refuses to make a link out of a scheme that is not http(s)', () => {
    // These sources came out of a web search and a language model. A `javascript:` URL here is a
    // script running with the operator's session, on the surface that can resolve markets.
    const [prepared] = prepareSources([
      { url: 'javascript:fetch("/markets")', title: 'looks fine', retrievedAt: '' },
    ])
    assert.equal(prepared?.href, null)
    // Still SHOWN, as inert text: it is evidence about what the pipeline returned, and hiding it
    // would make a broken run look like a clean one.
    assert.equal(prepared?.url, 'javascript:fetch("/markets")')
    assert.equal(prepared?.title, 'looks fine')
  })

  it('refuses a data: URL too', () => {
    const [prepared] = prepareSources([
      { url: 'data:text/html,<script>alert(1)</script>', title: 'x', retrievedAt: '' },
    ])
    assert.equal(prepared?.href, null)
  })

  it('keeps an http source as a link, so the allowlist is not vacuously safe', () => {
    const [prepared] = prepareSources([{ url: 'http://plain.example/a', title: 'x', retrievedAt: '' }])
    assert.equal(prepared?.href, 'http://plain.example/a')
  })

  it('renders nothing for no sources rather than inventing a row', () => {
    assert.deepEqual(prepareSources([]), [])
  })
})

describe('provenance gaps', () => {
  it('names each missing audit field on a model proposal', () => {
    const gaps = provenanceGaps(idea({ modelId: null, promptSha256: null }))
    assert.equal(gaps.length, 2)
    assert.match(gaps.join(' '), /which model wrote it/)
    assert.match(gaps.join(' '), /hash of the prompt/)
  })

  it('reports nothing for a complete proposal', () => {
    assert.deepEqual(provenanceGaps(idea()), [])
  })

  it('reports nothing for an operator’s own question, which has no pipeline to record', () => {
    assert.deepEqual(provenanceGaps(idea({ origin: 'operator', modelId: null, searchQuery: null })), [])
  })
})

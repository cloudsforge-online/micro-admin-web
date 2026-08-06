/**
 * Never invent a number, and always say when a figure was read.
 *
 * The two rules this file holds are the ones an operator console is most easily wrong about, and
 * being wrong about either is worse than showing nothing: a null count rendered as `0` reports an
 * empty moderation queue during a marketplace outage, and a figure with no observation time reads
 * as current forever.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  approvalTone,
  asOfLabel,
  chainTone,
  clockTime,
  count,
  deadline,
  figure,
  outcomeTone,
  principal,
  relative,
  severityTone,
  shortHash,
  shortId,
  tileTone,
  timestamp,
} from '../src/lib/format.ts'

const NOW = new Date('2026-08-01T12:00:00.000Z')

/* ══════════════════════════════ time ══════════════════════════════ */

describe('the observation time', () => {
  it('says "read at", never "as at"', () => {
    // The service stamps nothing — GET /v1/estate composes live with no cache — so the only
    // honest timestamp this bundle can attach is the moment the response arrived here.
    assert.match(asOfLabel(NOW, NOW), /^read at /)
  })

  it('carries a wall-clock time to the second', () => {
    assert.match(asOfLabel(NOW, NOW), /\d{2}:\d{2}:\d{2}/)
  })

  it('carries a relative time as well, so a stale tab is visible', () => {
    const read = new Date(NOW.getTime() - 41 * 60_000)
    assert.match(asOfLabel(read, NOW), /41 minutes ago/)
  })

  it('renders a fresh read as "just now" rather than "0 seconds ago"', () => {
    assert.match(asOfLabel(NOW, NOW), /just now/)
  })

  it('pads the clock to two digits in each field', () => {
    assert.equal(clockTime(new Date(2026, 7, 1, 3, 4, 5)), '03:04:05')
  })
})

describe('relative times read as English, never as a bare number', () => {
  it('under five seconds is "just now"', () => {
    assert.equal(relative(new Date(NOW.getTime() - 3_000), NOW), 'just now')
  })

  it('singularises one unit', () => {
    assert.equal(relative(new Date(NOW.getTime() - 60_000), NOW), '60 seconds ago')
    assert.equal(relative(new Date(NOW.getTime() - 60 * 60_000), NOW), '60 minutes ago')
  })

  it('rolls into minutes past ninety seconds', () => {
    assert.match(relative(new Date(NOW.getTime() - 120_000), NOW), /2 minutes ago/)
  })

  it('rolls into hours past ninety minutes', () => {
    assert.match(relative(new Date(NOW.getTime() - 3 * 3_600_000), NOW), /3 hours ago/)
  })

  it('rolls into days past thirty-six hours', () => {
    assert.match(relative(new Date(NOW.getTime() - 72 * 3_600_000), NOW), /3 days ago/)
  })

  it('says "in" for the future rather than a negative "ago"', () => {
    assert.match(relative(new Date(NOW.getTime() + 120_000), NOW), /^in 2 minutes$/)
  })

  it('uses the singular for exactly one', () => {
    assert.equal(relative(new Date(NOW.getTime() - 2 * 3_600_000 - 60_000), NOW), '2 hours ago')
    assert.match(relative(new Date(NOW.getTime() + 3_600_000), NOW), /in 60 minutes/)
  })
})

describe('timestamps', () => {
  it('renders an ISO string as a readable local date and time', () => {
    assert.match(timestamp('2026-08-01T12:00:00.000Z'), /2026/)
  })

  it('renders null as an em dash, not as the epoch', () => {
    assert.equal(timestamp(null), '—')
  })

  it('renders an empty string as an em dash', () => {
    assert.equal(timestamp(''), '—')
  })

  it('returns an unparseable value VERBATIM rather than "Invalid Date"', () => {
    // An operator seeing the actual string can report it; an operator seeing "Invalid Date" can
    // only report that the console is broken.
    assert.equal(timestamp('not-a-date'), 'not-a-date')
  })
})

describe('deadlines', () => {
  it('reports an open deadline with how long is left', () => {
    const result = deadline(new Date(NOW.getTime() + 30 * 60_000).toISOString(), NOW)
    assert.equal(result.passed, false)
    assert.match(result.label, /expires in 30 minutes/)
  })

  it('reports a passed deadline as passed', () => {
    const result = deadline(new Date(NOW.getTime() - 60_000).toISOString(), NOW)
    assert.equal(result.passed, true)
    assert.match(result.label, /deadline passed/)
  })

  it('treats the exact boundary as passed, matching approvals.ts', () => {
    assert.equal(deadline(NOW.toISOString(), NOW).passed, true)
  })

  it('marks the last hour as soon — the window estate.approvals counts', () => {
    assert.equal(deadline(new Date(NOW.getTime() + 59 * 60_000).toISOString(), NOW).soon, true)
  })

  it('does not mark more than an hour away as soon', () => {
    assert.equal(deadline(new Date(NOW.getTime() + 61 * 60_000).toISOString(), NOW).soon, false)
  })

  it('says so rather than guessing when the deadline cannot be read', () => {
    const result = deadline('nonsense', NOW)
    assert.equal(result.passed, false)
    assert.match(result.label, /no readable deadline/)
  })
})

/* ══════════════════════════════ absent numbers ══════════════════════════════ */

describe('a figure that may be absent', () => {
  it('renders a number', () => {
    const f = figure(42)
    assert.equal(f.present, true)
    assert.equal(f.text, '42')
  })

  it('renders zero as zero, because zero is a real answer', () => {
    const f = figure(0)
    assert.equal(f.present, true)
    assert.equal(f.text, '0')
  })

  it('renders null as ABSENT, never as zero', () => {
    const f = figure(null)
    assert.equal(f.present, false)
    assert.notEqual(f.text, '0')
    assert.match(f.text, /not measured/)
  })

  it('renders undefined as absent too', () => {
    assert.equal(figure(undefined).present, false)
  })

  it('carries the reason for an absence, so it names its cause', () => {
    assert.equal(figure(null, 'market answered 503').because, 'market answered 503')
  })

  it('carries no reason on a present figure', () => {
    assert.equal(figure(7, 'ignored').because, null)
  })

  it('passes a string figure through — a bigint delta is not a JS number', () => {
    assert.equal(figure('90071992547409910000').text, '90071992547409910000')
  })

  it('never returns the string "null" or "undefined"', () => {
    for (const value of [null, undefined]) {
      assert.doesNotMatch(figure(value).text, /null|undefined/)
    }
  })
})

describe('counts', () => {
  it('pluralises', () => {
    assert.equal(count(2, 'request'), '2 requests')
  })

  it('singularises one', () => {
    assert.equal(count(1, 'request'), '1 request')
  })

  it('says zero rather than nothing', () => {
    assert.equal(count(0, 'request'), '0 requests')
  })

  it('takes an irregular plural', () => {
    assert.equal(count(3, 'entry', 'entries'), '3 entries')
  })
})

/* ══════════════════════════════ principals ══════════════════════════════ */

describe('principals are split into kind and id', () => {
  it('reads a user principal', () => {
    const p = principal('user:11111111-2222-3333-4444-555555555555')
    assert.equal(p.kind, 'user')
    assert.equal(p.short, '11111111')
  })

  it('reads a service principal and keeps its whole name', () => {
    const p = principal('service:admin-api')
    assert.equal(p.kind, 'service')
    assert.equal(p.short, 'admin-api')
  })

  it('does not silently call an unknown prefix a user', () => {
    // An audit log that rendered a person and a service identically is one where "how many
    // distinct parties touched this" cannot be answered by reading it.
    assert.equal(principal('robot:x').kind, 'unknown')
  })

  it('handles a principal with no colon at all', () => {
    const p = principal('mystery')
    assert.equal(p.kind, 'unknown')
    assert.equal(p.id, 'mystery')
  })

  it('keeps the raw value for the title attribute', () => {
    assert.equal(principal('user:abc').raw, 'user:abc')
  })

  it('shortens an id to eight characters', () => {
    assert.equal(shortId('3f2a1b9c-4d5e-4f60'), '3f2a1b9c')
  })
})

/* ══════════════════════════════ state, never colour alone ══════════════════════════════ */

describe('every state carries a word and a glyph', () => {
  const tones = [
    tileTone('ok'),
    tileTone('degraded'),
    tileTone('unavailable'),
    approvalTone('pending'),
    approvalTone('approved'),
    approvalTone('rejected'),
    approvalTone('expired'),
    outcomeTone('allowed'),
    outcomeTone('refused'),
    outcomeTone('failed'),
    severityTone('info'),
    severityTone('maintenance'),
    severityTone('incident'),
    chainTone({ ok: true, breaks: 0, everVerified: true }),
    chainTone({ ok: false, breaks: 1, everVerified: true }),
    chainTone({ ok: true, breaks: 0, everVerified: false }),
  ]

  it('never returns an empty word', () => {
    for (const tone of tones) assert.ok(tone.word.length > 0, JSON.stringify(tone))
  })

  it('never returns an empty glyph', () => {
    for (const tone of tones) assert.ok(tone.glyph.length > 0, JSON.stringify(tone))
  })

  it('returns one of the four declared tones', () => {
    for (const tone of tones) {
      assert.ok(['good', 'warn', 'crit', 'mute'].includes(tone.tone), tone.tone)
    }
  })
})

describe('tile status', () => {
  it('ok is good', () => {
    assert.equal(tileTone('ok').tone, 'good')
  })

  it('degraded is a WARNING, not a mild unavailability', () => {
    // estate.ts marks the services tile degraded when it HAS its data and the data is that
    // services are down, and the ledger tile degraded when the trial balance is not zero. Both
    // are answers, and both are bad news.
    assert.equal(tileTone('degraded').tone, 'warn')
    assert.equal(tileTone('degraded').word, 'DEGRADED')
  })

  it('unavailable is critical', () => {
    assert.equal(tileTone('unavailable').tone, 'crit')
  })
})

describe('approval state', () => {
  it('pending is a warning: something is waiting for a person', () => {
    assert.equal(approvalTone('pending').tone, 'warn')
  })

  it('approved is good', () => {
    assert.equal(approvalTone('approved').tone, 'good')
  })

  it('rejected and expired are both muted, and are DIFFERENT words', () => {
    assert.equal(approvalTone('rejected').tone, 'mute')
    assert.equal(approvalTone('expired').tone, 'mute')
    assert.notEqual(approvalTone('rejected').word, approvalTone('expired').word)
  })

  it('renders an unknown state as itself rather than as one of the four', () => {
    assert.equal(approvalTone('something-new').word, 'SOMETHING-NEW')
    assert.equal(approvalTone('something-new').tone, 'mute')
  })
})

describe('audit outcome', () => {
  it('maps the three outcomes admin-api writes', () => {
    assert.equal(outcomeTone('allowed').tone, 'good')
    assert.equal(outcomeTone('refused').tone, 'warn')
    assert.equal(outcomeTone('failed').tone, 'crit')
  })

  it('distinguishes refused from failed', () => {
    // A refusal is the system working. A failure is not.
    assert.notEqual(outcomeTone('refused').word, outcomeTone('failed').word)
  })
})

describe('broadcast severity', () => {
  it('incident is critical, maintenance is a warning, info is muted', () => {
    assert.equal(severityTone('incident').tone, 'crit')
    assert.equal(severityTone('maintenance').tone, 'warn')
    assert.equal(severityTone('info').tone, 'mute')
  })
})

describe('the chain verdict has THREE answers, not two', () => {
  it('a clean, checkpointed chain is verified', () => {
    assert.equal(chainTone({ ok: true, breaks: 0, everVerified: true }).word, 'VERIFIED')
  })

  it('a chain that has never been verified is NOT reported as OK', () => {
    // SD-16 verifies nightly and calls a break a P0, so a verification that has never run is a
    // control that is not running. Reporting it as green is reporting the absence of evidence as
    // evidence of absence.
    const tone = chainTone({ ok: true, breaks: 0, everVerified: false })
    assert.equal(tone.word, 'NEVER VERIFIED')
    assert.equal(tone.tone, 'warn')
  })

  it('a break outranks everything', () => {
    assert.equal(chainTone({ ok: false, breaks: 3, everVerified: true }).word, 'BROKEN')
    assert.equal(chainTone({ ok: true, breaks: 1, everVerified: false }).word, 'BROKEN')
  })

  it('reports a break even when the service said ok — the two are checked independently', () => {
    assert.equal(chainTone({ ok: true, breaks: 2, everVerified: true }).tone, 'crit')
  })
})

describe('hashes are shortened, never silently', () => {
  it('keeps a short hash whole', () => {
    assert.equal(shortHash('genesis:admin'), 'genesis:admin')
  })

  it('elides the middle of a long one, with a visible ellipsis', () => {
    const short = shortHash('a'.repeat(64))
    assert.match(short, /…/)
    assert.ok(short.length < 64)
  })

  it('renders null as an em dash', () => {
    assert.equal(shortHash(null), '—')
  })

  it('keeps both ends, so two different hashes do not collapse to one string', () => {
    const a = shortHash(`${'a'.repeat(58)}111111`)
    const b = shortHash(`${'a'.repeat(58)}222222`)
    assert.notEqual(a, b)
  })
})

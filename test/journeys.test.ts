/**
 * The browser journeys of `docs/ecosystem/22-browser-journeys.md` for the support console.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE RULE. Doc 22 §3: **a browser scenario may never assert a business rule.**
 *
 * The reason is an incident (14 §11): a game client withheld four SKUs from its UI while the
 * payment routes stayed live and chargeable, and a client-side test of the hidden catalogue would
 * have passed, green, against the defect — because hiding them WAS the entire control.
 *
 * `test/support.test.ts` already refuses to be the other kind of useless: it states that "nothing
 * below stubs `fetch`, and nothing below asserts that `SupportPage` calls `loadAudit`" because
 * that would be "a client test that asserts the client posts to the URL the client was written to
 * post to". This file does stub fetch — but it never asserts a route the implementation chose.
 * It asserts the two things a stub CAN establish honestly: that the screen asks BOTH of the
 * questions the operator needs (which is a property of the screen, not of the route), and that
 * what a human then sees is true relative to what the API returned in the same run.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS SCREEN IS FOR, AND THEREFORE WHAT MOST OF THIS FILE GUARDS
 *
 * **An empty result must never read as an answer.**
 *
 * Nothing in the estate published `*.audit.recorded` when this screen was built — the topic
 * `admin-api` consumes has no producer, and `admin-api/README.md` records the same
 * finding. So the log this screen reads holds `admin-api`'s own rows and no others, and an empty
 * timeline means *the mirror is missing* far more often than *the user did nothing*.
 *
 * A support agent shown a short, tidy timeline with no caveat concludes that little happened, and
 * tells the user so. That is the failure this console exists not to have, and it is the one a
 * source-text test cannot catch: `render.test.ts` can assert that `CoveragePanel` is called on the
 * empty branch, and cannot assert that an operator reading the empty result is told anything.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { DOC22_UNCLAIMED, SCENARIOS } from './journeys.ts'
import { SupportPage } from '../src/pages/support.tsx'

const ORIGIN = 'https://admin.cloudsforge.online'
const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

/** The console at `/support`, with whatever query the scenario is about. */
const consoleAt = (search = ''): ReactElement =>
  h(MemoryRouter, { initialEntries: [`/support${search}`] }, h(SupportPage))

/**
 * `GET /v1/audit` answering the two queries separately.
 *
 * ── WHY THE STUB DISCRIMINATES ON THE QUERY STRING ────────────────────────────────────────────
 *
 * The screen asks two different questions of one route — `actor=user:<id>` and
 * `subjectKind=user&subjectId=<id>` — because `admin-api`'s filters are equality matches on
 * indexed columns with no OR between them. A stub that returned one body to both would render the
 * same rows twice and let every scenario below pass against a screen that had confused them, or
 * against one that only asked once. Answering them apart is what makes BJ-SUP-01 and BJ-SUP-07
 * capable of failing.
 */
const audit = (byActor: unknown, bySubject: unknown): Routes => ({
  'GET /v1/audit': (w) => ({ body: /actor=/.test(w.path) ? byActor : bySubject }),
})

/** The `<section>` with this accessible name. */
function region(s: Screen, name: string): Element {
  const found = s.allByRole('region').filter((el) => el.getAttribute('aria-label') === name)
  assert.equal(found.length, 1, `expected exactly one region labelled "${name}", found ${found.length}`)
  return found[0] as Element
}

/** Look a user up through the form, the way an operator does. */
async function lookUp(s: Screen, id: string): Promise<void> {
  await s.type(s.byRole('searchbox', 'User id'), id)
  await s.click(s.byRole('button', 'Look up'))
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   BJ-ADM-23 — 05 journey 16. ⛔ in doc 22 on §8.4, "no support-lookup screen".
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-ADM-23 / BJ-SUP — the support console', () => {
  it('BJ-ADM-23 T1: a user id produces the correlation ids their history hangs off', async () => {
    // The threads this scenario arranges. Two, with different last-activity, so the ordering claim
    // ("most recent first") has something to be wrong about.
    const older = fx.event({ seq: '10', correlationId: 'corr-older', occurredAt: '2026-08-01T09:00:00.000Z' })
    const newer = fx.event({ seq: '20', correlationId: 'corr-newer', occurredAt: '2026-08-02T09:00:00.000Z' })

    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      { url: `${ORIGIN}/support`, routes: audit(fx.page([older]), fx.page([newer])) },
      async (s) => {
        const threads = s.textOf(region(s, 'Correlation ids'))
        // Presentation relative to what the API returned IN THIS SAME RUN — one row per distinct
        // correlation id in the response, whatever the response held.
        for (const id of [older.correlationId, newer.correlationId]) {
          assert.ok(threads.includes(id as string), `${id} is not among the threads`)
        }
        // Most recent thread first: a support request is almost always about something that just
        // happened, so the thread the agent wants is at the top.
        s.before(newer.correlationId as string, older.correlationId as string, 'threads are oldest-first')
        // And each is a link into the screen that already reads a thread, so the two halves of the
        // workflow join up rather than being two searches.
        assert.ok(s.queryByRole('link', newer.correlationId as string), 'a thread is not followable')
        s.clean('the support lookup')
      },
    )
  })

  it('BJ-SUP-01 ★ T1: BOTH questions are asked — what the user did, and what was done to them', async () => {
    const acted = fx.event({ id: 'evt-acted', seq: '1', actor: `user:${fx.USER_ID}` })
    // A refund taken ABOUT the user by somebody else. This is most of what a balance dispute turns
    // on, and a screen that asked only `actor` would omit every row like it.
    const doneToThem = fx.event({
      id: 'evt-refund',
      seq: '2',
      actor: 'user:00000000-0000-0000-0000-000000000001',
      action: 'ledger.entry.reverse',
      subjectKind: 'user',
      subjectId: fx.USER_ID,
    })

    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      { url: `${ORIGIN}/support`, routes: audit(fx.page([acted]), fx.page([doneToThem])) },
      async (s) => {
        // WHAT THE CLIENT SENT. Two requests, and the two filters are different — asserted against
        // the values this scenario supplied, not against anything read off the page.
        const asked = s.api.matching('GET /v1/audit')
        assert.equal(asked.length, 2, `the console asked ${asked.length} questions, not two`)
        const queries = asked.map((w) => new URL(w.url, ORIGIN).searchParams)
        const byActor = queries.find((q) => q.get('actor') !== null)
        const bySubject = queries.find((q) => q.get('subjectId') !== null)
        assert.ok(byActor, 'the console never asked what the user DID')
        assert.ok(bySubject, 'the console never asked what was done TO the user')
        assert.equal(byActor.get('actor'), `user:${fx.USER_ID}`)
        assert.equal(bySubject.get('subjectKind'), 'user')
        assert.equal(bySubject.get('subjectId'), fx.USER_ID)
        // Neither carries the other's filter: `admin-api` ANDs them, so one request holding both
        // would return the intersection and the screen would silently show far too little.
        assert.equal(byActor.get('subjectId'), null, 'the two filters were sent as one AND query')
        assert.equal(bySubject.get('actor'), null, 'the two filters were sent as one AND query')

        // And BOTH answers are on the page. The refund is the row that proves the second query is
        // not decoration.
        const timeline = s.textOf(region(s, 'Timeline'))
        assert.ok(timeline.includes(acted.action), 'the row the user acted on is missing')
        assert.ok(timeline.includes(doneToThem.action), 'the row taken ABOUT the user is missing')
        // The relation column says which question produced each, so the operator can see which of
        // the two they are reading.
        assert.ok(timeline.includes('they acted'), 'the relation is not named for the acted row')
        assert.ok(timeline.includes('done to them'), 'the relation is not named for the subject row')
      },
    )
  })

  it('BJ-SUP-02 ★ T1: an empty result is never an answer — the coverage panel renders on it', async () => {
    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      { url: `${ORIGIN}/support`, routes: audit(fx.page([]), fx.page([])) },
      async (s) => {
        // The empty state says what was asked, rather than "no data" — which describes the screen
        // and not the answer.
        assert.match(s.text(), /holds no rows naming this user/i, 'the empty state says nothing')

        // THE ASSERTION THIS SCREEN EXISTS FOR. The coverage panel is on the EMPTY result, and it
        // is the part that stops a short timeline from reading as a quiet account.
        const coverage = region(s, 'Coverage')
        const said = s.textOf(coverage)
        assert.match(said, /Every row here was written by admin-api itself/i, 'the blindness is not stated')
        assert.match(
          said,
          /evidence about the mirror, not about the user/i,
          'the empty result is not distinguished from "the user did nothing"',
        )
        // It names the services that contribute nothing, so "incomplete" is a list rather than a
        // feeling — including the three a balance dispute actually turns on.
        for (const service of ['ledger', 'wallet', 'settlement', 'custody', 'identity']) {
          assert.ok(said.includes(service), `${service} is not named as missing`)
        }
        assert.match(said, /every deposit, every withdrawal/i, 'the money rows are not called out')
        // And it is an ALERT, not a footnote: a caveat nobody hears is a caveat that is not there.
        assert.ok(coverage.querySelector('[role="alert"]'), 'the blindness is not announced')
        // The empty state must come BEFORE the caveat is needed, but the caveat must be on screen
        // with it — the operator reads down, and a caveat below the fold of the empty state would
        // arrive after the conclusion was drawn.
        s.before('holds no rows naming this user', 'written by admin-api itself', 'the caveat is not with the empty result')
      },
    )
  })

  it('BJ-SUP-03 ★ T1: the caveat narrows the moment a service mirrors, because it is derived from the rows', async () => {
    // The day a producer lands, this screen must tell the truth WITHOUT BEING EDITED. That is only
    // true if the caveat is computed from the rows rather than from a constant, and the only way
    // to establish it is to supply a row from a service other than admin-api and watch it change.
    const mirrored = fx.event({ id: 'evt-ledger', seq: '5', source: 'ledger', action: 'ledger.entry.post' })

    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      { url: `${ORIGIN}/support`, routes: audit(fx.page([mirrored]), fx.page([])) },
      async (s) => {
        const said = s.textOf(region(s, 'Coverage'))
        // The "nothing mirrors" sentence is GONE — not merely joined by a second one.
        assert.ok(
          !/Every row here was written by admin-api itself/i.test(said),
          'the caveat is a constant: a mirrored row did not narrow it',
        )
        // It now names what DID arrive, and what is still absent, from this run's rows.
        assert.ok(said.includes(mirrored.source), 'the service that mirrored is not named as present')
        assert.match(said, /Services still absent/i, 'the remaining gap is not named')
        for (const absent of ['wallet', 'settlement', 'custody']) {
          assert.ok(said.includes(absent), `${absent} is not named as still absent`)
        }
        // And `ledger` is not in the absent list — it is in the present one. Asserted as document
        // order, because both words are on the page and only their positions distinguish them.
        s.before('Rows arrived from', 'Services still absent', 'present and absent are the wrong way round')
      },
    )
  })

  it('BJ-SUP-04 T1: the five questions are on screen, each with the route it needs, none over-claimed', async () => {
    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      { url: `${ORIGIN}/support`, routes: audit(fx.page([fx.event()]), fx.page([])) },
      async (s) => {
        const said = s.textOf(region(s, 'Coverage'))
        // 05:455-461. Each of the five is named, and each carries what would answer it — because a
        // gap described in prose is a gap that has not been checked, and a named route is closeable.
        const questions = [
          /What does the user hold\?/i,
          /How did it get there\?/i,
          /Which service caused each entry\?/i,
          /Did a deposit land\?/i,
          /Was anything denied\?/i,
        ]
        for (const q of questions) assert.match(said, q, `05 journey 16's question ${q} is not on screen`)
        // Not one of them is claimed as fully answered. The screen answers the question that comes
        // BEFORE the five; claiming any of the five would be the console certifying itself.
        const answers = [...s.document.querySelectorAll('td')]
          .map((td) => s.textOf(td))
          .filter((t) => t === 'Yes' || t === 'No' || t === 'Partly')
        assert.equal(answers.length, 5, `expected five verdicts, found ${answers.length}`)
        assert.equal(answers.filter((a) => a === 'Yes').length, 0, 'a question is claimed as answered')
        assert.ok(answers.includes('No'), 'no question is admitted as unanswered')
        // And each names a real route rather than a shrug.
        assert.match(said, /ledger\/src\/server\.ts/, 'the routes that would answer are not cited')
      },
    )
  })

  it('BJ-SUP-05 ★ T1: a missing amount renders as an absence, never as a zero', async () => {
    // THE `BigInt('')` TRAP, on the screen where it costs the most. `BigInt('')` is `0n` and does
    // not throw; neither does `BigInt(' ')`. An amount read out of a payload this console does not
    // control and handed to BigInt without a check turns a missing field into a confident,
    // correctly-formatted zero — shown to an agent answering "my balance is wrong", who repeats it.
    const real = fx.event({ id: 'evt-amt', seq: '1', payload: { amount: '250' } })
    const empty = fx.event({ id: 'evt-empty', seq: '2', payload: { amount: '' } })
    const blank = fx.event({ id: 'evt-blank', seq: '3', payload: { amount: '   ' } })
    const absent = fx.event({ id: 'evt-none', seq: '4', payload: {} })
    const nan = fx.event({ id: 'evt-nan', seq: '5', payload: { amount: 'nonce-0001' } })

    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      {
        url: `${ORIGIN}/support`,
        routes: audit(fx.page([real, empty, blank, absent, nan]), fx.page([])),
      },
      async (s) => {
        const rows = [...s.document.querySelectorAll('tbody tr')]
        const cells = new Map(
          rows.map((tr) => [s.textOf(tr.querySelector('th')), s.textOf([...tr.querySelectorAll('td')][4])]),
        )
        // The row that HAS an amount shows it, so this scenario is not passing by rendering nothing.
        assert.equal(cells.get(real.seq), `${real.payload['amount'] as string}amount`)

        // The four that do not, do not show a zero. Each is checked for a DIGIT, because "0" is
        // exactly the output the defect produces and "no amount recorded" contains none.
        for (const ev of [empty, blank, absent, nan]) {
          const shown = cells.get(ev.seq) ?? ''
          assert.match(shown, /no amount recorded/i, `seq ${ev.seq} does not say the amount is absent`)
          assert.ok(!/\d/.test(shown), `seq ${ev.seq} rendered a figure for a missing amount: "${shown}"`)
        }
        // And nowhere on the timeline is there a bare zero standing in for an absence.
        assert.ok(
          !/(^|\s)0(\s|$)/.test(s.textOf(region(s, 'Timeline')).replace(real.payload['amount'] as string, '')),
          'a zero is standing in for a missing amount somewhere on the timeline',
        )
      },
    )
  })

  it('BJ-SUP-06 T1: the timeline is oldest-first and ordered by seq as a NUMBER', async () => {
    // `seq` is a decimal STRING because a bigint is not a JSON number. Sorted as strings, seq 9
    // comes after seq 10 — which reorders the events of an incident and is exactly the kind of
    // wrong that looks right. The fixture is chosen so a string sort and a numeric sort DISAGREE.
    const nine = fx.event({ id: 'evt-9', seq: '9', action: 'ninth.thing' })
    const ten = fx.event({ id: 'evt-10', seq: '10', action: 'tenth.thing' })
    const hundred = fx.event({ id: 'evt-100', seq: '100', action: 'hundredth.thing' })
    assert.ok(['9', '10', '100'].sort()[0] === '10', 'this fixture cannot distinguish the two sorts')

    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      { url: `${ORIGIN}/support`, routes: audit(fx.page([hundred, nine, ten]), fx.page([])) },
      async (s) => {
        const timeline = region(s, 'Timeline')
        const order = [...timeline.querySelectorAll('tbody tr')].map((tr) => s.textOf(tr.querySelector('th')))
        assert.deepEqual(
          order,
          ['9', '10', '100'],
          'the timeline is not in numeric seq order — sorted as strings, seq 9 follows seq 10 and ' +
            'an incident reads in the wrong sequence',
        )
        // Oldest first, which is the opposite of /audit's newest-first table and is deliberate:
        // "where did the money go" is a question about a sequence, and a sequence read backwards is
        // one the reader has to reverse.
        s.before(nine.action, hundred.action, 'the timeline is newest-first')
        assert.match(s.textOf(timeline), /oldest first/i, 'the order is not stated')
      },
    )
  })

  it('BJ-SUP-07 T1: a row arriving from both queries is reported once, as both', async () => {
    // The user acting on themselves. Keyed on the event ID rather than on seq, so the SAME row
    // arriving from both queries expresses the actual relationship instead of appearing twice — a
    // timeline that showed one event twice would make an agent counting movements count one too
    // many.
    const both = fx.event({ id: 'evt-self', seq: '7', subjectKind: 'user', subjectId: fx.USER_ID })

    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      { url: `${ORIGIN}/support`, routes: audit(fx.page([both]), fx.page([both])) },
      async (s) => {
        const rows = [...region(s, 'Timeline').querySelectorAll('tbody tr')]
        assert.equal(rows.length, 1, `one event returned by both queries produced ${rows.length} rows`)
        assert.match(s.textOf(rows[0] as Element), /both/, 'the doubled row is not reported as both')
        // The count in the caption agrees with the rows, so a reader who counts and a reader who
        // reads the caption reach the same number.
        assert.match(s.textOf(region(s, 'Timeline')), /\b1 row\b/, 'the caption disagrees with the rows')
      },
    )
  })

  it('BJ-SUP-08 ★ T1: rows with no correlation id are counted rather than dropped', async () => {
    const threaded = fx.event({ id: 'evt-t', seq: '1', correlationId: 'corr-known' })
    const orphanA = fx.event({ id: 'evt-o1', seq: '2', correlationId: null })
    const orphanB = fx.event({ id: 'evt-o2', seq: '3', correlationId: null })

    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      { url: `${ORIGIN}/support`, routes: audit(fx.page([threaded, orphanA, orphanB]), fx.page([])) },
      async (s) => {
        const threads = s.textOf(region(s, 'Correlation ids'))
        // A row with no correlation id CANNOT be joined to anything in another service, so it is a
        // hole in the answer to claim 9. An operator shown a tidy list with these quietly removed
        // would think the account was fully covered.
        assert.match(threads, /2 rows in this history carry no correlation id/i, 'the orphans are not counted')
        assert.match(threads, /would read as complete coverage|counted here rather than dropped/i, 'the reason is not given')
        // The thread list itself holds only the one real thread, so the count is not achieved by
        // inventing a thread for them.
        assert.match(threads, /\b1 thread\b/, 'the orphans were given a thread of their own')
        // And they are still on the timeline: counted in the spine, not removed from the history.
        assert.equal([...region(s, 'Timeline').querySelectorAll('tbody tr')].length, 3)
      },
    )
  })

  it('BJ-SUP-09 T1: a full page says the timeline does not reach the beginning of the account', async () => {
    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      {
        url: `${ORIGIN}/support`,
        // `nextCursor` non-null is the service saying there are older rows.
        routes: audit(fx.page([fx.event()], 'cursor-older'), fx.page([])),
      },
      async (s) => {
        assert.match(
          s.text(),
          /does not reach the beginning of the account/i,
          'a truncated history is presented as a complete one',
        )
        // And it says what to do instead of paging back through everything.
        assert.match(s.text(), /Follow a correlation id/i, 'no way out of the truncation is offered')
      },
    )
  })

  it('BJ-SUP-10 T1: a malformed id is refused out loud, not silently', async () => {
    await withScreen(
      consoleAt(),
      { url: `${ORIGIN}/support`, routes: {} },
      async (s) => {
        await lookUp(s, 'not-a-uuid')
        // A search box that goes quiet on a malformed id teaches the operator that this user has
        // no history, which during a dispute is the wrong conclusion delivered silently.
        assert.ok(s.allByRole('alert').length > 0, 'the refusal is not announced')
        assert.match(s.text(), /A user id is a uuid/i, 'the refusal does not say what is wrong')
        // Nothing was asked, so no empty result can be mistaken for an answer.
        assert.equal(s.api.matching('GET /v1/audit').length, 0, 'a malformed id was sent to the service')
        assert.ok(!/holds no rows naming this user/i.test(s.text()), 'a refusal rendered as an empty history')
      },
    )
  })

  it('BJ-SUP-11 ★ T1: the address is the state, and a second lookup never shows the first user’s history', async () => {
    let asked: string[] = []
    await withScreen(
      consoleAt(),
      {
        url: `${ORIGIN}/support`,
        routes: {
          'GET /v1/audit': (w) => {
            const q = new URL(w.url, ORIGIN).searchParams
            const who = q.get('actor')?.replace('user:', '') ?? q.get('subjectId') ?? ''
            asked.push(who)
            // Each user's history names the user it belongs to, so a screen showing the wrong one
            // is visible rather than a matter of trust.
            return { body: fx.page([fx.event({ id: `evt-${who}`, action: `acted.by.${who.slice(0, 8)}` })]) }
          },
        },
      },
      async (s) => {
        await lookUp(s, fx.USER_ID)
        assert.ok(s.text().includes(fx.USER_ID.slice(0, 8)), 'the first user’s history did not render')

        // A colleague handed this URL must land on the same user rather than on an empty box.
        assert.ok(
          s.document.querySelector(`input[value="${fx.USER_ID}"]`),
          'the looked-up id is not in the box, so the address is not shareable',
        )

        asked = []
        await s.type(s.byRole('searchbox', 'User id'), fx.OTHER_USER)
        await s.click(s.byRole('button', 'Look up'))

        // THE QUESTION CHANGED, SO THE REQUEST MUST HAVE. With the wrong dependency list the
        // request is never re-sent and the console shows the previous answer under the new id —
        // on a balance dispute, the wrong person's money with the right name on it.
        assert.deepEqual(
          [...new Set(asked)],
          [fx.OTHER_USER],
          'the second lookup did not re-ask, or asked about the first user',
        )
        assert.ok(s.text().includes(fx.OTHER_USER.slice(0, 8)), 'the second user’s history did not render')
        assert.ok(
          !s.text().includes(`acted.by.${fx.USER_ID.slice(0, 8)}`),
          'the first user’s rows are still on screen under the second user’s id',
        )
      },
    )
  })

  it('BJ-SUP-12 ★ T1: nothing on this screen acts', async () => {
    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      {
        url: `${ORIGIN}/support`,
        routes: audit(fx.page([fx.event({ outcome: 'refused' })]), fx.page([])),
      },
      async (s) => {
        // Every remedy 05's operator journeys reach for is a two-operator action in this estate.
        // A support screen that grew a shortcut around the approval queue would be ONE admin doing
        // what the journey requires two admins to do — which is why the shortcut is absent rather
        // than present and refusing. J13's release-a-stuck-withdrawal is the named case.
        const controls = s.allByRole('button').map((b) => s.textOf(b))
        assert.deepEqual(
          controls.sort(),
          ['Clear', 'Look up'],
          `the console offers controls beyond the lookup itself: ${controls.join(', ')}`,
        )
        for (const verb of [/release/i, /reverse/i, /refund/i, /freeze/i, /approve/i, /retry/i, /bump/i]) {
          assert.ok(!controls.some((c) => verb.test(c)), `an acting control matching ${verb} is on screen`)
        }

        // Nothing was written. Every request this screen made was a read.
        for (const call of s.api.wire) {
          assert.equal(call.method, 'GET', `the support console sent a ${call.method} to ${call.path}`)
        }
        // And it did not navigate anywhere either — a shortcut would show up here as well.
        assert.deepEqual(s.navigations, [], 'the console navigated away on its own')
      },
    )
  })

  it('BJ-SUP-13 T1: a forbidden lookup is its own screen, with no retry, and is not an empty history', async () => {
    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      {
        url: `${ORIGIN}/support`,
        routes: {
          'GET /v1/audit': {
            status: 403,
            requestId: 'cf-req-403x',
            body: fx.errorBody('forbidden', 'Your account is missing admin:read.', 'cf-req-403x'),
          },
        },
      },
      async (s) => {
        // FORBIDDEN outranks EMPTY. A "no results" that was actually a missing scope is one of the
        // three failures states.tsx exists to prevent.
        assert.ok(!/holds no rows naming this user/i.test(s.text()), 'a 403 rendered as an empty history')
        assert.match(s.text(), /do not have access|missing admin:read/i, 'the refusal is not stated')
        // No retry button: the request was understood and denied, and a button that cannot succeed
        // teaches the operator the console is unreliable.
        assert.equal(s.queryByRole('button', 'Try again'), null, 'a refusal offered a retry')
        assert.ok(s.text().includes('cf-req-403x'), 'the reference is not on screen')
      },
    )
  })

  it('BJ-SUP-14 ★ T1: a failed lookup is not an empty one, and offers the request id', async () => {
    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      {
        url: `${ORIGIN}/support`,
        routes: {
          'GET /v1/audit': {
            status: 503,
            requestId: 'cf-req-503y',
            body: fx.errorBody('upstream_unavailable', 'The audit store did not answer.', 'cf-req-503y'),
          },
        },
      },
      async (s) => {
        // FAILURE OUTRANKS EMPTINESS. A request that threw has told us nothing about whether data
        // exists, so reporting "nothing here" for a timeout is how an outage reads as a quiet week
        // — which on this screen is how an outage reads as an innocent account.
        assert.ok(!/holds no rows naming this user/i.test(s.text()), 'a 503 rendered as an empty history')
        assert.match(s.text(), /did not load/i, 'the failure is not named as one')
        assert.ok(s.text().includes('The audit store did not answer.'), 'the service’s reason is missing')
        assert.ok(s.text().includes('cf-req-503y'), 'the request id is not on screen')
        // Retrying MAY work here, unlike a 403, so the button is offered.
        assert.ok(s.queryByRole('button', 'Try again'), 'a retryable failure offers no retry')
      },
    )
  })

  it('BJ-SUP-15 T1: a correlation id is not accepted in the user box', async () => {
    await withScreen(
      consoleAt(),
      { url: `${ORIGIN}/support`, routes: {} },
      async (s) => {
        // A correlation id may be any `[A-Za-z0-9._-]{1,128}`, which INCLUDES every uuid — so a box
        // that took either could not tell which it had been given and would have to guess which
        // column to search. Guessing is not a thing a money surface does.
        await lookUp(s, 'corr-7f3a-not-a-user')
        assert.ok(s.allByRole('alert').length > 0, 'a correlation id was accepted silently')
        assert.match(s.text(), /not a correlation id|the audit screen/i, 'the operator is not told where to take it')
        assert.equal(s.api.matching('GET /v1/audit').length, 0, 'a correlation id was searched as a user')
        // And the box says which it wants, before the mistake rather than after.
        const box = s.byRole('searchbox', 'User id')
        assert.match(box.getAttribute('placeholder') ?? '', /not a correlation id/i, 'the box does not say what it takes')
      },
    )
  })

  it('BJ-SUP-16 T1: each thread carries its correlation id into the audit screen', async () => {
    // An id that needs encoding, so a link built by concatenation rather than by
    // `encodeURIComponent` is visible rather than a matter of trust.
    const correlationId = 'corr with spaces&and=signs'
    await withScreen(
      consoleAt(`?userId=${fx.USER_ID}`),
      { url: `${ORIGIN}/support`, routes: audit(fx.page([fx.event({ correlationId })]), fx.page([])) },
      async (s) => {
        const link = s.byRole('link', correlationId)
        const href = link.getAttribute('href') ?? ''
        // Parsed back out rather than string-compared: the assertion is that the AUDIT SCREEN will
        // receive this id, not that the href happens to contain some characters.
        const target = new URL(href, ORIGIN)
        assert.equal(target.pathname, '/audit', 'the thread does not lead to the audit screen')
        assert.equal(
          target.searchParams.get('correlationId'),
          correlationId,
          'the correlation id does not survive the link, so the two halves of the workflow do not join',
        )
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The meta-tests. Doc 22 §3.2.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

const ESTATE = new URL('../../', import.meta.url)
const siblingsPresent = existsSync(new URL('admin-api/src/server.ts', ESTATE))

describe('the catalogue and this file agree', () => {
  const source = readFileSync(at('test/journeys.test.ts'), 'utf8')

  /**
   * The scenarios, without the meta-tests that scan them.
   *
   * The guards below grep for shapes a scenario must not have, and every such pattern necessarily
   * appears in the guard that forbids it. Scanning the whole file makes each of them fail on a
   * correct file — the trap `test/render.test.ts` already records: "a guard that fires on
   * its own explanation trains people to delete the explanation."
   */
  const MARKER = "describe('the catalogue and this file agree'"
  const scenarios = source.slice(0, source.indexOf(MARKER))

  it('no id appears twice, and no id is both claimed and unclaimed', () => {
    const ids = SCENARIOS.map((s) => s.id)
    assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), 'an id appears twice in SCENARIOS')
    const overlap = ids.filter((id) => DOC22_UNCLAIMED.includes(id))
    assert.deepEqual(overlap, [], `${overlap.join(', ')} is listed as both covered and uncovered`)
  })

  it('no scenario is marked implemented without a test named for it', () => {
    for (const s of SCENARIOS) {
      if (s.blocked) continue
      assert.ok(
        new RegExp(`it\\('${s.id}[ ★]`).test(source),
        `${s.id} is in the catalogue as implemented and has no test named for it`,
      )
    }
  })

  it('no test is named for an id the catalogue does not carry', () => {
    // The direction that catches a citation drifting: four tests in this estate were recently found
    // grading the WRONG function because their citations had moved.
    const named = [...source.matchAll(/it\('(BJ-[A-Z0-9-]+)[ ★]/g)].map((m) => m[1] as string)
    const known = new Set(SCENARIOS.map((s) => s.id))
    for (const id of new Set(named)) {
      assert.ok(known.has(id), `a test is named ${id}, which is in no catalogue entry`)
    }
    assert.equal(
      new Set(named).size,
      SCENARIOS.filter((s) => !s.blocked).length,
      'the number of tests and the number of unblocked claims disagree',
    )
  })

  it('a scenario whose outcome depends on a server rule carries an ownedBy path', () => {
    // `not accepted` was in this pattern and has been removed, with the reason kept: it does not
    // distinguish a SERVER refusal from a client declining to send. BJ-SUP-15 is the second kind —
    // `parseSubject` refuses a correlation id in the user box because a box that took either could
    // not tell which it had been given — and no service is involved, so there is no owner to name.
    // The terms left all denote an answer a service gave. BJ-SUP-10 and BJ-SUP-13 still match, so
    // this guard keeps a live subject rather than becoming vacuous.
    const REFUSAL = /\b(refus|denie|denial|reject|forbidden|409|403|4xx)\w*/i
    for (const s of SCENARIOS) {
      if (s.blocked) continue
      if (!REFUSAL.test(s.what)) continue
      assert.ok(
        s.ownedBy,
        `${s.id} turns on a server-side refusal and names no test that owns it. Doc 22 §3.2: ` +
          `"a path, resolvable by grep, in the service that enforces the rule".`,
      )
      assert.match(s.ownedBy.path, /^[a-z-]+\/src\/[\w./-]+\.ts$/, `${s.id}'s ownedBy is malformed`)
    }
  })

  it(
    'every ownedBy path exists in the estate and its grep string matches',
    {
      // A REAL skip, reported as skipped. Six tests in this estate were recently found `return`ing
      // instead of skipping, so they reported as PASSED against work they had not done.
      skip: siblingsPresent
        ? false
        : 'the sibling repositories are not checked out beside this one, so the cited files ' +
          'cannot be read. This is the state in CI, whose ci.yml checks out only micro-ui.',
    },
    () => {
      for (const s of SCENARIOS) {
        if (!s.ownedBy) continue
        const file = new URL(s.ownedBy.path, ESTATE)
        assert.ok(existsSync(file), `${s.id} cites ${s.ownedBy.path}, which does not exist`)
        assert.ok(
          readFileSync(file, 'utf8').includes(s.ownedBy.grep),
          `${s.id} cites ${s.ownedBy.path} for "${s.ownedBy.grep}", which is not in that file — ` +
            `the citation has drifted`,
        )
      }
    },
  )

  it('every blocked scenario names its blocker, and no blocker is a shrug', () => {
    for (const s of SCENARIOS) {
      if (!s.blocked) continue
      assert.ok(s.blocked.length > 80, `${s.id}'s blocker is too short to be a reason`)
      assert.ok(
        /doc 22|§|does not exist|no producer|no route|has no|two-operator|README/i.test(s.blocked),
        `${s.id}'s blocker does not name a fact about the estate: ${s.blocked}`,
      )
    }
  })

  it('every caveat names what is NOT asserted, and why it cannot be', () => {
    for (const s of SCENARIOS) {
      if (!s.caveat) continue
      assert.ok(!s.blocked, `${s.id} is both blocked and caveated; pick one`)
      assert.ok(s.caveat.length > 120, `${s.id}'s caveat is too short to be a reason`)
      assert.ok(
        /because|is a property of|would pass against|cannot|14 §11/i.test(s.caveat),
        `${s.id}'s caveat does not say why the missing half is missing: ${s.caveat}`,
      )
    }
  })

  it('nothing here is tier 3 and implemented — tier 3 lives in micro-beacon', () => {
    for (const s of SCENARIOS) {
      if (s.tier !== 'T3') continue
      assert.ok(s.blocked, `${s.id} is tier 3 and not blocked; doc 22 §4 puts tier 3 in beacon`)
    }
  })

  it('every unblocks entry names a doc 22 §8 blocker and a file in THIS repository', () => {
    for (const s of SCENARIOS) {
      if (!s.unblocks) continue
      assert.match(s.unblocks.was, /§8\.\d/, `${s.id}'s "was" names no doc 22 section`)
      const cited = s.unblocks.by.match(/src\/[\w./-]+\.tsx?/)
      assert.ok(cited, `${s.id}'s "by" cites no source file: ${s.unblocks.by}`)
      assert.ok(existsSync(at(cited[0])), `${s.id} says ${cited[0]} removed the blocker; it does not exist`)
    }
  })

  it('no scenario in this file rendered nothing', () => {
    // `allowEmpty` turns off the assertion that makes every scenario worth running. Its presence
    // would mean a scenario had been walked past a red result rather than fixed.
    assert.equal(source.split(MARKER).length - 1, 2, 'the meta-test marker moved or multiplied')
    assert.ok(scenarios.length > 1000, 'the scenario region did not split out')
    assert.ok(!/allowEmpty/.test(scenarios), 'a scenario disabled the did-anything-render assertion')
    assert.ok(!/mountedText/.test(scenarios), 'a scenario replaced the forty-character rule')
  })

  it('no scenario asserts a business rule', () => {
    // Doc 22 §3, kept mechanical. 14 §11 is why.
    const banned: ReadonlyArray<readonly [RegExp, string]> = [
      [/hasScope|requiredScope|canDecide\(/i, 'an authorisation rule'],
      [/fourEyes|selfRaised.*assert|approvalGate\(/i, 'a four-eyes rule'],
    ]
    for (const [pattern, what] of banned) {
      assert.ok(!pattern.test(scenarios), `this file asserts ${what}, which is the server's to enforce`)
    }
  })
})

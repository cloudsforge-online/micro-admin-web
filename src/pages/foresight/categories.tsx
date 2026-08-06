/**
 * What this platform will run a market on, and what it refuses.
 *
 * This page has no controls. It exists because an approver is agreeing that a question is inside
 * a versioned allowlist, and a rule an operator cannot find at the moment they need it is a rule
 * they apply from memory — which for the three refusals is exactly the wrong way round, since the
 * space of terrible questions is larger than any list and the person writing the next one has
 * read the list (foresight/src/categories.ts).
 *
 * The allowlist is served from `GET /categories`, which is public and unauthenticated on purpose:
 * "a refusal list behind a token is a refusal list nobody can hold the platform to."
 */
import { useCallback } from 'react'
import { Empty, Failed, Forbidden, Loading } from '../../components/states.tsx'
import { loadCategories } from '../../lib/foresight.ts'
import { useResource } from '../../lib/resource.ts'

export function CategoriesPage() {
  const board = useResource(
    useCallback((signal) => loadCategories({ signal }), []),
    (data) => data.categories.length,
    'The allowlist could not be loaded.',
  )

  return (
    <>
      <div className="wt-page__head">
        <h1 className="wt-page__title">What we will run a market on</h1>
        <p className="wt-page__meta">
          {board.data ? `Allowlist version ${board.data.version}` : 'Versioned in the repository'}
        </p>
      </div>

      {board.state === 'loading' && <Loading label="Loading the allowlist" />}
      {board.state === 'forbidden' && <Forbidden notice={board.error ?? undefined} />}
      {board.state === 'failed' && board.error && (
        <Failed notice={board.error} onRetry={board.reload} title="The allowlist did not load" />
      )}
      {board.state === 'empty' && (
        <Empty
          title="The service returned no categories"
          hint="That is not an empty allowlist — an allowlist with nothing in it would mean no question is approvable. Treat it as a failure and do not approve anything."
        />
      )}

      {board.state === 'ok' && board.data && (
        <>
          <p className="aw-lede">
            Three categories, and nothing else is approvable. They share one property, which is the
            actual rule: <strong>the resolution is a public fact with a public record, about a
            system rather than about a person.</strong> Ask whether you could settle the question
            by pointing at a URL and having every reasonable reader agree. If not, it is not in
            scope, whatever list it appears to fit.
          </p>

          {board.data.categories.map((category) => (
            <section className="wt-panel" key={category.id}>
              <div className="wt-panel__head">
                <h2 className="wt-panel__title">{category.title}</h2>
                <span className="wt-chip">{category.id}</span>
              </div>
              <p className="aw-lede aw-lede--tight">{category.description}</p>
              <dl className="wt-facts">
                <dt>Settles from</dt>
                <dd>{category.sourceKinds.join(', ')}</dd>
              </dl>
            </section>
          ))}

          <h2 className="aw-section">And what we refuse</h2>
          <p className="aw-lede">
            These are not a text filter and must not become one: a rule that looked for the word
            “die” would pass “will X still be with us in June” and would fail a market about a
            protocol being deprecated. The enforcement is that only the three categories above are
            approvable, and that a person approves. They are written down so that a discarded
            proposal is recorded against one of them rather than as free text nobody can count.
          </p>
          {board.data.refusals.map((refusal) => (
            <section className="wt-panel aw-refusal" key={refusal.id}>
              <div className="wt-panel__head">
                <h3 className="wt-panel__title">
                  <span aria-hidden="true">⊘ </span>
                  {refusal.id}
                </h3>
              </div>
              <p className="aw-lede aw-lede--tight">{refusal.reason}</p>
            </section>
          ))}
        </>
      )}
    </>
  )
}

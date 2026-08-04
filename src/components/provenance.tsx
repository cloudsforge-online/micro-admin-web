/**
 * Why this market was proposed, rendered so that it is read.
 *
 * The sources come FIRST and they are the largest thing in the block, above the model id and the
 * prompt hash. That ordering is the point of the component: the audit fields prove which run
 * produced the proposal, but the sources are the only part an operator can actually check the
 * resolution criteria against, and a layout that puts a hash where the eye lands first has
 * quietly made the checkable thing secondary.
 *
 * `onOpen` is called the first time the sources are expanded, and the queue page uses it to
 * release the approval control. See `approvalGate` in lib/provenance.ts.
 */
import { Fragment, useId, useState } from 'react'
import type { IdeaSource } from '../lib/foresight.ts'
import { prepareSources, type ProvenanceRow } from '../lib/provenance.ts'

export function Sources({
  sources,
  onOpen,
  defaultOpen = false,
}: {
  sources: readonly IdeaSource[]
  onOpen?: (() => void) | undefined
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const prepared = prepareSources(sources)

  if (prepared.length === 0) {
    return (
      <p className="aw-note aw-note--crit" role="status">
        <span className="aw-note__icon" aria-hidden="true">
          ■
        </span>
        This proposal cites no sources. There is nothing here to check its resolution criteria
        against.
      </p>
    )
  }

  return (
    <div className="aw-sources">
      <button
        type="button"
        className="aw-sources__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          const next = !open
          setOpen(next)
          // Fired on OPEN only, and it is not undone by collapsing again: the operator has seen
          // them. A gate that re-locks when a panel is tidied away punishes tidiness.
          if (next) onOpen?.()
        }}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {prepared.length} cited source
        {prepared.length === 1 ? '' : 's'}
      </button>

      {open && (
        <ul className="aw-sources__list" id={panelId}>
          {prepared.map((source, i) => (
            <li className="aw-sources__item" key={`${source.url}-${i}`}>
              {source.href === null ? (
                <>
                  <span className="aw-sources__title">{source.title}</span>
                  <span className="aw-note aw-note--warn aw-sources__warn">
                    <span className="aw-note__icon" aria-hidden="true">
                      ▲
                    </span>
                    Not a web address this panel will open. Shown as text:{' '}
                    <code className="cf-num">{source.url}</code>
                  </span>
                </>
              ) : (
                <a
                  className="aw-sources__title"
                  href={source.href}
                  // An operator following a citation must not lose the console they are working
                  // in, and `noreferrer` keeps this origin out of the referrer sent to a site
                  // nobody in this estate chose.
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {source.title}
                </a>
              )}
              <span className="aw-sources__meta">
                {source.host ?? 'unknown host'}
                {source.retrievedAt === null ? '' : ` · retrieved ${source.retrievedAt}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The audit fields, under the sources. Every one is shown, including the ones that are absent.
 *
 * `dt`/`dd` are emitted as direct children of the `dl` rather than wrapped a row at a time,
 * because `.wt-facts` is a two-column grid and a wrapper div would collapse both columns into one
 * cell — which looks like a styling accident and is actually a broken definition list.
 */
export function ProvenanceFacts({ rows }: { rows: readonly ProvenanceRow[] }) {
  return (
    <dl className="wt-facts aw-provenance">
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt>{row.label}</dt>
          <dd className={row.mono ? 'aw-mono' : undefined}>{row.value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

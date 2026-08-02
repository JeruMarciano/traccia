import { useState } from 'react'
import type { Candidate } from '../../core/types'
import { STRINGS } from '../strings'

/**
 * What the documents appear to describe, offered for confirmation. Everything starts
 * ticked — the common case is "yes, that is what the company uses" — and one untick keeps
 * a false match off the map. Nothing happens until the confirm button; discard drops the
 * whole batch, and with it the extracted text.
 */

interface Props {
  candidates: Candidate[]
  /** The documents actually read, named so it is obvious which files this list came from. */
  read: string[]
  onConfirm: (confirmed: Candidate[]) => void
  onCancel: () => void
}

export function SuggestionsPanel({ candidates, read, onConfirm, onCancel }: Props) {
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())

  const toggle = (id: string): void => {
    setUnticked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="suggestions" aria-label={STRINGS.suggestionsHeading}>
      <h2 className="suggestions-head">
        <span>{STRINGS.suggestionsHeading}</span>
        <span className="suggestions-count">{candidates.length}</span>
      </h2>
      <p className="suggestions-read">{STRINGS.suggestionsRead(read.length, read.join(', '))}</p>
      <p className="suggestions-caption">{STRINGS.suggestionsCaption}</p>
      <ul className="suggestions-list">
        {candidates.map((c) => (
          <li key={c.id} className="suggestion">
            <label className="suggestion-row">
              <input
                type="checkbox"
                checked={!unticked.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span className="suggestion-name">{c.name}</span>
              <span className="suggestion-tag">
                {c.layer === 'internal' ? STRINGS.suggestionInternal : STRINGS.suggestionExternal}
              </span>
              <span className="suggestion-group">{c.purposeGroup}</span>
            </label>
            <p className="suggestion-evidence">“{c.evidence}”</p>
            <p className="suggestion-sources">{STRINGS.suggestionFoundIn(c.sourceNames.join(', '))}</p>
          </li>
        ))}
      </ul>
      <div className="suggestions-actions">
        <button
          className="action"
          onClick={() => onConfirm(candidates.filter((c) => !unticked.has(c.id)))}
        >
          {STRINGS.suggestionsConfirm}
        </button>
        <button className="action" onClick={onCancel}>{STRINGS.suggestionsCancel}</button>
      </div>
    </section>
  )
}

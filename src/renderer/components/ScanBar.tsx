import { useState } from 'react'
import { STRINGS } from '../strings'

/**
 * The scan control: a URL field, a submit, and — while a scan runs — a stop button in its place.
 * Presentational only. It holds the text the user is typing and nothing about the project; the
 * scan itself, the resulting project state, and any notice are all owned by `App`.
 */

interface Props {
  scanning: boolean
  onScan: (url: string) => void
  onCancel: () => void
}

export function ScanBar({ scanning, onScan, onCancel }: Props) {
  const [url, setUrl] = useState('')

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    if (url.trim() === '' || scanning) return
    onScan(url.trim())
  }

  return (
    <form className="scanbar" onSubmit={submit}>
      <input
        className="scan-input"
        type="text"
        value={url}
        placeholder={STRINGS.scanPlaceholder}
        disabled={scanning}
        onChange={(e) => setUrl(e.target.value)}
      />
      {scanning ? (
        <button type="button" className="action" onClick={onCancel}>
          {STRINGS.scanCancel}
        </button>
      ) : (
        <button type="submit" className="action">
          {STRINGS.scan}
        </button>
      )}
    </form>
  )
}

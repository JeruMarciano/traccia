import { useMemo, useState } from 'react'
import { createEmptyProject } from '../core/project'
import { computeLayout } from '../core/layout'
import { initHistory, push, undo, redo, canUndo, canRedo } from '../core/history'
import { ingestScan } from '../core/scan'
import { extractCandidates, ingestDocument } from '../core/documents'
import type { Candidate, InternalSystemDictionary, VendorDictionary } from '../core/types'
import vendorsJson from '../data/vendors.json'
import internalSystemsJson from '../data/internalSystems.json'
import { DetailPanel } from './components/DetailPanel'
import { MapView } from './components/MapView'
import { ScanBar } from './components/ScanBar'
import { SuggestionsPanel } from './components/SuggestionsPanel'
import {
  openProject as openViaShell,
  saveProject as saveViaShell,
  startScan,
  cancelScan,
  scanNotice,
  pickAndExtractDocuments,
} from './bridge'
import { saveNotice } from './saveNotice'
import { scanResultNotice } from './scanResultNotice'
import type { LastScan } from './printGapsNotice'
import { printGapsNotice } from './printGapsNotice'
import { STRINGS } from './strings'
import { STYLESHEET } from './theme'

const VENDORS = vendorsJson as VendorDictionary
const INTERNAL_SYSTEMS = internalSystemsJson as InternalSystemDictionary

export function App() {
  const [history, setHistory] = useState(() =>
    initHistory(createEmptyProject(STRINGS.untitled, new Date().toISOString())),
  )
  const project = history.present
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  // What the printed sheet says about possible gaps, if anything. Not part of the project: a
  // scan's completeness belongs to the session that ran it, not to the file, so opening a
  // different project clears it rather than carrying a stale claim onto someone else's map.
  const [lastScan, setLastScan] = useState<LastScan | null>(null)
  // What the documents appear to describe, awaiting the user's tick. The extracted text
  // behind these candidates is already gone — only the evidence snippets survive to here.
  const [suggestions, setSuggestions] = useState<{
    candidates: Candidate[]
    read: string[]
  } | null>(null)

  const layout = useMemo(() => computeLayout(project, { width: 800, height: 500 }), [project])

  async function openProject(): Promise<void> {
    try {
      const p = await openViaShell()
      setNotice(null)
      if (p) {
        setHistory(initHistory(p))
        setLastScan(null)
      }
    } catch {
      // Rust deliberately throws a short, neutral sentence carrying no filesystem path and
      // nothing out of the map, so that nothing sensitive reaches the system log. The same
      // wording is repeated here rather than read off the rejection.
      setNotice(STRINGS.openFailed)
    }
  }

  async function saveProject(): Promise<void> {
    try {
      await saveViaShell(project)
      setNotice(null)
    } catch (e) {
      // Two sentences can come back: the file is held open by another program, which the user can
      // act on, or the generic failure. saveNotice picks between the renderer's own copies of the
      // two; nothing out of the rejection is shown.
      setNotice(saveNotice(e))
    }
  }

  async function runScan(url: string): Promise<void> {
    setScanning(true)
    try {
      const result = await startScan(url)
      setHistory((h) => push(h, ingestScan(h.present, result, VENDORS, { prefix: `scan${h.past.length + 1}` })))
      setNotice(scanResultNotice(result))
      setLastScan({ possibleGaps: result.possibleGaps, stoppedEarly: result.stoppedEarly })
    } catch (e) {
      setNotice(scanNotice(e))
    } finally {
      setScanning(false)
    }
  }

  async function addDocuments(): Promise<void> {
    try {
      const { documents, unreadable, truncated, noText } = await pickAndExtractDocuments()
      const notes: string[] = []
      if (unreadable.length > 0) notes.push(STRINGS.documentsUnreadable(unreadable.join(', ')))
      if (noText.length > 0) notes.push(STRINGS.documentsNoText(noText.join(', ')))
      if (truncated.length > 0) notes.push(STRINGS.documentsTruncated(truncated.join(', ')))
      if (documents.length === 0) {
        // The picker was cancelled, or nothing readable came back.
        setNotice(notes.length > 0 ? notes.join(' ') : null)
        return
      }
      const found = extractCandidates(documents, VENDORS, INTERNAL_SYSTEMS)
      if (found.length === 0) notes.push(STRINGS.documentsNothingFound)
      setNotice(notes.length > 0 ? notes.join(' ') : null)
      setSuggestions(found.length > 0 ? { candidates: found, read: documents.map((d) => d.name) } : null)
    } catch {
      setNotice(STRINGS.documentsFailed)
    }
  }

  function confirmSuggestions(chosen: Candidate[]): void {
    setSuggestions(null)
    if (chosen.length === 0) return
    setHistory((h) => push(h, ingestDocument(h.present, chosen)))
  }

  async function stopScan(): Promise<void> {
    try {
      await cancelScan()
    } catch {
      // The scan's own completion path already reports whatever happened; a rejection here
      // has nothing further for the user to act on.
    }
  }

  // The title block dates the sheet, which matters once it is printed and left with a client.
  // A project file is only checked for a string, so the date is shown only when it reads as one.
  const started = /^\d{4}-\d{2}-\d{2}/.test(project.createdAt) ? project.createdAt.slice(0, 10) : null
  const printGaps = printGapsNotice(lastScan)

  return (
    <>
      <style>{STYLESHEET}</style>
      <div className="sheet">
        <main className="plate">
          <header className="titleblock">
            <span className="wordmark">{STRINGS.appName}</span>
            <h1 className="project">{project.name}</h1>
            {started === null ? null : <span className="drawn">{STRINGS.startedOn(started)}</span>}
            <div className="actions">
              <button className="action" onClick={openProject}>{STRINGS.open}</button>
              <button className="action" onClick={saveProject}>{STRINGS.save}</button>
              <button className="action" disabled={!canUndo(history)} onClick={() => setHistory(undo)}>
                {STRINGS.undo}
              </button>
              <button className="action" disabled={!canRedo(history)} onClick={() => setHistory(redo)}>
                {STRINGS.redo}
              </button>
              <button className="action" onClick={() => void addDocuments()}>{STRINGS.addDocuments}</button>
              <button className="action" onClick={() => window.print()}>{STRINGS.print}</button>
            </div>
          </header>
          <ScanBar scanning={scanning} onScan={(url) => void runScan(url)} onCancel={() => void stopScan()} />
          {notice === null ? null : (
            <p className="notice" role="status">
              {notice}
              <button className="action" onClick={() => setNotice(null)}>{STRINGS.dismiss}</button>
            </p>
          )}
          {suggestions === null ? null : (
            <SuggestionsPanel
              candidates={suggestions.candidates}
              read={suggestions.read}
              onConfirm={confirmSuggestions}
              onCancel={() => setSuggestions(null)}
            />
          )}
          <MapView layout={layout} selected={selected} onSelect={setSelected} />
          <div className="print-only">
            <p className="print-limits">{STRINGS.printLimits}</p>
            {printGaps === null ? null : <p className="print-gaps">{printGaps}</p>}
          </div>
        </main>
        {selected === null ? null : (
          <DetailPanel project={project} selected={selected} dictionary={VENDORS} />
        )}
      </div>
    </>
  )
}

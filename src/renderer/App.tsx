import { useMemo, useState } from 'react'
import { createEmptyProject } from '../core/project'
import { computeGaps } from '../core/gaps'
import { computeLayout } from '../core/layout'
import { initHistory, push, undo, redo, canUndo, canRedo } from '../core/history'
import { ingestScan } from '../core/scan'
import type { VendorDictionary } from '../core/types'
import vendorsJson from '../data/vendors.json'
import { MapView } from './components/MapView'
import { RegisterPanel } from './components/RegisterPanel'
import { ScanBar } from './components/ScanBar'
import { openProject as openViaShell, saveProject as saveViaShell, startScan, cancelScan, scanNotice } from './bridge'
import { saveNotice } from './saveNotice'
import { scanResultNotice } from './scanResultNotice'
import { STRINGS } from './strings'
import { STYLESHEET } from './theme'

const VENDORS = vendorsJson as VendorDictionary

export function App() {
  const [history, setHistory] = useState(() =>
    initHistory(createEmptyProject(STRINGS.untitled, new Date().toISOString())),
  )
  const project = history.present
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const layout = useMemo(() => computeLayout(project, { width: 800, height: 500 }), [project])
  const gaps = useMemo(() => computeGaps(project), [project])

  async function openProject(): Promise<void> {
    try {
      const p = await openViaShell()
      setNotice(null)
      if (p) setHistory(initHistory(p))
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
    } catch (e) {
      setNotice(scanNotice(e))
    } finally {
      setScanning(false)
    }
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
            </div>
          </header>
          <ScanBar scanning={scanning} onScan={(url) => void runScan(url)} onCancel={() => void stopScan()} />
          {notice === null ? null : (
            <p className="notice" role="status">
              {notice}
              <button className="action" onClick={() => setNotice(null)}>{STRINGS.dismiss}</button>
            </p>
          )}
          <MapView layout={layout} selected={selected} onSelect={setSelected} />
        </main>
        <RegisterPanel gaps={gaps} onHover={setSelected} />
      </div>
    </>
  )
}

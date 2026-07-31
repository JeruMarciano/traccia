import { useMemo, useState } from 'react'
import { createEmptyProject } from '../core/project'
import { computeGaps } from '../core/gaps'
import { computeLayout } from '../core/layout'
import { initHistory, undo, redo, canUndo, canRedo } from '../core/history'
import type { Project } from '../core/types'
import { MapView } from './components/MapView'
import { RegisterPanel } from './components/RegisterPanel'
import { saveNotice } from './saveNotice'
import { STRINGS } from './strings'
import { STYLESHEET } from './theme'

declare global {
  interface Window {
    traccia: {
      openProject(): Promise<Project | null>
      saveProject(p: Project): Promise<boolean>
    }
  }
}

export function App() {
  const [history, setHistory] = useState(() =>
    initHistory(createEmptyProject(STRINGS.untitled, new Date().toISOString())),
  )
  const project = history.present
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const layout = useMemo(() => computeLayout(project, { width: 800, height: 500 }), [project])
  const gaps = useMemo(() => computeGaps(project), [project])

  async function openProject(): Promise<void> {
    try {
      const p = await window.traccia.openProject()
      setNotice(null)
      if (p) setHistory(initHistory(p))
    } catch {
      // The main process deliberately throws a short, neutral message carrying no filesystem
      // path and nothing out of the map, so that nothing sensitive reaches the system log. The
      // same wording is repeated here rather than read off the rejection, because Electron
      // wraps an IPC rejection in its own "Error invoking remote method ..." text on the way
      // across.
      setNotice(STRINGS.openFailed)
    }
  }

  async function saveProject(): Promise<void> {
    try {
      await window.traccia.saveProject(project)
      setNotice(null)
    } catch (e) {
      // Two sentences can come back: the file is held open by another program, which the user can
      // act on, or the generic failure. saveNotice picks between the renderer's own copies of the
      // two; nothing out of the rejection is shown.
      setNotice(saveNotice(e))
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

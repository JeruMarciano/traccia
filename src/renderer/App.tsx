import { useMemo, useState } from 'react'
import { createEmptyProject } from '../core/project'
import { computeGaps } from '../core/gaps'
import { computeLayout } from '../core/layout'
import type { Project } from '../core/types'
import { MapView } from './components/MapView'
import { RegisterPanel } from './components/RegisterPanel'

declare global {
  interface Window {
    traccia: {
      openProject(): Promise<Project | null>
      saveProject(p: Project): Promise<boolean>
    }
  }
}

// The main process deliberately throws a short, neutral message carrying no filesystem path and
// nothing out of the map, so that nothing sensitive reaches the system log. The same wording is
// repeated here rather than read off the rejection, because Electron wraps an IPC rejection in
// its own "Error invoking remote method ..." text on the way across.
const OPEN_FAILED = 'This file could not be read as a project.'
const SAVE_FAILED = 'The project could not be saved.'

export function App() {
  const [project, setProject] = useState<Project>(() =>
    createEmptyProject('Untitled', new Date().toISOString()),
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const layout = useMemo(() => computeLayout(project, { width: 800, height: 500 }), [project])
  const gaps = useMemo(() => computeGaps(project), [project])

  async function openProject(): Promise<void> {
    try {
      const p = await window.traccia.openProject()
      setNotice(null)
      if (p) setProject(p)
    } catch {
      setNotice(OPEN_FAILED)
    }
  }

  async function saveProject(): Promise<void> {
    try {
      await window.traccia.saveProject(project)
      setNotice(null)
    } catch {
      setNotice(SAVE_FAILED)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#F7F6F2' }}>
      <main style={{ flex: 1, padding: 20 }}>
        <header style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 16 }}>
          <strong>{project.name}</strong>
          <button onClick={openProject}>Open</button>
          <button onClick={saveProject}>Save</button>
        </header>
        {notice === null ? null : (
          <p role="status"
             style={{ display: 'flex', gap: 12, justifyContent: 'space-between',
                      alignItems: 'baseline', margin: '0 0 16px', padding: '10px 12px',
                      border: '1px solid #D8D4CB', fontSize: 12, color: '#17171A' }}>
            {notice}
            <button onClick={() => setNotice(null)}>Dismiss</button>
          </p>
        )}
        <MapView layout={layout} selected={selected} onSelect={setSelected} />
      </main>
      <RegisterPanel gaps={gaps} onHover={setSelected} />
    </div>
  )
}

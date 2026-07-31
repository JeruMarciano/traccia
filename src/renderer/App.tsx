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

export function App() {
  const [project, setProject] = useState<Project>(() =>
    createEmptyProject('Untitled', new Date().toISOString()),
  )
  const [selected, setSelected] = useState<string | null>(null)

  const layout = useMemo(() => computeLayout(project, { width: 800, height: 500 }), [project])
  const gaps = useMemo(() => computeGaps(project), [project])

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#F7F6F2' }}>
      <main style={{ flex: 1, padding: 20 }}>
        <header style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 16 }}>
          <strong>{project.name}</strong>
          <button onClick={async () => {
            const p = await window.traccia.openProject()
            if (p) setProject(p)
          }}>Open</button>
          <button onClick={() => window.traccia.saveProject(project)}>Save</button>
        </header>
        <MapView layout={layout} selected={selected} onSelect={setSelected} />
      </main>
      <RegisterPanel gaps={gaps} onHover={setSelected} />
    </div>
  )
}

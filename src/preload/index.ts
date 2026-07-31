import { contextBridge, ipcRenderer } from 'electron'
import type { Project } from '../core/types'

contextBridge.exposeInMainWorld('traccia', {
  openProject: (): Promise<Project | null> => ipcRenderer.invoke('project:open'),
  saveProject: (project: Project): Promise<boolean> =>
    ipcRenderer.invoke('project:save', project),
})

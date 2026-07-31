import { dialog, ipcMain } from 'electron'
import { readProjectFile, writeProjectFile } from './projectFile'
import { validateProject } from '../core/project'

const FILTERS = [{ name: 'Traccia project', extensions: ['json'] }]

export function registerIpc(): void {
  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: FILTERS })
    if (r.canceled || !r.filePaths[0]) return null
    return readProjectFile(r.filePaths[0])
  })

  ipcMain.handle('project:save', async (_e, project: unknown) => {
    // Never trust the renderer. Validate before anything reaches the disk.
    const checked = validateProject(project)
    if (!checked.ok) throw new Error(checked.errors.join('\n'))

    const r = await dialog.showSaveDialog({ filters: FILTERS })
    if (r.canceled || !r.filePath) return false
    await writeProjectFile(r.filePath, checked.project)
    return true
  })
}

import { dialog, ipcMain } from 'electron'
import { readProjectFile, writeProjectFile, SAVE_BLOCKED_BY_LOCK } from './projectFile'
import { validateProject } from '../core/project'

const FILTERS = [{ name: 'Traccia project', extensions: ['json'] }]

// Anything a handler throws is written to the process console by Electron's ipcMain.handle
// wrapper. In a Finder-launched macOS build that lands in the system log, which is collected by
// sysdiagnose and handed to third parties. Two kinds of detail must therefore never escape a
// handler: absolute filesystem paths (Node fs errors quote them verbatim) and anything out of the
// user's map (validateProject quotes place and flow ids). Each handler throws one of these fixed
// strings instead, with no `cause` attached -- a cause would be printed alongside the error and
// put the detail straight back in the log. The user is told the action did not complete, not
// which entry is at fault; for a tool whose promise is that the map never leaves the machine,
// that is the right trade.
const OPEN_FAILED = 'This file could not be read as a project.'
const SAVE_FAILED = 'The project could not be saved.'

// The single exception: writeProjectFile's file-is-locked sentence, which is a compile-time
// constant with nothing interpolated into it, and the one save failure a user can act on. The
// caught error is compared to it by exact equality and then discarded -- what is thrown is the
// constant itself, never the caught error and never its text. So the value leaving the save
// handler is always one of two literals fixed at compile time, and no path or project content can
// travel with it.
function saveFailureMessage(err: unknown): string {
  return err instanceof Error && err.message === SAVE_BLOCKED_BY_LOCK
    ? SAVE_BLOCKED_BY_LOCK
    : SAVE_FAILED
}

export function registerIpc(): void {
  ipcMain.handle('project:open', async () => {
    try {
      const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: FILTERS })
      if (r.canceled || !r.filePaths[0]) return null
      return await readProjectFile(r.filePaths[0])
    } catch {
      throw new Error(OPEN_FAILED)
    }
  })

  ipcMain.handle('project:save', async (_e, project: unknown) => {
    try {
      // Never trust the renderer. Validate before anything reaches the disk.
      const checked = validateProject(project)
      if (!checked.ok) throw new Error(SAVE_FAILED)

      const r = await dialog.showSaveDialog({ filters: FILTERS })
      if (r.canceled || !r.filePath) return false
      await writeProjectFile(r.filePath, checked.project)
      return true
    } catch (err) {
      throw new Error(saveFailureMessage(err))
    }
  })
}

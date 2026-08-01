import { invoke } from '@tauri-apps/api/core'
import { validateProject } from '../core/project'
import type { Project } from '../core/types'
import { STRINGS } from './strings'

/**
 * The only file in the renderer that knows which shell it is running in. Under Electron this was
 * `src/preload/index.ts` and the surface was `window.traccia`; the shape is kept deliberately, so
 * a third shell would touch this file and nothing else.
 *
 * Rust checks what protects the machine — the bytes parse, the top level is an object, there is
 * an integer schemaVersion, the payload is under the size cap. `validateProject` here checks what
 * protects the map, and stays the single source of truth for its shape. No filesystem path
 * crosses this boundary in either direction: the dialogs are opened by Rust.
 */
export async function openProject(): Promise<Project | null> {
  const raw = await invoke<string | null>('open_project')
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(STRINGS.openFailed)
  }

  const result = validateProject(parsed)
  if (!result.ok) throw new Error(STRINGS.openFailed)
  return result.project
}

export async function saveProject(project: Project): Promise<boolean> {
  const result = validateProject(project)
  if (!result.ok) throw new Error(STRINGS.saveFailed)
  // Two-space indentation, as the Electron main process wrote it, so a project file saved before
  // and after the port diffs cleanly. Rust writes these bytes verbatim once its structural check
  // passes.
  return invoke<boolean>('save_project', { projectJson: JSON.stringify(result.project, null, 2) })
}

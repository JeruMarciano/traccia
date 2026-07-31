import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { validateProject } from '../core/project'
import type { Project } from '../core/types'

export async function readProjectFile(path: string): Promise<Project> {
  const raw = await readFile(path, 'utf8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('This file could not be read as a project.')
  }

  const result = validateProject(parsed)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.project
}

const RETRY_DELAYS_MS = [0, 50, 150, 400]

function isTransientWindowsLock(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function writeProjectFile(path: string, project: Project): Promise<void> {
  // Date.now() is fine here: this is src/main, not src/core, and the name only needs to be unique.
  const tmp = join(dirname(path), `.${Date.now()}.tmp`)
  try {
    await writeFile(tmp, JSON.stringify(project, null, 2), 'utf8')

    // rename overwrites on both platforms, but on Windows it fails transiently when antivirus or
    // another program holds the target open. Retry rather than surfacing an error nobody can act on.
    let lastError: unknown
    for (const delay of RETRY_DELAYS_MS) {
      if (delay > 0) await wait(delay)
      try {
        await rename(tmp, path)
        return
      } catch (err) {
        if (!isTransientWindowsLock(err)) throw err
        lastError = err
      }
    }
    throw new Error(
      'The project could not be saved because another program is holding the file open. ' +
        'Close it and try again.',
      { cause: lastError },
    )
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}

import { readFile, rename, unlink, open, stat } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
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

// The project file is the complete map of the organisation's personal-data flows. In the
// absence of any pre-existing permissions to carry forward (i.e. this is a brand new file),
// default to owner-only access rather than the platform default (typically 0644/0666), so a
// save never leaves the map more widely readable than the user would reasonably expect on a
// shared machine.
const DEFAULT_FILE_MODE = 0o600

function isTransientWindowsLock(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function existingMode(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode & 0o777
  } catch {
    // No existing file (or it can't be stat'ed) -- there is nothing to carry forward.
    return undefined
  }
}

// Best-effort fsync of the containing directory so the rename's metadata (the entry now
// pointing at the new inode) is also flushed, not just the file's data blocks. Some
// platforms/filesystems (notably Windows) don't support opening a directory for fsync, so
// failures here are swallowed: this is hardening on top of the per-file fsync below, not the
// mechanism that guarantees a save is never truncated.
async function fsyncDirectory(dir: string): Promise<void> {
  try {
    const dh = await open(dir, 'r')
    try {
      await dh.sync()
    } finally {
      await dh.close()
    }
  } catch {
    // Ignored -- see comment above.
  }
}

export async function writeProjectFile(path: string, project: Project): Promise<void> {
  // Unique per call: target basename + pid + a random UUID. Two concurrent writes -- even
  // into the same directory, even racing each other -- can never share a temp path, so
  // neither write's staged data can be overwritten or renamed away by the other, and the
  // failure-path unlink below can never delete another in-flight write's temp file.
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)

  // Carry forward the target's existing permissions (e.g. a user-applied chmod 600) instead
  // of letting the rename silently widen them to whatever mode the new temp file was created
  // with. New files default to owner-only.
  const mode = (await existingMode(path)) ?? DEFAULT_FILE_MODE

  try {
    const fh = await open(tmp, 'w', mode)
    try {
      await fh.writeFile(JSON.stringify(project, null, 2), 'utf8')
      // Flush the temp file's data to disk *before* the rename. Rename is atomic against
      // concurrent readers and against a process crash, but on power loss or a kernel panic
      // the rename's directory-entry update can reach disk before the file's data blocks do,
      // which would leave the target pointing at a zero-length or truncated temp file -- a
      // half-written map. fsync here closes that window.
      await fh.sync()
    } finally {
      await fh.close()
    }

    // rename overwrites on both platforms, but on Windows it fails transiently when antivirus or
    // another program holds the target open. Retry rather than surfacing an error nobody can act on.
    let lastError: unknown
    for (const delay of RETRY_DELAYS_MS) {
      if (delay > 0) await wait(delay)
      try {
        await rename(tmp, path)
        await fsyncDirectory(dirname(path))
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

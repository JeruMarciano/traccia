// tests/main/projectFile.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir, open, chmod, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProjectFile, writeProjectFile } from '../../src/main/projectFile'
import { createEmptyProject } from '../../src/core/project'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'traccia-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const NOW = '2026-07-30T09:00:00.000Z'

describe('project file', () => {
  it('round-trips a project', async () => {
    const p = createEmptyProject('Rossi Editore', NOW)
    const file = join(dir, 'a.json')
    await writeProjectFile(file, p)
    expect(await readProjectFile(file)).toEqual(p)
  })

  it('writes readable, indented JSON', async () => {
    const file = join(dir, 'b.json')
    await writeProjectFile(file, createEmptyProject('X', NOW))
    expect((await readFile(file, 'utf8')).startsWith('{\n  "schemaVersion": 1')).toBe(true)
  })

  it('leaves no temp file behind on success', async () => {
    const file = join(dir, 'c.json')
    await writeProjectFile(file, createEmptyProject('X', NOW))
    expect((await readdir(dir)).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('rejects a corrupt file with the validation errors', async () => {
    const file = join(dir, 'bad.json')
    await writeFile(file, '{"schemaVersion": 99}', 'utf8')
    await expect(readProjectFile(file)).rejects.toThrow(/Unsupported schemaVersion: 99/)
  })

  it('rejects a file that is not JSON at all', async () => {
    const file = join(dir, 'junk.json')
    await writeFile(file, 'not json', 'utf8')
    await expect(readProjectFile(file)).rejects.toThrow(/could not be read/i)
  })

  // Windows and macOS differ here. rename() must overwrite, not fail, when the target exists.
  it('overwrites an existing project file', async () => {
    const file = join(dir, 'twice.json')
    await writeProjectFile(file, createEmptyProject('First', NOW))
    await writeProjectFile(file, createEmptyProject('Second', NOW))
    expect((await readProjectFile(file)).name).toBe('Second')
  })

  it('overwrites repeatedly without leaving temp files', async () => {
    const file = join(dir, 'many.json')
    for (const n of ['a', 'b', 'c', 'd']) {
      await writeProjectFile(file, createEmptyProject(n, NOW))
    }
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect((await readProjectFile(file)).name).toBe('d')
  })

  // Regression test for a fixed defect: the temp filename used to be derived only from
  // Date.now() and the target directory, not the target's own basename. Two concurrent
  // writes into the same directory (targeting *different* files) could then collide on the
  // identical temp path -- one write's rename would move the shared temp out from under the
  // other, either destroying one project's contents with the other's, or leaving one write
  // rejected with ENOENT. Concurrent callers are exactly what Tasks 13/14 (IPC save,
  // undo/autosave) introduce, so this must hold under real concurrency, not just sequentially.
  it('does not let concurrent writes into the same directory collide on the temp file', async () => {
    const fileA = join(dir, 'concurrent-a.json')
    const fileB = join(dir, 'concurrent-b.json')

    const results = await Promise.allSettled([
      writeProjectFile(fileA, createEmptyProject('A', NOW)),
      writeProjectFile(fileB, createEmptyProject('B', NOW)),
    ])

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect((await readProjectFile(fileA)).name).toBe('A')
    expect((await readProjectFile(fileB)).name).toBe('B')
  })

  it('does not let many concurrent writes to distinct files in one directory corrupt each other', async () => {
    const entries = ['p', 'q', 'r', 's', 't', 'u', 'v', 'w'].map((name) => ({
      name,
      file: join(dir, `${name}.json`),
    }))

    await Promise.all(
      entries.map(({ file, name }) => writeProjectFile(file, createEmptyProject(name, NOW))),
    )

    for (const { file, name } of entries) {
      expect((await readProjectFile(file)).name).toBe(name)
    }
    expect((await readdir(dir)).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  // Regression test: rename() replaces the target inode with the temp file's, so without
  // care the temp file's permissions silently overwrite whatever mode the user had set on
  // their project file (verified: chmod 600 came back 644 after a save, under umask 022).
  it.skipIf(process.platform === 'win32')(
    'preserves an existing project file\'s permissions across a save',
    async () => {
      const file = join(dir, 'secure.json')
      await writeProjectFile(file, createEmptyProject('First', NOW))
      await chmod(file, 0o600)

      await writeProjectFile(file, createEmptyProject('Second', NOW))

      const mode = (await stat(file)).mode & 0o777
      expect(mode).toBe(0o600)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'creates a brand new project file as owner-only (not the platform default)',
    async () => {
      const file = join(dir, 'newmode.json')
      await writeProjectFile(file, createEmptyProject('X', NOW))

      const mode = (await stat(file)).mode & 0o777
      expect(mode).toBe(0o600)
    },
  )

  // Regression test: writeFile() previously wrote and closed the temp file without an
  // fsync, so on power loss / kernel panic (not just a process crash) the rename's directory
  // entry could reach disk before the temp file's data blocks did, leaving the target
  // zero-length or truncated. Asserting the FileHandle's sync() is invoked pins the
  // fsync-before-rename behaviour without needing to simulate an actual host crash.
  it('fsyncs the temp file to disk before renaming it onto the target', async () => {
    const file = join(dir, 'durable.json')

    // Obtain the real FileHandle prototype so we can spy on sync() without faking the
    // filesystem -- the write must still actually happen.
    const probe = await open(join(dir, '.probe'), 'w')
    const handleProto = Object.getPrototypeOf(probe)
    await probe.close()
    await rm(join(dir, '.probe'), { force: true })

    const syncSpy = vi.spyOn(handleProto, 'sync')
    try {
      await writeProjectFile(file, createEmptyProject('X', NOW))
      expect(syncSpy).toHaveBeenCalled()
    } finally {
      syncSpy.mockRestore()
    }

    expect((await readProjectFile(file)).name).toBe('X')
  })
})

// tests/main/projectFile.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises'
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
})

// tests/main/log.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCrashLine } from '../../src/main/log'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'traccia-log-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('writeCrashLine', () => {
  it('creates the log file and appends a line', async () => {
    await writeCrashLine(dir, 'boom')
    expect(await readFile(join(dir, 'traccia.log'), 'utf8')).toContain('boom')
  })

  it('appends rather than replacing', async () => {
    await writeCrashLine(dir, 'first')
    await writeCrashLine(dir, 'second')
    const text = await readFile(join(dir, 'traccia.log'), 'utf8')
    expect(text).toContain('first')
    expect(text).toContain('second')
  })

  it('never records more than 200 characters of a message', async () => {
    await writeCrashLine(dir, 'x'.repeat(5000))
    const text = await readFile(join(dir, 'traccia.log'), 'utf8')
    expect(text.length).toBeLessThan(400)
  })
})

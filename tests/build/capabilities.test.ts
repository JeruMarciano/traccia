// The renderer is trusted to draw the map and nothing else. It never receives a filesystem
// path, never opens a dialog, never makes a request. Tauri grants capabilities per window in
// src-tauri/capabilities/*.json; this test fails if any of the dangerous families appears
// there, however it got added.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CAP_DIR = join(__dirname, '../../src-tauri/capabilities')

const FORBIDDEN_PREFIXES = ['fs:', 'shell:', 'http:', 'updater:', 'dialog:', 'process:', 'os:']

function permissionStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(permissionStrings)
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(permissionStrings)
  }
  return []
}

describe('capability surface', () => {
  it('has a capabilities directory', () => {
    expect(existsSync(CAP_DIR)).toBe(true)
  })

  it('grants the renderer no filesystem, shell, http, updater or dialog permission', () => {
    const offenders: string[] = []
    for (const name of readdirSync(CAP_DIR)) {
      if (!name.endsWith('.json')) continue
      const parsed: unknown = JSON.parse(readFileSync(join(CAP_DIR, name), 'utf8'))
      for (const p of permissionStrings(parsed)) {
        if (FORBIDDEN_PREFIXES.some((prefix) => p.startsWith(prefix))) {
          offenders.push(`${name}: ${p}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

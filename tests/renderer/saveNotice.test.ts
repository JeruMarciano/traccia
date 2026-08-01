// Electron wraps an IPC rejection in its own "Error invoking remote method ..." text on the way
// across, so the main process's message arrives embedded in a longer string rather than as the
// whole message. saveNotice maps that back onto one of the renderer's own two constants; the text
// that arrived is matched against, never displayed.
import { describe, it, expect } from 'vitest'
import { saveNotice } from '../../src/renderer/saveNotice'
import { STRINGS } from '../../src/renderer/strings'

const wrapped = (message: string): Error =>
  new Error(`Error invoking remote method 'project:save': Error: ${message}`)

describe('saveNotice', () => {
  it('reports the actionable message when the file is held open', () => {
    expect(saveNotice(wrapped(STRINGS.saveBlocked))).toBe(STRINGS.saveBlocked)
  })

  it('reports the generic message for any other save failure', () => {
    expect(saveNotice(wrapped(STRINGS.saveFailed))).toBe(STRINGS.saveFailed)
  })

  it('reports the generic message when the rejection is not an Error at all', () => {
    expect(saveNotice(undefined)).toBe(STRINGS.saveFailed)
    expect(saveNotice({ message: STRINGS.saveBlocked })).toBe(STRINGS.saveFailed)
  })

  it('shows one of its own two constants, never the text it was handed', () => {
    const shown = saveNotice(new Error("EACCES: permission denied, open '/Users/x/secret.json'"))
    expect(shown).toBe(STRINGS.saveFailed)
    expect(shown).not.toContain('secret.json')
    expect(shown).not.toContain('/Users')
  })
})

// Tauri rejects an invoke with a plain string, not an Error — unlike Electron, which wrapped the
// main process's message in its own "Error invoking remote method ..." text. saveNotice must map
// both shapes back onto one of the renderer's own two constants. The text that arrived is matched
// against, never displayed.
describe('saveNotice — Tauri string rejections', () => {
  it('reports the actionable message when the rejection is the bare string', () => {
    expect(saveNotice(STRINGS.saveBlocked)).toBe(STRINGS.saveBlocked)
  })

  it('reports the generic message for the other string rejection', () => {
    expect(saveNotice(STRINGS.saveFailed)).toBe(STRINGS.saveFailed)
  })

  it('still shows one of its own two constants, never the string it was handed', () => {
    const shown = saveNotice("EACCES: permission denied, open '/Users/x/secret.json'")
    expect(shown).toBe(STRINGS.saveFailed)
    expect(shown).not.toContain('secret.json')
    expect(shown).not.toContain('/Users')
  })
})

import { describe, it, expect } from 'vitest'
import { scanNotice } from '../../src/renderer/bridge'
import { STRINGS } from '../../src/renderer/strings'

describe('scanNotice', () => {
  it('names the paths searched when no browser was found', () => {
    const notice = scanNotice(new Error('SCAN_NO_BROWSER:/Applications/Google Chrome.app'))
    expect(notice).toContain(STRINGS.scanNoBrowser)
  })

  it('uses the neutral failure sentence for anything else', () => {
    expect(scanNotice(new Error('boom'))).toBe(STRINGS.scanFailed)
  })

  it('uses the bad-url sentence when the url was refused', () => {
    expect(scanNotice(new Error('SCAN_BAD_URL'))).toBe(STRINGS.scanBadUrl)
  })

  it('uses its own sentence when a scan is already running, not the generic failure', () => {
    // SCAN_BUSY is actionable — stop the running scan or wait — and must not fall through to
    // the neutral "could not be completed" sentence, which gives the user nothing to do.
    const notice = scanNotice(new Error('SCAN_BUSY'))
    expect(notice).toBe(STRINGS.scanBusy)
    expect(notice).not.toBe(STRINGS.scanFailed)
  })

  it('never lets a raw error message through to the user', () => {
    // The renderer shows its own copy of each sentence, exactly as saveNotice
    // already does, so nothing out of the rejection reaches the screen.
    const notice = scanNotice(new Error('/Users/someone/secret/path failed'))
    expect(notice).not.toContain('/Users/someone')
  })
})

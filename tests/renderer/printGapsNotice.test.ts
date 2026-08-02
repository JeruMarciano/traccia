// The printed sheet must never show a stopped scan as if it were complete, and the wording it
// uses for possible gaps must be the same sentence Task 9 already put in front of the user in
// the on-screen notice -- not a near-duplicate. See src/renderer/printGapsNotice.ts.
import { describe, it, expect } from 'vitest'
import { printGapsNotice } from '../../src/renderer/printGapsNotice'
import { STRINGS } from '../../src/renderer/strings'

describe('printGapsNotice', () => {
  it('prints nothing when there has been no scan this session', () => {
    expect(printGapsNotice(null)).toBeNull()
  })

  it('prints nothing for a completed scan with no possible gaps', () => {
    expect(printGapsNotice({ possibleGaps: 0, stoppedEarly: false })).toBeNull()
  })

  it('names the gap count for a completed scan that has possible gaps, reusing STRINGS.scanIncomplete', () => {
    expect(printGapsNotice({ possibleGaps: 3, stoppedEarly: false })).toBe(STRINGS.scanIncomplete(3))
  })

  it('presents a stopped scan as stopped, never as a completed scan with gaps, reusing STRINGS.scanStopped', () => {
    const stopped = printGapsNotice({ possibleGaps: 2, stoppedEarly: true })
    const completedWithSameGaps = printGapsNotice({ possibleGaps: 2, stoppedEarly: false })
    expect(stopped).toBe(STRINGS.scanStopped(2))
    expect(stopped).not.toBe(completedWithSameGaps)
  })

  it('still names a stop with zero possible gaps as stopped, not as nothing', () => {
    expect(printGapsNotice({ possibleGaps: 0, stoppedEarly: true })).toBe(STRINGS.scanStopped(0))
  })
})

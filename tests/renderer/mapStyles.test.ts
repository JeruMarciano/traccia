import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MAP_MAX_WIDTH, MAP_MIN_WIDTH } from '../../src/renderer/mapMetrics'
import { STYLESHEET as THEME } from '../../src/renderer/theme'

const PRINT = readFileSync('src/renderer/print.css', 'utf8')
const rule = (css: string, selector: string): string =>
  css.match(new RegExp(`(?:^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

describe('the map’s styles', () => {
  it('never draws the sheet narrower than the width that keeps its text at 9 px', () => {
    expect(MAP_MIN_WIDTH).toBe(750)
    expect(rule(THEME, '.map-svg')).toContain(`min-width:${MAP_MIN_WIDTH}px`)
    expect(rule(THEME, '.map-svg')).toContain(`max-width:${MAP_MAX_WIDTH}px`)
  })

  it('lets the sheet’s height follow its rows, and scrolls what does not fit', () => {
    // The wrong answer: height:100% squeezes a tall sheet into the window and its text under the floor.
    expect(rule(THEME, '.map-svg')).toContain('height:auto')
    expect(rule(THEME, '.map-svg')).not.toContain('height:100%')
    expect(rule(THEME, '.map-scroll')).toContain('overflow:auto')
  })

  it('colours a way in, its lines and its arrowheads from the same six', () => {
    for (let i = 0; i < 6; i++) {
      expect(rule(THEME, `.door--${i}`)).toContain(`color:var(--door-${i + 1})`)
      expect(rule(THEME, `.path--${i}`)).toContain(`stroke:var(--door-${i + 1})`)
      expect(rule(THEME, `.head--${i}`)).toContain(`fill:var(--door-${i + 1})`)
    }
  })

  it('tells the three origins of a way in apart by ink, not by hue', () => {
    expect(rule(THEME, '.door-mark--discovered')).toContain('fill:currentColor')
    expect(rule(THEME, '.door-mark--declared')).toContain('fill:var(--paper-lift)')
    expect(rule(THEME, '.door-mark--unsourced')).toContain('stroke-dasharray')
  })

  it('tells the three kinds of destination apart by shape: a block, a ring, a dashed ring', () => {
    expect(rule(THEME, '.mark--internal')).toContain('fill:var(--internal)')
    expect(rule(THEME, '.mark--supplier')).toContain('fill:var(--paper-lift)')
    expect(rule(THEME, '.mark--unidentified')).toContain('stroke-dasharray')
  })

  it('draws a card lifted off the paper with a hairline, the organisation’s in ink, and no shadow anywhere', () => {
    expect(rule(THEME, '.card-box')).toContain('fill:var(--paper-lift)')
    expect(rule(THEME, '.card-box')).toContain('stroke:var(--rule)')
    expect(rule(THEME, '.controller .card-box')).toContain('stroke:var(--ink)')
    expect(THEME).not.toMatch(/box-shadow|drop-shadow|gradient/)
  })

  it('draws every line the same weight, round-capped and unfilled, the organisation’s in neutral ink', () => {
    expect(rule(THEME, '.path')).toContain('fill:none')
    expect(rule(THEME, '.path')).toContain('stroke-width:1.5')
    expect(rule(THEME, '.path')).toContain('stroke-linecap:round')
    expect(rule(THEME, '.path--neutral')).toContain('stroke:var(--ink-soft)')
    // An arrowhead laid over the end of a translucent line shows the overlap as a darker spot.
    expect(rule(THEME, '.path--neutral')).not.toContain('opacity')
    expect(rule(THEME, '.head--neutral')).not.toContain('opacity')
  })

  it('lets a dimmed row stay dimmed once the drawing has settled', () => {
    // The wrong answer: keyframes ending at opacity 1, which outlive the animation and win.
    for (const frames of THEME.match(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*/g) ?? []) expect(frames).not.toMatch(/to\s*\{/)
    expect(rule(THEME, '.dim')).toContain('opacity:.16')
  })

  it('leaves no rule behind for marks the map no longer draws', () => {
    for (const gone of ['.node-boundary', '.door-origin', '.node-arc', '.node-member', '.disc-halo', '.spine', '.ring', '.ring-known', '.ring-count', '.member-mark', '.bracket', '.disc-home']) {
      expect(THEME).not.toContain(`${gone}{`)
    }
  })

  it('lifts the width floor on paper, where nothing scrolls', () => {
    expect(PRINT).toMatch(/\.map-svg\s*\{[^}]*min-width:\s*0/)
    expect(PRINT).toMatch(/\.map-scroll\s*\{[^}]*overflow:\s*visible/)
  })
})

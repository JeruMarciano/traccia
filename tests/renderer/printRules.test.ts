// The printed sheet is the one surface with no reader to complain. A door's colour travels its
// whole path, and two doors into one destination are two lines told apart by hue -- which a
// monochrome printer flattens to two identical greys. These hold the claim that the sheet is a
// true reading in black and white.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { STYLESHEET } from '../../src/renderer/theme'

const PRINT = readFileSync('src/renderer/print.css', 'utf8')

describe('the printed sheet', () => {
  it('gives each door colour its own dash pattern, so colour is never the only carrier', () => {
    const patterns = [...PRINT.matchAll(/\.path--(\d)\s*\{\s*stroke-dasharray:\s*([^;}]+)/g)]
    expect(patterns.map((m) => m[1])).toEqual(['0', '1', '2', '3', '4', '5'])
    expect(new Set(patterns.map((m) => m[2]?.trim())).size).toBe(6)
  })

  it('hides the side panel, which is a screen answer to a click', () => {
    expect(PRINT).toMatch(/\.detail[^{]*\{[^}]*display:\s*none/)
  })

  it('does not hide the arrowhead, which is how the sheet says which way data moves', () => {
    expect(PRINT).not.toMatch(/marker|\.arrow/)
  })

  it('comes after every screen rule, so no screen rule can win a tie against it', () => {
    // A media query adds no weight: `.scanbar{display:none}` on paper and `.scanbar{display:flex}`
    // on screen are equals, and the later one wins. The wrong answer: print.css loaded as its own
    // stylesheet, which lands in <head>, above the screen rules -- the scan bar printed.
    const print = PRINT.slice(PRINT.indexOf('@media print')).trim()
    expect(STYLESHEET.trim().endsWith(print)).toBe(true)
  })

  it('prints on white, by changing colours the screen rules actually read', () => {
    // The wrong answer: `--sheet: #FFFFFF`, a name nothing reads -- the page printed grey.
    const set = [...PRINT.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
    expect(set).toContain('--paper')
    for (const name of set) expect(STYLESHEET).toContain(`var(${name})`)
  })

  it('leaves the scan control and the line under it on the screen', () => {
    const hidden = PRINT.match(/([^{}]*)\{\s*display:\s*none/)?.[1] ?? ''
    for (const screenOnly of ['.scanbar', '.scan-visitor', '.actions', '.notice']) expect(hidden).toContain(screenOnly)
  })
})

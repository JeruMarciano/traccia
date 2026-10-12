import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { controllerName } from '../../src/core/controller'
import { deriveDoors } from '../../src/core/doors'
import type { Project, ScanResult } from '../../src/core/types'
import { dorsaleMedium, dorsaleOversized, dorsaleSmall, dorsaleUgly, rightPlaces } from '../fixtures/dorsale'

// These numbers are what the map has to draw. If a change to vendors.json or to the scanner's
// ingestion moves one, this is where it shows, and the layout tests downstream are read again.
const kinds = (p: Project): string[] => deriveDoors(p).map((d) => d.kind ?? 'place')
const count = (p: Project, kind: string): number => kinds(p).filter((k) => k === kind).length
const groupSizes = (p: Project): number[] => {
  const sizes = new Map<string, number>()
  for (const pl of rightPlaces(p)) sizes.set(pl.purposeGroup, (sizes.get(pl.purposeGroup) ?? 0) + 1)
  return [...sizes.values()].sort((a, b) => b - a)
}

describe('the Dorsale fixtures', () => {
  it('small: 2 ways in, 9 places in 3 groups', () => {
    expect(kinds(dorsaleSmall())).toEqual(['place', 'embed'])
    expect(groupSizes(dorsaleSmall())).toEqual([3, 3, 3])
  })

  it('medium: 7 ways in of which 6 forms, 13 places in 3 groups', () => {
    expect(kinds(dorsaleMedium())).toHaveLength(7)
    expect(count(dorsaleMedium(), 'form')).toBe(6)
    expect(groupSizes(dorsaleMedium())).toEqual([6, 6, 1])
  })

  it('ugly: 15 ways in of which 12 forms, 40 places in 5 groups, one of 17', () => {
    expect(kinds(dorsaleUgly())).toHaveLength(15)
    expect(count(dorsaleUgly(), 'form')).toBe(12)
    expect(count(dorsaleUgly(), 'embed')).toBe(2)
    expect(groupSizes(dorsaleUgly())).toEqual([17, 15, 4, 3, 1])
  })

  it('ugly: a way in is labelled with an address far longer than a row', () => {
    expect(Math.max(...deriveDoors(dorsaleUgly()).map((d) => d.label.length))).toBeGreaterThanOrEqual(90)
  })

  it('names nobody: the scanned site is a .test host and every form is on it', () => {
    for (const name of ['dorsale-small', 'dorsale-medium', 'dorsale-ugly']) {
      const scan = JSON.parse(readFileSync(`tests/fixtures/scans/${name}.scan.json`, 'utf8')) as ScanResult
      expect(scan.scannedHost).toMatch(/\.test$/)
      for (const f of scan.formFields) expect(new URL(f.page).host).toBe(scan.scannedHost)
      for (const k of scan.storageKeys ?? []) expect(k.key).not.toMatch(/[1-9]\d{5,}/)
    }
  })

  it('oversized: 19 ways in, 30 groups, a group of 14, 12 subject groups, no controller named', () => {
    const p = dorsaleOversized()
    expect(kinds(p)).toHaveLength(19)
    expect(count(p, 'form')).toBe(10)
    expect(count(p, 'place')).toBe(1)
    expect(groupSizes(p)).toHaveLength(30)
    expect(groupSizes(p)[0]).toBe(14)
    expect(p.subjectGroups).toHaveLength(12)
    expect(controllerName(p).name).toBeNull()
    expect(Math.max(...deriveDoors(p).map((d) => d.label.length))).toBeGreaterThanOrEqual(233)
  })
})

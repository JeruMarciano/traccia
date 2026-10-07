import { describe, it, expect } from 'vitest'
import dictionary from '../../src/data/vendors.json'
import { identify } from '../../src/core/vendors'
import type { VendorDictionary } from '../../src/core/types'

const PURPOSE_GROUPS = new Set([
  'Marketing',
  'Systems',
  'Payments',
  'Employing people',
  'Support',
  'Sales',
  'Delivery',
])

const dict = dictionary as VendorDictionary

describe('the shipped vendor dictionary', () => {
  it('is not empty', () => {
    expect(Object.keys(dict).length).toBeGreaterThan(100)
  })

  it('gives every entry an owner, a category and a known purpose group', () => {
    for (const [host, entry] of Object.entries(dict)) {
      expect(entry.owner, host).toBeTruthy()
      expect(entry.category, host).toBeTruthy()
      expect(PURPOSE_GROUPS.has(entry.purposeGroup), `${host} → ${entry.purposeGroup}`).toBe(true)
    }
  })

  it('keys every entry by a lowercase host, optionally with one plain first path segment', () => {
    for (const host of Object.keys(dict)) {
      expect(host, host).toMatch(/^[a-z0-9.-]+\.[a-z0-9-]+(\/[a-z0-9_-]{1,32})?$/)
    }
  })

  it('carries nothing that could be fetched at runtime', () => {
    // The dictionary is data. A URL in it would be an invitation for some later
    // change to go and get it, which §7.1 forbids absolutely.
    expect(JSON.stringify(dict)).not.toMatch(/https?:\/\//)
  })

  it('recognises the third parties a real scan is most likely to find', () => {
    for (const host of [
      'www.google-analytics.com',
      'www.googletagmanager.com',
      'connect.facebook.net',
      'js.stripe.com',
      'static.hotjar.com',
    ]) {
      expect(identify(host, dict), host).not.toBeNull()
    }
  })

  it('entries for one owner agree on purpose group unless a note says why', () => {
    const clashes = (d: VendorDictionary): string[] => {
      const byOwner = new Map<string, Set<string>>()
      for (const e of Object.values(d)) {
        if (e.note) continue
        if (!byOwner.has(e.owner)) byOwner.set(e.owner, new Set())
        byOwner.get(e.owner)!.add(e.purposeGroup)
      }
      return [...byOwner].filter(([, g]) => g.size > 1).map(([o, g]) => `${o}: ${[...g].join('/')}`)
    }
    // The check can fail: a disagreeing pair with no note is reported, one with a note is not.
    const bad = { ...dict, 'one.example': { owner: 'X', category: 'ads', purposeGroup: 'Marketing' }, 'two.example': { owner: 'X', category: 'cdn', purposeGroup: 'Systems' } }
    expect(clashes(bad)).toEqual(['X: Marketing/Systems'])
    expect(clashes({ ...bad, 'two.example': { ...bad['two.example'], note: 'a CDN, not the ads product' } })).toEqual([])
    expect(clashes(dict)).toEqual([])
  })
})

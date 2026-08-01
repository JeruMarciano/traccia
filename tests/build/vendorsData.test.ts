import { describe, it, expect } from 'vitest'
import dictionary from '../../src/data/vendors.json'
import { identify } from '../../src/core/vendors'
import type { VendorDictionary } from '../../src/core/types'

const PURPOSE_GROUPS = new Set([
  'Marketing',
  'Running the systems',
  'Getting paid',
  'Employing people',
  'Support',
  'Selling',
  'Delivering orders',
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

  it('keys every entry by a bare lowercase host with no scheme, port or path', () => {
    for (const host of Object.keys(dict)) {
      expect(host, host).toBe(host.toLowerCase())
      expect(host, host).not.toMatch(/[:/?#]/)
      expect(host, host).toContain('.')
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
})

import { describe, it, expect } from 'vitest'
import { identify } from '../../src/core/vendors'
import type { VendorDictionary } from '../../src/core/types'

const DICT: VendorDictionary = {
  'google-analytics.com': { owner: 'Google', category: 'analytics', purposeGroup: 'Marketing' },
  'doubleclick.net': { owner: 'Google', category: 'advertising', purposeGroup: 'Marketing' },
  'stripe.com': { owner: 'Stripe', category: 'payments', purposeGroup: 'Getting paid' },
}

describe('identify', () => {
  it('matches a host exactly', () => {
    expect(identify('stripe.com', DICT)?.owner).toBe('Stripe')
  })

  it('matches a subdomain against its registered entry', () => {
    expect(identify('www.google-analytics.com', DICT)?.category).toBe('analytics')
    expect(identify('region1.google-analytics.com', DICT)?.category).toBe('analytics')
  })

  it('is case-insensitive', () => {
    expect(identify('WWW.Stripe.COM', DICT)?.owner).toBe('Stripe')
  })

  it('returns null for a host it does not know', () => {
    expect(identify('segment-data-us-east.zqtk.net', DICT)).toBeNull()
  })

  it('does not match a host that merely ends with the same letters', () => {
    // "notstripe.com" ends with "stripe.com" as a string but is a different domain.
    expect(identify('notstripe.com', DICT)).toBeNull()
  })

  it('prefers the longest matching entry', () => {
    const d: VendorDictionary = {
      ...DICT,
      'analytics.example.com': { owner: 'Narrow', category: 'analytics', purposeGroup: 'Marketing' },
      'example.com': { owner: 'Broad', category: 'hosting', purposeGroup: 'Running the systems' },
    }
    expect(identify('analytics.example.com', d)?.owner).toBe('Narrow')
    expect(identify('other.example.com', d)?.owner).toBe('Broad')
  })

  it('does not treat a trailing dot as a different host', () => {
    expect(identify('stripe.com.', DICT)?.owner).toBe('Stripe')
  })
})

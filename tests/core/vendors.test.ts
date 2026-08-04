import { describe, it, expect } from 'vitest'
import { classifyHost, identify } from '../../src/core/vendors'
import type { VendorDictionary } from '../../src/core/types'

const DICT: VendorDictionary = {
  'google-analytics.com': { owner: 'Google', category: 'analytics', purposeGroup: 'Marketing' },
  'doubleclick.net': { owner: 'Google', category: 'advertising', purposeGroup: 'Marketing' },
  'stripe.com': { owner: 'Stripe', category: 'payments', purposeGroup: 'Payments' },
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
      'example.com': { owner: 'Broad', category: 'hosting', purposeGroup: 'Systems' },
    }
    expect(identify('analytics.example.com', d)?.owner).toBe('Narrow')
    expect(identify('other.example.com', d)?.owner).toBe('Broad')
  })

  it('does not treat a trailing dot as a different host', () => {
    expect(identify('stripe.com.', DICT)?.owner).toBe('Stripe')
  })

  it('returns null for keys that live on the prototype chain', () => {
    // A plain property read would find Object.prototype's own members and
    // report them as an identified vendor with an undefined owner.
    expect(identify('__proto__', DICT)).toBeNull()
    expect(identify('constructor', DICT)).toBeNull()
    expect(identify('a.constructor', DICT)).toBeNull()
  })
})

describe('classifyHost', () => {
  it('reads a purpose out of a host name the dictionary does not know', () => {
    expect(classifyHost('stats.rossi-editore.it')).toBe('Marketing')
    expect(classifyHost('tracking.unknown-vendor.io')).toBe('Marketing')
    expect(classifyHost('cdn.some-host.net')).toBe('Systems')
    expect(classifyHost('checkout.tiny-shop.de')).toBe('Payments')
    expect(classifyHost('livechat.helper.io')).toBe('Support')
  })

  it('is null when the name says nothing, so the map still admits it does not know', () => {
    expect(classifyHost('xyz42.example.com')).toBeNull()
    expect(classifyHost('')).toBeNull()
  })

  it('ignores the public suffix, whose labels collide with real hints', () => {
    // ".media" and ".id" are TLDs; neither says anything about what the operator does.
    expect(classifyHost('acme.media')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { bucketLifetime, cookieOwnerName, isThirdPartyCookie } from '../../src/core/cookies'

describe('bucketLifetime', () => {
  const at = 1_754_000_000
  it('a session cookie is session regardless of its expiry field', () =>
    expect(bucketLifetime({ name: 'x', domain: 'a.it', session: true, expiresEpochSeconds: at + 999_999_999 }, at)).toBe('session'))
  it('under a day', () =>
    expect(bucketLifetime({ name: 'x', domain: 'a.it', session: false, expiresEpochSeconds: at + 3600 }, at)).toBe('under-a-day'))
  it('under a year', () =>
    expect(bucketLifetime({ name: 'x', domain: 'a.it', session: false, expiresEpochSeconds: at + 86_400 * 30 }, at)).toBe('under-a-year'))
  it('a year or more', () =>
    expect(bucketLifetime({ name: 'x', domain: 'a.it', session: false, expiresEpochSeconds: at + 86_400 * 400 }, at)).toBe('a-year-or-more'))
  it('an already-expired cookie buckets as under-a-day, never a negative surprise', () =>
    expect(bucketLifetime({ name: 'x', domain: 'a.it', session: false, expiresEpochSeconds: at - 100 }, at)).toBe('under-a-day'))
})

describe('isThirdPartyCookie', () => {
  it('the scanned host itself is first-party', () =>
    expect(isThirdPartyCookie('rossi-editore.it', 'rossi-editore.it')).toBe(false))
  it('a leading dot is stripped before comparing', () =>
    expect(isThirdPartyCookie('.rossi-editore.it', 'rossi-editore.it')).toBe(false))
  it('a label-boundary subdomain is first-party', () =>
    expect(isThirdPartyCookie('shop.rossi-editore.it', 'rossi-editore.it')).toBe(false))
  it('a suffix that is not on a label boundary is third-party', () =>
    expect(isThirdPartyCookie('evilrossi-editore.it', 'rossi-editore.it')).toBe(true))
  it('anything else is third-party', () =>
    expect(isThirdPartyCookie('doubleclick.net', 'rossi-editore.it')).toBe(true))
})

describe('cookieOwnerName', () => {
  const dict = { 'google-analytics.com': { owner: 'Google', category: 'analytics', purposeGroup: 'Analytics' } }
  it('a recognised domain names its place exactly as ingestScan does', () =>
    expect(cookieOwnerName('google-analytics.com', dict)).toBe('Google Analytics'))
  it('an unrecognised domain attaches to nothing, and is not dropped by the caller', () =>
    expect(cookieOwnerName('cdn.example-widget.com', dict)).toBe(null))
})

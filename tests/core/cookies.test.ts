import { describe, expect, it } from 'vitest'
import { bucketLifetime, cookieOwnerName, cookiePlatform, isThirdPartyCookie } from '../../src/core/cookies'
import type { CookiePlatformRow } from '../../src/core/types'

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

describe('cookiePlatform', () => {
  const T: CookiePlatformRow[] = [['_hjSession_', 'Hotjar', 'Analytics', 1], ['session', 'Generic', 'Functional', 0],
    ['id', 'DoubleClick', 'Marketing', 0], ['_fbp', 'Meta', 'Marketing', 0],
    ['_ga', 'Google Analytics', 'Analytics', 0], ['ab', 'Short', 'Marketing', 1]]
  it('a wildcard row matches only its own prefix, and only from 4 characters', () => {
    expect(cookiePlatform('_hjSession_12345', T)?.platform).toBe('Hotjar')
    expect(cookiePlatform('x_hjSession_1', T)).toBeNull()
    expect(cookiePlatform('abcdef', T)).toBeNull() // wildcard prefix 'ab' is under 4
  })
  it('generic names are never matched', () => {
    expect(cookiePlatform('session', T)).toBeNull() // stoplist
    expect(cookiePlatform('id', T)).toBeNull() // exact names need 3+ characters
  })
  it('a known name matches exactly, from 3 characters', () => {
    expect(cookiePlatform('_fbp', T)?.platform).toBe('Meta')
    expect(cookiePlatform('_ga', T)?.platform).toBe('Google Analytics')
  })
  it('an exact row beats a wildcard row, and the longest wildcard prefix wins', () => {
    const W: CookiePlatformRow[] = [['_gaxx_', 'Short', 'Analytics', 1], ['_gaxx_long_', 'Long', 'Analytics', 1], ['_gaxx_long_1', 'Exact', 'Analytics', 0]]
    expect(cookiePlatform('_gaxx_long_1', W)?.platform).toBe('Exact')
    expect(cookiePlatform('_gaxx_long_2', W)?.platform).toBe('Long')
    expect(cookiePlatform('_gaxx_other', W)?.platform).toBe('Short')
  })
  it('a name two platforms claim is not matched: a blank beats a guess', () => {
    expect(cookiePlatform('_fbp', [...T, ['_fbp', 'Other', 'Marketing', 0]])).toBeNull()
  })
})

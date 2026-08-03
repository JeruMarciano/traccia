import { describe, it, expect } from 'vitest'
import { classifyField, isCollectingField } from '../../src/core/forms'

describe('classifyField', () => {
  it('autocomplete beats a generic name', () =>
    expect(classifyField({ name: 'q', type: 'text', autocomplete: 'email', label: '' })).toBe('email'))
  it('type=email without autocomplete is email', () =>
    expect(classifyField({ name: 'x', type: 'email', autocomplete: '', label: '' })).toBe('email'))
  it('an Italian label names the kind', () =>
    expect(classifyField({ name: 'f2', type: 'text', autocomplete: '', label: 'Numero di cellulare' })).toBe(
      'phone',
    ))
  it('cognome is a name field', () =>
    expect(classifyField({ name: 'cognome', type: 'text', autocomplete: '', label: '' })).toBe('name'))
  it('username is not a name', () =>
    expect(classifyField({ name: 'username', type: 'text', autocomplete: '', label: '' })).toBe('free-text'))
  it('a compound "Name" label is not a person\'s name', () => {
    // "Company Name", "Product Name", "Display Name", "Screen Name" all end in "name" after a
    // word boundary — none of them is a person's name, and the classifier must not guess.
    expect(classifyField({ name: 'displayName', type: 'text', autocomplete: '', label: 'Display Name' })).toBe(
      'free-text',
    )
  })
  it('word boundary lets an Italian article precede cognome', () =>
    expect(classifyField({ name: 'f3', type: 'text', autocomplete: '', label: 'Il cognome' })).toBe('name'))
  it('word boundary refuses cognome embedded in a longer word', () =>
    expect(classifyField({ name: 'mycognomex', type: 'text', autocomplete: '', label: '' })).toBe('free-text'))
  it('type=search is free text', () =>
    expect(classifyField({ name: 'search', type: 'search', autocomplete: '', label: 'Cerca' })).toBe(
      'free-text',
    ))
  it('cc-number is payment', () =>
    expect(classifyField({ name: 'x', type: 'text', autocomplete: 'cc-number', label: '' })).toBe('payment'))
  it('nothing matched is free-text, never a guess', () =>
    expect(classifyField({ name: 'campo7', type: 'text', autocomplete: '', label: '' })).toBe('free-text'))
  it('hidden and submit inputs are not collecting fields', () => {
    expect(isCollectingField({ type: 'hidden' })).toBe(false)
    expect(isCollectingField({ type: 'submit' })).toBe(false)
    expect(isCollectingField({ type: 'text' })).toBe(true)
  })
})

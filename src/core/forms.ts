import type { FormFieldKind, RawFormField } from './types'

/**
 * Types that never collect anything from the person filling in the form — hidden inputs,
 * submit/button/reset controls. Excluded from doors before classification even runs: a submit
 * button is not a place where personal data was written down.
 */
const NON_COLLECTING_TYPES = new Set(['hidden', 'submit', 'button', 'reset'])

export function isCollectingField(field: Pick<RawFormField, 'type'>): boolean {
  return !NON_COLLECTING_TYPES.has(field.type.trim().toLowerCase())
}

/**
 * A dictionary term, anchored so it matches a whole word and never part of one — the same
 * `\p{L}`/`\p{N}` boundary used in documents.ts, and for the same reason: `\b` treats an accented
 * letter as a boundary character, which would let "città" match inside a longer Italian word.
 * The same anchor is why "cognome" matches "Il cognome" but not "mycognomex": in the second, the
 * character on either side of "cognome" is a letter, so there is no boundary and the whole-word
 * anchor correctly refuses it — a substring match would get both of these wrong.
 */
function wholeWord(term: string): RegExp {
  const body = term
    .split(' ')
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'u')
}

function matchesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => wholeWord(term).test(text))
}

// English + Italian, inline: word data belongs with the rule that reads it, not in a fetched or
// generated dictionary. Word-boundary, lowercased, matched against name+label together.
//
// Deliberately no bare "name" term. "Company Name", "Product Name", "Display Name", "Screen
// Name" would all match it after a word boundary -- none of them is a person's name, and a false
// positive there is exactly the guess "prefer a blank to a guess" rules out. "full name" is the
// safe English equivalent: it only matches when the sentence actually says "full name", which
// "Display Name" never does. This is also why "username" is free-text without needing an explicit
// exclusion: no term here is a substring of it.
const NAME_TERMS = ['nome', 'cognome', 'surname', 'full name']
const EMAIL_TERMS = ['email', 'e-mail', 'posta elettronica']
const PHONE_TERMS = ['telefono', 'cellulare', 'phone']
const ADDRESS_TERMS = ['indirizzo', 'città', 'cap', 'provincia', 'address', 'city', 'zip']
const PAYMENT_TERMS = ['carta', 'iban', 'cvv', 'cvc', 'card']

const AUTOCOMPLETE_EMAIL = new Set(['email'])
const AUTOCOMPLETE_PHONE = new Set(['tel', 'tel-national'])
const AUTOCOMPLETE_NAME = new Set(['name', 'given-name', 'family-name'])
const AUTOCOMPLETE_ADDRESS = new Set(['street-address', 'postal-code'])

function autocompleteKind(autocomplete: string): FormFieldKind | null {
  const ac = autocomplete.trim().toLowerCase()
  if (ac === '') return null
  if (AUTOCOMPLETE_EMAIL.has(ac)) return 'email'
  if (AUTOCOMPLETE_PHONE.has(ac)) return 'phone'
  if (AUTOCOMPLETE_NAME.has(ac)) return 'name'
  if (AUTOCOMPLETE_ADDRESS.has(ac) || ac.startsWith('address-line') || ac.startsWith('country')) return 'address'
  if (ac.startsWith('cc-')) return 'payment'
  return null
}

function typeKind(type: string): FormFieldKind | null {
  const t = type.trim().toLowerCase()
  if (t === 'email') return 'email'
  if (t === 'tel') return 'phone'
  return null
}

function wordKind(name: string, label: string): FormFieldKind | null {
  const text = `${name} ${label}`.toLowerCase()
  if (matchesAny(text, EMAIL_TERMS)) return 'email'
  if (matchesAny(text, PHONE_TERMS)) return 'phone'
  if (matchesAny(text, NAME_TERMS)) return 'name'
  if (matchesAny(text, ADDRESS_TERMS)) return 'address'
  if (matchesAny(text, PAYMENT_TERMS)) return 'payment'
  return null
}

/**
 * Classify one field. Pure; language data is inline (English + Italian), rule-based, no
 * inference. Precedence: autocomplete (when it names a kind), then type, then a word match on
 * name+label, then free-text. Prefer a blank to a guess — nothing matched is free-text, never a
 * guess dressed up as an identification.
 */
export function classifyField(
  field: Pick<RawFormField, 'name' | 'type' | 'autocomplete' | 'label'>,
): FormFieldKind {
  const byAutocomplete = autocompleteKind(field.autocomplete)
  if (byAutocomplete !== null) return byAutocomplete

  const byType = typeKind(field.type)
  if (byType !== null) return byType

  const byWord = wordKind(field.name, field.label)
  if (byWord !== null) return byWord

  return 'free-text'
}

import type { Project } from './types'

export interface Expectation {
  id: string
  label: string
  purposeGroup: string
  /** Only assert this expectation when the project gives a reason to. */
  appliesWhen(project: Project): boolean
  satisfiedBy(project: Project): boolean
}

const hasSubject = (p: Project, needle: string): boolean =>
  p.subjectGroups.some((s) => s.name.toLowerCase().includes(needle))

const hasPlaceMatching = (p: Project, words: string[]): boolean =>
  p.places.some((pl) => words.some((w) => pl.name.toLowerCase().includes(w)))

function fn(
  id: string,
  label: string,
  purposeGroup: string,
  words: string[],
  appliesWhen: (p: Project) => boolean,
): Expectation {
  return {
    id,
    label,
    purposeGroup,
    appliesWhen,
    satisfiedBy: (p) => hasPlaceMatching(p, words),
  }
}

const hasStaff = (p: Project): boolean => hasSubject(p, 'employee') || hasSubject(p, 'staff')
// The `kind === 'collection' && holder === 'you'` clause is a v0.1 proxy for
// "there is a website": today the only producer of that shape is the scanned
// site itself (src/core/scan.ts). Once documents can declare a collection
// point the organisation holds that is not a website — a paper intake form,
// a shop counter — this will wrongly trip the website-only expectations
// (hosting, analytics) against a non-website, and will need a narrower
// signal than kind + holder.
const hasSite = (p: Project): boolean =>
  hasPlaceMatching(p, ['website', 'site', 'shop']) ||
  p.places.some((pl) => pl.kind === 'collection' && pl.holder === 'you')
const hasCustomers = (p: Project): boolean => hasSubject(p, 'customer')

// A place a human or a document put there. A scan never produces one, so this
// is false for a scan-only project and true as soon as documents land.
//
// Hazard for v0.2: `confidence` is a downgradeable field, not an append-only
// signal. mergeObservations (src/core/merge.ts) rewrites a matched place to
// `confidence: 'observed'` when a scan later confirms it. If a project's only
// declared place is later confirmed by a scan, hasDeclared flips back to
// false and all five internal expectations silently switch off again, with
// no user-visible cause. Nothing in v0.1 writes 'declared', so a scan cannot
// defeat this gate today — but when document import lands, a sturdier
// boundary is needed: a durable signal such as a document count on the
// project, or a non-lossy merge that never demotes a declared place.
const hasDeclared = (p: Project): boolean => p.places.some((pl) => pl.confidence === 'declared')

// Expectations about the organisation's internal functions. A website scan is
// evidence about a website, not about payroll or accounting, and asking after
// them on a scan-only map produces gaps the consultant would have to defend.
const looksInside = hasDeclared

export const EXPECTATIONS: readonly Expectation[] = [
  fn('payroll', 'payroll', 'Employing people', ['payroll', 'salar', 'wage'], hasStaff),
  fn('email', 'email and productivity', 'Systems', ['mail', 'workspace', '365', 'outlook'], looksInside),
  fn('hosting', 'website hosting', 'Systems', ['host', 'server', 'cloud'], hasSite),
  fn('analytics', 'website analytics', 'Marketing', ['analytic', 'statistic', 'metrics'], hasSite),
  fn('accounting', 'accounting', 'Payments', ['account', 'bookkeep', 'ledger'], looksInside),
  fn('backup', 'backup', 'Systems', ['backup', 'archive', 'snapshot'], looksInside),
  fn('support', 'customer support', 'Support', ['support', 'helpdesk', 'ticket'], hasCustomers),
  fn('crm', 'customer records', 'Sales', ['crm', 'customer record', 'contact'], hasCustomers),
  fn('payments', 'payment processing', 'Payments', ['payment', 'card', 'checkout', 'billing'], hasCustomers),
  fn('delivery', 'order delivery', 'Delivery', ['courier', 'shipping', 'delivery', 'post'], looksInside),
  fn('storage', 'document storage', 'Systems', ['drive', 'storage', 'sharepoint', 'dropbox'], looksInside),
  fn('devices', 'staff device management', 'Systems', ['device', 'mdm', 'laptop', 'endpoint'], hasStaff),
]

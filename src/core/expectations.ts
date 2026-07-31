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

const always = (): boolean => true

function fn(
  id: string,
  label: string,
  purposeGroup: string,
  words: string[],
  appliesWhen: (p: Project) => boolean = always,
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
const hasSite = (p: Project): boolean => hasPlaceMatching(p, ['website', 'site', 'shop'])
const hasCustomers = (p: Project): boolean => hasSubject(p, 'customer')

export const EXPECTATIONS: readonly Expectation[] = [
  fn('payroll', 'payroll', 'Employing people', ['payroll', 'salar', 'wage'], hasStaff),
  fn('email', 'email and productivity', 'Running the systems', ['mail', 'workspace', '365', 'outlook']),
  fn('hosting', 'website hosting', 'Running the systems', ['host', 'server', 'cloud'], hasSite),
  fn('analytics', 'website analytics', 'Marketing', ['analytic', 'statistic', 'metrics'], hasSite),
  fn('accounting', 'accounting', 'Getting paid', ['account', 'bookkeep', 'ledger']),
  fn('backup', 'backup', 'Running the systems', ['backup', 'archive', 'snapshot']),
  fn('support', 'customer support', 'Support', ['support', 'helpdesk', 'ticket'], hasCustomers),
  fn('crm', 'customer records', 'Selling', ['crm', 'customer record', 'contact'], hasCustomers),
  fn('payments', 'payment processing', 'Getting paid', ['payment', 'card', 'checkout', 'billing'], hasCustomers),
  fn('delivery', 'order delivery', 'Delivering orders', ['courier', 'shipping', 'delivery', 'post']),
  fn('storage', 'document storage', 'Running the systems', ['drive', 'storage', 'sharepoint', 'dropbox']),
  fn('devices', 'staff device management', 'Running the systems', ['device', 'mdm', 'laptop', 'endpoint'], hasStaff),
]

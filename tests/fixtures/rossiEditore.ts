import type { Project } from '../../src/core/types'

/**
 * The sample the controller-centred map was approved against. Fictional: "Rossi Editore srl" is
 * a stand-in publisher, and every host below is either a well-known vendor domain or invented.
 * Committed on purpose -- a layout claim measured against a synthetic three-place project is not
 * measured at all (CONTRIBUTING.md, the real-document rule).
 *
 * Three subject groups, three doors (two declared by documents, one discovered by the scan),
 * five purpose groups, two places nobody has explained yet, one named controller.
 */

const DOC = { documentId: 'd1', documentName: 'informativa-clienti.pdf' }
const DPA = { documentId: 'd2', documentName: 'dpa-cloudship.pdf' }

export function rossiEditore(): Project {
  return {
    schemaVersion: 1,
    name: 'Rossi Editore srl',
    createdAt: '2026-08-03T09:00:00.000Z',
    purposeGroups: [
      'Running the systems',
      'Marketing',
      'Delivering orders',
      'Support',
      'Payroll & HR',
    ],
    subjectGroups: [
      { id: 'sg-1', name: 'Customers' },
      { id: 'sg-2', name: 'Website visitors' },
      { id: 'sg-3', name: 'Employees' },
    ],
    places: [
      {
        id: 'pl-1',
        name: 'Rossi Editore srl',
        kind: 'internal',
        purposeGroup: 'Running the systems',
        holder: 'you',
        leavesEEA: false,
        sources: [DOC],
        confidence: 'declared',
      },
      {
        id: 'pl-2',
        name: 'Newsletter sign-up',
        kind: 'collection',
        purposeGroup: 'Marketing',
        holder: 'you',
        leavesEEA: false,
        sources: [DOC],
        confidence: 'declared',
      },
      {
        id: 'pl-3',
        name: 'Order form',
        kind: 'collection',
        purposeGroup: 'Delivering orders',
        holder: 'you',
        leavesEEA: false,
        sources: [DOC],
        confidence: 'declared',
      },
      {
        id: 'pl-4',
        name: 'Mailchimp',
        kind: 'processor',
        purposeGroup: 'Marketing',
        holder: 'supplier',
        jurisdiction: 'United States',
        leavesEEA: true,
        retention: 'until unsubscribed',
        dataCategories: ['email address', 'name'],
        sources: [DOC],
        confidence: 'declared',
      },
      {
        id: 'pl-5',
        name: 'CloudShip',
        kind: 'processor',
        purposeGroup: 'Delivering orders',
        holder: 'supplier',
        jurisdiction: 'Ireland',
        leavesEEA: false,
        retention: '24 months',
        dataCategories: ['name', 'postal address', 'telephone number'],
        sources: [DPA],
        confidence: 'declared',
      },
      {
        id: 'pl-6',
        name: 'Helpdesk',
        kind: 'internal',
        purposeGroup: 'Support',
        holder: 'you',
        leavesEEA: false,
        sources: [DOC],
        confidence: 'declared',
      },
      {
        id: 'pl-7',
        name: 'Payroll system',
        kind: 'internal',
        purposeGroup: 'Payroll & HR',
        holder: 'you',
        leavesEEA: 'unknown',
        sources: [],
        confidence: 'inferred',
      },
      {
        id: 'pl-8',
        name: 'stat.rossi-editore.it',
        kind: 'unknown',
        purposeGroup: 'Marketing',
        holder: 'unknown',
        leavesEEA: 'unknown',
        sources: [],
        confidence: 'observed',
      },
      {
        id: 'pl-9',
        name: 'cdn.unrecognised-host.net',
        kind: 'unknown',
        purposeGroup: 'Running the systems',
        holder: 'unknown',
        leavesEEA: 'unknown',
        sources: [],
        confidence: 'observed',
      },
    ],
    flows: [
      {
        id: 'fl-1',
        from: 'sg-2',
        to: 'pl-2',
        dataDescription: 'email address',
        purpose: 'Newsletter',
        sources: [DOC],
        confidence: 'declared',
      },
      {
        id: 'fl-2',
        from: 'sg-1',
        to: 'pl-3',
        dataDescription: 'order details',
        purpose: 'Delivering orders',
        sources: [DOC],
        confidence: 'declared',
      },
      {
        id: 'fl-3',
        from: 'pl-2',
        to: 'pl-4',
        dataDescription: 'email address',
        purpose: 'Newsletter',
        sources: [DOC],
        confidence: 'declared',
      },
      {
        id: 'fl-4',
        from: 'pl-3',
        to: 'pl-5',
        dataDescription: 'delivery address',
        purpose: 'Delivering orders',
        sources: [DPA],
        confidence: 'declared',
      },
      {
        id: 'fl-5',
        from: 'pl-3',
        to: 'pl-4',
        dataDescription: 'email address',
        purpose: 'Order confirmation',
        sources: [DOC],
        confidence: 'declared',
      },
      {
        id: 'fl-6',
        from: 'sg-3',
        to: 'pl-7',
        dataDescription: 'pay details',
        purpose: 'Payroll',
        sources: [],
        confidence: 'inferred',
      },
    ],
    observations: [
      { domain: 'stat.rossi-editore.it', requestCount: 12, beforeConsent: true },
      { domain: 'cdn.unrecognised-host.net', requestCount: 3, beforeConsent: true },
    ],
    cookies: [
      { name: '_ga', domain: '.rossi-editore.it', thirdParty: false, lifetime: 'a-year-or-more' },
      { name: 'sid', domain: '.rossi-editore.it', thirdParty: false, lifetime: 'session' },
    ],
    collectionPoints: [
      {
        id: 'cp-1',
        page: 'https://rossi-editore.it/contatti',
        fields: [
          { name: 'email', kind: 'email' },
          { name: 'nome', kind: 'name' },
          { name: 'messaggio', kind: 'free-text' },
        ],
        sources: [],
        confidence: 'observed',
      },
    ],
  }
}

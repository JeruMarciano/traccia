/**
 * Every user-facing string. Nothing outside this file may contain display text.
 * English only in v1; adding Italian later means adding a second object here, not
 * touching components.
 *
 * Register of tone: this sheet is shown to a paying client. An unanswered question is work
 * still to do, never an accusation, so the copy names what is missing and what answering it
 * would do -- and never uses the vocabulary of fault.
 */
export const STRINGS = {
  appName: 'Traccia',
  open: 'Open',
  save: 'Save',
  undo: 'Undo',
  redo: 'Redo',
  print: 'Print',
  untitled: 'Untitled',
  startedOn: (date: string): string => `Started ${date}`,

  printLimits:
    'This map shows what this website contacts from a visitor’s browser. ' +
    'It does not show data moving inside the organisation, anything behind a login, ' +
    'or anything that is not on the web. ' +
    'A connection made over a secure WebSocket (wss://) is not visible to this kind of scan, ' +
    'so a vendor reached only that way will not appear here.',

  people: 'People',
  subjectGroupCount: (n: number): string => `${n} groups`,
  placesInGroup: (n: number): string => `${n} places`,
  notYetIdentified: 'not yet identified',
  groupTitle: (name: string, places: number): string => `${name}: ${places} places`,
  mapEmpty: 'Open a project to draw the map.',

  /** The centre before any document has named the organisation. Never a guessed company name. */
  yourOrganisation: 'Your organisation',
  doorDiscovered: 'discovered by the scan',
  doorDeclared: 'declared in a document',

  keyPeople: 'People',
  keyPeopleGloss: 'Every line starts here.',
  keyDoor: 'Way in',
  keyDoorGloss: 'Where data is collected.',
  keyDirection: 'Direction',
  keyDirectionGloss: 'The arrow points where the data goes.',
  keyInternal: 'Your systems',
  keyInternalGloss: 'Run by the organisation itself.',
  keyExternal: 'Suppliers',
  keyExternalGloss: 'Run by somebody else.',
  keyOpen: 'Not yet identified',
  keyOpenGloss: 'The dashed share of a ring.',

  saveBlocked:
    'The project could not be saved because another program is holding the file open. Close it and try again.',
  dismiss: 'Dismiss',
  openFailed: 'This file could not be read as a project.',
  saveFailed: 'The project could not be saved.',

  addDocuments: 'Add documents',
  documentsFailed: 'The documents could not be read.',
  documentsNothingFound:
    'Nothing describing a data-processing activity was found in those documents.',
  documentsUnreadable: (names: string): string => `Could not read: ${names}.`,
  documentsTruncated: (names: string): string =>
    `Read only partially (very large file): ${names}.`,
  documentsNoText: (names: string): string =>
    `No text to read in: ${names}. A scanned or photographed page holds a picture of text, not text.`,
  suggestionsRead: (count: number, names: string): string =>
    `Read ${count} ${count === 1 ? 'document' : 'documents'}: ${names}`,
  suggestionsHeading: 'Found in the documents',
  suggestionsCaption:
    'Tick what belongs on the map. The documents themselves are not kept — only what you confirm.',
  suggestionsConfirm: 'Add to map',
  suggestionsCancel: 'Discard all',
  suggestionFoundIn: (names: string): string => `Found in ${names}`,
  suggestionInternal: 'Internal',
  suggestionExternal: 'Supplier',
  suggestionSubjectGroup: 'People',
  suggestionRetention: (value: string): string => `Kept for ${value}`,
  suggestionJurisdiction: (value: string): string => `Located in ${value}`,
  suggestionDataCategories: (values: string): string => `Holds ${values}`,
  detailPurpose: 'Purpose',
  declaredIn: (names: string): string => `Declared: ${names}`,

  detailHeading: 'What is here',
  detailPeopleHeading: 'People',
  detailWhere: 'Where',
  detailWhereOutsideEEA: 'Outside the EEA',
  detailWhereInsideEEA: 'Inside the EEA',
  detailRetention: 'Retention',
  detailDataCategories: 'What is held',
  detailObservationsHeading: 'Trackers observed',
  detailObservation: (domain: string, requestCount: number, beforeConsent: boolean): string => {
    const requests = `${requestCount} ${requestCount === 1 ? 'request' : 'requests'}`
    return beforeConsent ? `${domain} — ${requests}, before consent` : `${domain} — ${requests}`
  },

  scanPlaceholder: 'Website address',
  scan: 'Scan',
  scanCancel: 'Stop',
  scanNoBrowser: 'Traccia could not find Chrome or Edge on this computer.',
  scanBadUrl:
    'That does not look like a website address Traccia can scan. Paste the plain address, without a port number such as ":443".',
  scanBusy: 'A scan is already running. Let it finish, or stop it, before starting another.',
  scanFailed: 'The scan could not be completed.',
  scanFoundNothing: 'The scan finished without observing any third party.',
  scanIncomplete: (n: number): string =>
    `Scan complete — ${n} ${n === 1 ? 'place' : 'places'} where the map may be incomplete.`,
  scanStopped: (n: number): string =>
    n === 0
      ? 'Scan stopped before it finished.'
      : `Scan stopped before it finished — ${n} ${n === 1 ? 'place' : 'places'} where the map may be incomplete.`,
  cookiesRecorded: (n: number, thirdParty: number): string =>
    `${n} ${n === 1 ? 'cookie' : 'cookies'} recorded (${thirdParty} third-party).`,
  storageKeysRecorded: (n: number): string =>
    `${n} ${n === 1 ? 'storage key' : 'storage keys'} recorded.`,
  collectionPointsDiscovered: (n: number): string =>
    `${n} ${n === 1 ? 'collection point' : 'collection points'} discovered.`,
  consentBannerDetected: (marker: string): string =>
    `A consent banner appears to be present (${marker}).`,
  consentBannerNotDetected: 'No consent banner was detected.',
} as const

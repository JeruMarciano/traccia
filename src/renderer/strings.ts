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
  outsideEEA: 'outside the EEA',
  notYetIdentified: 'not yet identified',
  groupTitle: (name: string, places: number): string => `${name}: ${places} places`,
  mapEmpty: 'Open a project to draw the map.',

  keyPeople: 'People',
  keyPeopleGloss: 'Every line starts here.',
  keyRecorded: 'Recorded',
  keyRecordedGloss: 'A document or a scan says so.',
  keyOpen: 'Not yet identified',
  keyOpenGloss: 'Waiting on an answer.',
  keyCrossing: 'Leaves the EEA',
  keyCrossingGloss: 'Data comes to rest outside the area.',

  registerHeading: 'Not yet identified',
  registerCaption: 'Fullest marks first. Answer one and it leaves this list.',
  registerEmpty: 'No open questions yet. They appear here as the map fills in.',
  priority: (severity: 1 | 2 | 3): string =>
    severity === 1 ? 'Answer first' : severity === 2 ? 'Answer next' : 'Answer when you can',

  saveBlocked:
    'The project could not be saved because another program is holding the file open. Close it and try again.',
  dismiss: 'Dismiss',
  openFailed: 'This file could not be read as a project.',
  saveFailed: 'The project could not be saved.',

  scanPlaceholder: 'Website address',
  scan: 'Scan',
  scanning: (page: number, of: number): string => `Scanning — page ${page} of ${of}`,
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
} as const

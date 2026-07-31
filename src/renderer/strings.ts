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
  untitled: 'Untitled',
  startedOn: (date: string): string => `Started ${date}`,

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
} as const

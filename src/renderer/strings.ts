/**
 * Every user-facing string. Nothing outside this file may contain display text.
 * English only in v1; adding Italian later means adding a second object here, not
 * touching components.
 */
export const STRINGS = {
  open: 'Open',
  save: 'Save',
  undo: 'Undo',
  redo: 'Redo',
  untitled: 'Untitled',
  people: 'People',
  placesInGroup: (n: number): string => `${n} places`,
  registerHeading: (n: number): string => `Not yet identified · ${n}`,
  registerEmpty: 'Nothing outstanding. Add a place or run a scan to find more.',
  saveBlocked:
    'The project could not be saved because another program is holding the file open. Close it and try again.',
  dismiss: 'Dismiss',
  openFailed: 'This file could not be read as a project.',
  saveFailed: 'The project could not be saved.',
} as const

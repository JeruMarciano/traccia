import type { Door, DoorOrigin, Project } from './types'

/**
 * A door is where data comes in. Two things are one here: a Place the documents declared as a
 * collection point, and a CollectionPoint the scan discovered on a page. They read the same on
 * the map and differ only in the caption, which is why they share a type rather than being
 * drawn twice.
 *
 * Nothing here is stored. Doors, like gaps, are computed from what the project already holds.
 */

/** Six, and it cycles. A seventh door repeats the first colour; the label disambiguates. */
export const DOOR_COLOURS = 6

export function deriveDoors(project: Project): Door[] {
  const declared: Door[] = project.places
    .filter((p) => p.kind === 'collection')
    .map((p) => ({
      id: `place:${p.id}`,
      label: p.name,
      origin: 'declared' as DoorOrigin,
      colourIndex: 0,
      fields: [],
    }))

  const discovered: Door[] = (project.collectionPoints ?? []).map((cp) => ({
    id: `cp:${cp.id}`,
    label: cp.page,
    origin: 'discovered' as DoorOrigin,
    colourIndex: 0,
    fields: cp.fields.map((f) => f.name),
  }))

  // Declared first, then discovered, each in project order: the colour a door gets has to be the
  // same colour on the next open of the same file, so position is the only input.
  return [...declared, ...discovered].map((d, i) => ({ ...d, colourIndex: i % DOOR_COLOURS }))
}

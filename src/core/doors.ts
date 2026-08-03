import type { Door, DoorOrigin, DoorPath, Project } from './types'

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

/** The place id a door stands for: `place:pl-2` -> `pl-2`. A `cp:` door has no place, so its
 *  underlying id matches no flow, and it traces to nothing -- which is the honest answer. */
function underlyingId(door: Door): string {
  return door.id.slice(door.id.indexOf(':') + 1)
}

/**
 * Where one door's data goes and who comes through it, so the map can carry the door's colour
 * along the whole path rather than starting it at the door.
 *
 * One hop out and one hop in, deliberately not recursive. A flows array can hold a cycle, and a
 * map that hangs on a cycle is worse than a map that draws one hop; a destination that forwards
 * onward is still drawn, from the destination, in neutral.
 */
export function tracePaths(project: Project, doors: Door[]): DoorPath[] {
  const isSubject = (id: string): boolean => project.subjectGroups.some((s) => s.id === id)
  return doors.map((door) => {
    const at = underlyingId(door)
    return {
      doorId: door.id,
      destinationIds: [...new Set(project.flows.filter((f) => f.from === at).map((f) => f.to))],
      // Only people. A place feeding a door is a flow like any other, but it is not somebody
      // coming through the door, and drawing it as one would put a supplier on the inbound side.
      subjectIds: [
        ...new Set(project.flows.filter((f) => f.to === at).map((f) => f.from).filter(isSubject)),
      ],
    }
  })
}

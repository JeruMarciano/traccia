import { classifyField, isCollectingField, isDoorForm } from './forms'
import { isSameSite } from './scan'
import { identify } from './vendors'
import type {
  CollectionPointField,
  Door,
  DoorCandidate,
  DoorKind,
  DoorOrigin,
  DoorPath,
  Project,
  RawFormField,
  ScanResult,
  VendorDictionary,
} from './types'

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

const KIND_LABEL: Record<DoorKind, string> = {
  form: 'Form',
  newsletter: 'Newsletter',
  booking: 'Booking',
  chat: 'Chat',
  embed: 'Embed',
}

/** A form door is named by its page; any other by its kind and, when known, who runs it. */
function doorLabel(kind: DoorKind, page: string, provider: string | undefined): string {
  if (kind === 'form') return page
  return provider === undefined ? KIND_LABEL[kind] : `${KIND_LABEL[kind]} on ${provider}`
}

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
    label: doorLabel(cp.kind ?? 'form', cp.page, cp.provider),
    origin: 'discovered' as DoorOrigin,
    colourIndex: 0,
    fields: cp.fields.map((f) => f.name),
    kind: cp.kind ?? 'form',
    pages: cp.pages ?? [cp.page],
    ...(cp.destination === undefined ? {} : { destination: cp.destination }),
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
      // A discovered door's own destination first: it is not a place, so no flow starts at it.
      destinationIds: [
        ...new Set([
          ...(door.destination === undefined ? [] : [door.destination]),
          ...project.flows.filter((f) => f.from === at).map((f) => f.to),
        ]),
      ],
      // Only people. A place feeding a door is a flow like any other, but it is not somebody
      // coming through the door, and drawing it as one would put a supplier on the inbound side.
      subjectIds: [
        ...new Set(project.flows.filter((f) => f.to === at).map((f) => f.from).filter(isSubject)),
      ],
    }
  })
}

const EMBED_CATEGORIES = new Set(['maps', 'video', 'captcha', 'payments'])

/**
 * Spec §7. Doors a scan found, one per page for a form and one per (kind, provider) for the rest.
 * Pure and rule-based: the provider is the host exactly as scanned, never a guessed name, and a
 * vendor the dictionary does not know still gets its door (a blank beats a guess).
 *
 * Stated over-count: a chat vendor's host seen on any page is a chat door, even if its script only
 * preloaded.
 */
export function classifyDoors(result: ScanResult, dictionary: VendorDictionary): DoorCandidate[] {
  const doors: DoorCandidate[] = []
  const shared = new Map<string, DoorCandidate>()
  const thirdParty = (host: string): boolean => host !== '' && !isSameSite(host, result.scannedHost)
  const addShared = (
    kind: DoorKind,
    page: string,
    provider: string | null,
    fields: CollectionPointField[] = [],
  ): void => {
    // One vendor can have many hosts: the owner and category join them when the dictionary knows it.
    const hit = provider === null ? null : identify(provider, dictionary)
    const key = `${kind}|${hit === null ? (provider ?? '') : `${hit.owner}|${hit.category}`}`
    const door = shared.get(key)
    if (door === undefined) {
      const created = { kind, page, pages: page === '' ? [] : [page], provider, fields }
      shared.set(key, created)
      doors.push(created)
      return
    }
    if (page !== '' && !door.pages.includes(page)) door.pages.push(page)
    for (const f of fields) if (!door.fields.some((x) => x.name === f.name)) door.fields.push(f)
  }

  const bookingPages = new Set((result.pages ?? []).filter((p) => p.purpose === 'booking').map((p) => p.page))
  const byPage = new Map<string, RawFormField[]>()
  for (const field of result.formFields) byPage.set(field.page, [...(byPage.get(field.page) ?? []), field])

  for (const [page, onPage] of byPage) {
    const forms = new Map<number, RawFormField[]>()
    for (const field of onPage) forms.set(field.form ?? -1, [...(forms.get(field.form ?? -1) ?? []), field])
    const formFields: CollectionPointField[] = []
    let formProvider: string | null = null
    for (const group of forms.values()) {
      if (!isDoorForm(group)) continue
      const collecting = group.filter(isCollectingField)
      const fields = collecting.map((f) => ({ name: f.name, kind: classifyField(f) }))
      const action = group.map((f) => f.actionHost ?? '').find((h) => thirdParty(h)) ?? null
      const passwordAsked = collecting.some((f) => f.type.trim().toLowerCase() === 'password')
      const mailingVendor = action !== null && identify(action, dictionary)?.category === 'email-marketing'
      const emailOnly = collecting.length === 1 && fields[0]?.kind === 'email'
      if (!passwordAsked && (emailOnly || mailingVendor)) {
        addShared('newsletter', page, mailingVendor ? action : null, fields)
      } else if (bookingPages.has(page)) {
        addShared('booking', page, action, fields)
      } else {
        formFields.push(...fields)
        // ponytail: one provider per page; a second third-party action on the same page is not shown.
        formProvider ??= action
      }
    }
    if (formFields.length > 0) {
      doors.push({ kind: 'form', page, pages: [page], provider: formProvider, fields: formFields })
    }
  }

  for (const link of result.offsiteLinks ?? []) {
    if (link.purpose === 'booking' && thirdParty(link.host)) addShared('booking', link.page, link.host)
  }
  for (const { host } of result.hosts) {
    if (thirdParty(host) && identify(host, dictionary)?.category === 'live-chat') {
      addShared('chat', '', host)
    }
  }
  for (const frame of result.iframes ?? []) {
    const category = thirdParty(frame.host) ? identify(frame.host, dictionary)?.category : undefined
    if (category !== undefined && EMBED_CATEGORIES.has(category)) addShared('embed', frame.page, frame.host)
  }
  return doors
}

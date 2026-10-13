import type { LayoutNode } from '../core/layout'
import { fitLabel, maxChars } from './fitLabel'
import { MAP_TEXT } from './mapMetrics'
import { STRINGS } from './strings'

/** The three rows of destinations that are not a purpose, and so have no name in the project. */
const DESTINATION: Readonly<Record<string, string>> = STRINGS.destination

/** The words for a row, in full. The layout gives kinds, counts and bare paths; the words are here. */
export function rowText(node: LayoutNode): string {
  switch (node.kind) {
    case 'controller':
      return node.label === '' ? STRINGS.yourOrganisation : node.label
    case 'doorGroup':
      return STRINGS.doorFold[node.doorKind ?? 'form'](node.count ?? 0)
    case 'more':
      return STRINGS.more(node.count ?? 0)
    case 'door':
      return node.doorKind === 'form' && node.label === '/' ? STRINGS.homePage : node.label
    case 'group':
      return node.label === '' ? (DESTINATION[node.id] ?? '') : node.label
    default:
      return node.label
  }
}

export function fontSizeOf(node: LayoutNode): number {
  return node.parent !== undefined ? MAP_TEXT.sub : MAP_TEXT.row
}

/** What is actually written in the row's box: shortened to fit. An address is cut in the middle,
 *  a page's path and an unidentified host alike: both ends are what tell one from the next. */
export function drawnText(node: LayoutNode): string {
  const address = (node.kind === 'door' && node.doorKind === 'form') || (node.kind === 'member' && node.mark === 'unidentified')
  const cut = address ? 'middle' : 'end'
  return fitLabel(rowText(node), maxChars(node.labelBox.width, fontSizeOf(node)), cut)
}

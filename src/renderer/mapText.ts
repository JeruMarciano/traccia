import type { LayoutNode } from '../core/layout'
import { NOT_IDENTIFIED } from '../core/scan'
import { fitLabel, maxChars } from './fitLabel'
import { MAP_TEXT } from './mapMetrics'
import { STRINGS } from './strings'

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
    default:
      return node.label
  }
}

/** What follows a group's name: how many of its places nobody has identified yet. Not said on the
 *  group that is itself the unidentified ones, where the name already says it. */
export function rowSuffix(node: LayoutNode): string {
  const open = node.unexplained ?? 0
  if (node.kind !== 'group' || open === 0 || node.label === NOT_IDENTIFIED) return ''
  return STRINGS.groupUnidentified(open)
}

export function fontSizeOf(node: LayoutNode): number {
  return node.parent !== undefined || node.kind === 'subject' ? MAP_TEXT.sub : MAP_TEXT.row
}

/** What is actually written in the row's box: shortened to fit, the suffix kept whole. */
export function drawnText(node: LayoutNode): { text: string; suffix: string } {
  const suffix = rowSuffix(node)
  const room = maxChars(node.labelBox.width, fontSizeOf(node)) - (suffix === '' ? 0 : suffix.length + 3)
  const cut = node.kind === 'door' && node.doorKind === 'form' ? 'middle' : 'end'
  return { text: fitLabel(rowText(node), room, cut), suffix }
}

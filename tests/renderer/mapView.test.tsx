// The sheet is rendered to static markup rather than into a DOM: every claim here is about what
// the map says and how it is marked up, which the markup answers on its own.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeLayout, type LayoutView } from '../../src/core/layout'
import { MapView } from '../../src/renderer/components/MapView'
import { STRINGS } from '../../src/renderer/strings'
import type { DoorKind, Project } from '../../src/core/types'
import { dorsaleOversized, dorsaleSmall, dorsaleUgly } from '../fixtures/dorsale'
import { emptyProject } from '../fixtures/projects'
import { rossiEditore } from '../fixtures/rossiEditore'

function draw(project: Project = rossiEditore(), view: LayoutView = {}): string {
  return renderToStaticMarkup(
    <MapView
      layout={computeLayout(project, view)}
      selected={view.selectedId ?? null}
      onSelect={() => {}}
      openGroup={view.openGroup ?? null}
      onToggleGroup={() => {}}
      openKind={view.openKind ?? null}
      onToggleKind={() => {}}
    />,
  )
}
const count = (markup: string, pattern: RegExp): number => (markup.match(pattern) ?? []).length
/** The drawing without its key: the key draws a door, a line and an arrowhead of its own. */
const sheet = (markup: string): string => markup.slice(0, markup.indexOf('<figcaption'))
const BOTH = { openGroup: 'Marketing', openKind: 'form' as DoorKind }
/** The opening tag of the group drawn for one node. */
const tagOf = (markup: string, id: string): string => markup.match(new RegExp(`<g[^>]*data-id="${id}"[^>]*>`))?.[0] ?? ''

describe('MapView', () => {
  it('says the map is empty rather than drawing an empty sheet', () => {
    expect(draw(emptyProject())).toContain(STRINGS.mapEmpty)
  })

  it('sizes the sheet to its rows', () => {
    expect(draw(dorsaleSmall())).toContain('viewBox="0 0 1000 234"')
    expect(draw(dorsaleUgly(), BOTH)).toContain('viewBox="0 0 1000 408"')
  })

  it('heads the three columns', () => {
    const markup = draw()
    for (const head of [STRINGS.headPeople, STRINGS.headDoors, STRINGS.headPlaces]) expect(markup).toContain(`>${head}</text>`)
  })

  it('draws the organisation as a bar, named above it', () => {
    expect(count(draw(), /class="spine"/g)).toBe(1)
    expect(draw()).toContain('Rossi Editore srl')
    expect(draw(dorsaleSmall())).toContain(STRINGS.yourOrganisation)
  })

  it('draws one row per way in, and writes no origin caption on the map', () => {
    const markup = sheet(draw())
    expect(count(markup, /class="door door--\d/g)).toBe(3)
    expect(markup).not.toContain(STRINGS.doorDiscovered)
    expect(markup).not.toContain(STRINGS.doorDeclared)
  })

  it('lets the mark say where a door comes from: filled, outlined, dashed', () => {
    const p = rossiEditore()
    p.places.push({ id: 'pl-x', name: 'Counter', kind: 'collection', purposeGroup: 'Systems', holder: 'you', leavesEEA: false, sources: [], confidence: 'declared' })
    const markup = sheet(draw(p))
    expect(count(markup, /class="door-mark door-mark--declared"/g)).toBe(2)
    expect(count(markup, /class="door-mark door-mark--discovered"/g)).toBe(1)
    expect(count(markup, /class="door-mark door-mark--unsourced"/g)).toBe(1)
  })

  it('folds twelve forms into one row that says so, and opens it into sub-rows', () => {
    const closed = sheet(draw(dorsaleUgly()))
    expect(closed).toContain('Forms on 12 pages')
    expect(count(closed, /class="door door--\d/g)).toBe(3)
    const open = draw(dorsaleUgly(), { openKind: 'form' })
    expect(count(open, /class="door door--\d door--sub/g)).toBe(5)
    expect(open).toContain('+7 more')
    expect(tagOf(open, 'doorGroup:form')).toContain('aria-expanded="true"')
    expect(tagOf(closed, 'doorGroup:form')).toContain('aria-expanded="false"')
  })

  it('says Home page for the form on the site’s root', () => {
    expect(draw(dorsaleUgly(), { openKind: 'form' })).toContain(`>${STRINGS.homePage}</text>`)
  })

  it('writes no text longer than its row, and keeps the whole of it in the tooltip', () => {
    const p = dorsaleOversized()
    const long = p.collectionPoints![0]!.page.replace('https://example.test', '')
    const markup = draw(p, { openKind: 'form' })
    for (const [, text] of markup.matchAll(/<text class="row-label[^"]*"[^>]*>([^<]*)</g)) {
      expect(Array.from(text ?? '').length).toBeLessThanOrEqual(41)
    }
    expect(markup).toContain(`<title>${long}</title>`)
  })

  it('says in words how many places of a group are not yet identified', () => {
    const markup = draw(dorsaleUgly())
    expect(markup).toContain('5 not yet identified')
    // Marketing, Payments and Systems; not the group that is itself "Not yet identified".
    expect(count(markup, /not yet identified<\/tspan>/g)).toBe(3)
  })

  it('lists the members of an open group under it, an unidentified one dashed', () => {
    const markup = draw(rossiEditore(), { openGroup: 'Marketing' })
    expect(markup).toContain('stat.rossi-editore.it')
    expect(count(markup, /class="member-mark/g)).toBe(2)
    expect(count(markup, /class="member-mark member-mark--open"/g)).toBe(1)
    expect(tagOf(markup, 'group:Marketing')).toContain('node--open')
  })

  it('gives every line the class of its door’s colour, and a neutral one to an unreached place', () => {
    const markup = draw()
    expect(markup).toContain('class="path path--0')
    expect(markup).toContain('class="path path--1')
    expect(markup).toContain('class="path path--neutral')
  })

  it('draws an arrowhead exactly where a line ends', () => {
    const layout = computeLayout(dorsaleUgly())
    expect(count(sheet(draw(dorsaleUgly())), /class="head head--/g)).toBe(layout.edges.filter((e) => e.arrow).length)
  })

  it('never greys the sheet around nothing: the row that hides the selection stays lit', () => {
    const p = dorsaleUgly()
    const hidden = `door:cp:${p.collectionPoints!.filter((cp) => (cp.kind ?? 'form') === 'form')[11]!.id}`
    const closed = draw(p, { selectedId: hidden })
    expect(tagOf(closed, 'doorGroup:form')).toContain('highlighted')
    expect(tagOf(closed, 'doorGroup:form')).not.toContain('dim')
    expect(tagOf(closed, 'door:place:scan1-pl-1')).toContain('dim')
    const open = draw(p, { openKind: 'form', selectedId: hidden })
    expect(tagOf(open, 'moreDoors:form')).toContain('highlighted')
  })

  it('does not grey a fold’s own rows when the fold is what is selected', () => {
    // The wrong answer: clicking "Forms on 12 pages" opens it and dims the twelve forms.
    const p = dorsaleUgly()
    const view = { openKind: 'form' as DoorKind, selectedId: 'doorGroup:form' }
    const markup = draw(p, view)
    const sub = computeLayout(p, view).nodes.find((n) => n.parent === 'doorGroup:form')!
    expect(tagOf(markup, sub.id)).not.toContain('dim')
    expect(tagOf(markup, 'moreDoors:form')).not.toContain('dim')
    expect(tagOf(markup, 'door:place:scan1-pl-1')).toContain('dim')
  })

  it('dims nothing when the selection names nothing on the sheet', () => {
    expect(draw(rossiEditore(), { selectedId: 'nothing-here' })).not.toContain(' dim')
  })

  it('states no EEA count anywhere on the sheet', () => {
    expect(draw()).not.toMatch(/outside the EEA/i)
  })

  it('keeps the six notations in the key, with the three states of a way in', () => {
    const markup = draw()
    expect(markup).toContain(STRINGS.keyDoor)
    expect(markup).toContain('origin not established')
    expect(count(markup, /class="key"/g)).toBe(6)
  })

  // No DOM in this suite, so the component is called as a function and its element tree walked:
  // MapView is hook-free and draws host elements only, which makes the handlers reachable.
  describe('folds, by mouse and by keyboard', () => {
    type Props = Record<string, unknown> & { onClick?: (ev: unknown) => void; onKeyDown?: (ev: unknown) => void }
    const find = (node: unknown, id: string): Props | undefined => {
      if (Array.isArray(node)) {
        for (const n of node) {
          const hit = find(n, id)
          if (hit !== undefined) return hit
        }
        return undefined
      }
      const el = node as { props?: Props & { children?: unknown } } | null
      if (el === null || typeof el !== 'object' || el.props === undefined) return undefined
      if (el.props['data-id'] === id) return el.props
      return find(el.props.children, id)
    }
    const ev = (key?: string) => ({ key, stopPropagation: () => {}, preventDefault: () => {} })
    const tree = (view: LayoutView, log: string[]) =>
      MapView({
        layout: computeLayout(dorsaleUgly(), view),
        selected: null,
        onSelect: (id) => log.push(`select ${id}`),
        openGroup: view.openGroup ?? null,
        onToggleGroup: (g) => log.push(`group ${g}`),
        openKind: view.openKind ?? null,
        onToggleKind: (k) => log.push(`kind ${k}`),
      })

    it('opens a fold of doors on click, Enter and Space, and closes it again', () => {
      const log: string[] = []
      const closed = find(tree({}, log), 'doorGroup:form')!
      expect(closed.role).toBe('button')
      expect(closed.tabIndex).toBe(0)
      closed.onClick!(ev())
      closed.onKeyDown!(ev('Enter'))
      closed.onKeyDown!(ev(' '))
      closed.onKeyDown!(ev('a'))
      expect(log.filter((l) => l === 'kind form')).toHaveLength(3)
      expect(log.filter((l) => l === 'select doorGroup:form')).toHaveLength(3)
      const log2: string[] = []
      find(tree({ openKind: 'form' }, log2), 'doorGroup:form')!.onClick!(ev())
      expect(log2).toContain('kind null')
    })

    it('selects the fold from its +N more row, and the group from a group’s', () => {
      const log: string[] = []
      const t = tree(BOTH, log)
      const moreDoors = find(t, 'moreDoors:form')!
      expect(moreDoors.tabIndex).toBe(0)
      moreDoors.onKeyDown!(ev('Enter'))
      find(t, 'more:Marketing')!.onClick!(ev())
      expect(log).toEqual(['select doorGroup:form', 'select group:Marketing'])
    })

    it('selects a sub-row’s own door', () => {
      const log: string[] = []
      const t = tree({ openKind: 'form' }, log)
      const first = computeLayout(dorsaleUgly(), { openKind: 'form' }).nodes.find((n) => n.parent === 'doorGroup:form')!
      find(t, first.id)!.onClick!(ev())
      expect(log).toEqual([`select ${first.id}`])
    })
  })
})

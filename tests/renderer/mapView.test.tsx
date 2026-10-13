// The sheet is rendered to static markup rather than into a DOM: every claim here is about what
// the map says and how it is marked up, which the markup answers on its own.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeLayout, type LayoutView } from '../../src/core/layout'
import { MapView } from '../../src/renderer/components/MapView'
import { STRINGS } from '../../src/renderer/strings'
import type { DoorKind, Project } from '../../src/core/types'
import { DORSALE_FIXTURES, dorsaleOversized, dorsaleSmall, dorsaleUgly } from '../fixtures/dorsale'
import { emptyProject } from '../fixtures/projects'
import { rossiEditore } from '../fixtures/rossiEditore'

function draw(project: Project = rossiEditore(), view: LayoutView = {}, hovered: string | null = null): string {
  return renderToStaticMarkup(
    <MapView
      layout={computeLayout(project, view)}
      selected={view.selectedId ?? null}
      onSelect={() => {}}
      openGroup={view.openGroup ?? null}
      onToggleGroup={() => {}}
      openKind={view.openKind ?? null}
      onToggleKind={() => {}}
      hovered={hovered}
    />,
  )
}
const count = (markup: string, pattern: RegExp): number => (markup.match(pattern) ?? []).length
/** The drawing without its key: the key draws a door, a line and an arrowhead of its own. */
const sheet = (markup: string): string => markup.slice(0, markup.indexOf('<figcaption'))
/** Closed, and with a fold and the fullest row of destinations open. */
const VIEWS = (p: Project): LayoutView[] => [{}, { openKind: 'form' }, { openGroup: computeLayout(p).nodes.find((n) => n.kind === 'group')!.id, openKind: 'form' }]
const BOTH = { openGroup: 'group:Marketing', openKind: 'form' as DoorKind }
/** The opening tag of the group drawn for one node. */
const tagOf = (markup: string, id: string): string => markup.match(new RegExp(`<g[^>]*data-id="${id}"[^>]*>`))?.[0] ?? ''

describe('MapView', () => {
  it('says the map is empty rather than drawing an empty sheet', () => {
    expect(draw(emptyProject())).toContain(STRINGS.mapEmpty)
  })

  it('sizes the sheet to its rows', () => {
    expect(draw(dorsaleSmall())).toContain('viewBox="0 0 1000 182"')
    expect(draw(dorsaleUgly(), BOTH)).toContain('viewBox="0 0 1000 389"')
  })

  it('heads the four columns', () => {
    const markup = draw()
    for (const head of [STRINGS.headPeople, STRINGS.headDoors, STRINGS.headController, STRINGS.headPlaces]) expect(markup).toContain(`>${head}</text>`)
  })

  it('draws the organisation as one card, its name inside it', () => {
    // The wrong answer: a hollow bar the height of the sheet with the name floating above it.
    const markup = sheet(draw())
    const card = markup.match(/<g[^>]*data-id="controller"[^>]*>(.*?)<\/g>/)?.[1] ?? ''
    expect(count(card, /<rect class="card-box"/g)).toBe(1)
    expect(card).toContain('class="home"')
    expect(card).toContain('>Rossi Editore srl</text>')
    expect(markup).not.toContain('class="spine"')
    expect(draw(dorsaleSmall())).toContain(`>${STRINGS.yourOrganisation}</text>`)
  })

  it('draws every stop as a card with one corner', () => {
    const markup = sheet(draw(dorsaleUgly(), BOTH))
    const cards = [...markup.matchAll(/<rect class="card-box"[^>]*>/g)].map((m) => m[0])
    // People, four ways in, the organisation, five rows of destinations.
    expect(cards).toHaveLength(11)
    expect(new Set(cards.map((c) => c.match(/rx="([^"]+)"/)?.[1])).size).toBe(1)
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
    expect(open).toContain('>+7 more</text>')
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
      expect(Array.from(text ?? '').length).toBeLessThanOrEqual(30)
    }
    expect(markup).toContain(`<title>${long}</title>`)
  })

  it('counts what is not yet identified once, in its own row, and says so nowhere else', () => {
    // The wrong answer: "Marketing · 5 not yet identified", three rows above a row counting the same five.
    const markup = sheet(draw(dorsaleUgly()))
    expect(count(markup, /not yet identified/gi)).toBe(2) // the row's label and its tooltip
    expect(markup.match(/<g[^>]*data-id="unidentified"[^>]*>(.*?)<\/g>/)?.[1]).toContain('class="count"')
    expect(markup.match(/<g[^>]*data-id="unidentified"[^>]*>(.*?)<\/g>/)?.[1]).toMatch(/>15<\/text>/)
  })

  it('tells own systems, suppliers and the unidentified apart by the shape of the mark', () => {
    const markup = sheet(draw(rossiEditore()))
    expect(tagOf(markup, 'own')).toContain('node--internal')
    expect(markup).toMatch(/<rect class="mark mark--internal"/)
    expect(markup).toMatch(/<circle class="mark mark--supplier"/)
    expect(markup).toMatch(/<circle class="mark mark--unidentified"/)
  })

  it('lists the members of an open row inside its card, each with its own mark', () => {
    const markup = sheet(draw(rossiEditore(), { openGroup: 'unidentified' }))
    expect(markup).toContain('stat.rossi-editore.it')
    expect(count(markup, /class="member/g)).toBe(2)
    // Two members and the row's own.
    expect(count(markup, /class="mark mark--unidentified"/g)).toBe(3)
    expect(tagOf(markup, 'unidentified')).toContain('node--open')
    expect(tagOf(markup, 'unidentified')).toContain('aria-expanded="true"')
  })

  it('folds the smallest purposes into one row that says how many places it holds', () => {
    const markup = sheet(draw(dorsaleOversized()))
    expect(count(markup, /class="node node--/g)).toBe(5)
    expect(markup).toContain(`>${STRINGS.destination.others}</text>`)
    const open = sheet(draw(dorsaleOversized(), { openGroup: 'others' }))
    expect(count(open, /class="member node--sub/g)).toBe(5)
    expect(open).toContain('>Group 05</text>')
    expect(open).toContain('>+21 more</text>')
  })

  it('gives a way in’s line the class of its colour, and the organisation’s lines a neutral one', () => {
    const markup = sheet(draw())
    for (const i of [0, 1, 2]) expect(markup).toContain(`class="path path--${i}"`)
    expect(count(markup, /class="path path--neutral"/g)).toBe(4)
  })

  it('draws one line and one arrowhead per way in and per row of destinations, on every fixture', () => {
    // The wrong answer: a line per way in per destination. The oversized project drew 63.
    for (const [name, make] of DORSALE_FIXTURES) {
      for (const view of VIEWS(make())) {
        const layout = computeLayout(make(), view)
        const markup = sheet(draw(make(), view))
        const rows = count(markup, /class="(door door--\d|fold door--\d|node node--\w+)[ "]/g) - count(markup, /class="door door--\d door--sub/g)
        expect(count(markup, /<g class="line/g), name).toBe(rows)
        expect(count(markup, /class="head head--/g), name).toBe(rows)
        expect(rows, name).toBe(layout.edges.length)
      }
    }
    expect(count(sheet(draw(dorsaleOversized())), /<g class="line/g)).toBe(15)
  })

  it('stops each line inside its arrowhead, whose tip is on the edge of the card it points at', () => {
    const layout = computeLayout(dorsaleUgly())
    const markup = sheet(draw(dorsaleUgly()))
    const lines = [...markup.matchAll(/<g class="line[^"]*">(.*?)<\/g>/g)].map((m) => m[1]!)
    expect(lines).toHaveLength(layout.edges.length)
    layout.edges.forEach((e, i) => {
      const target = layout.nodes.find((n) => n.id === e.to)!
      expect(e.x2).toBe(target.box.x)
      // The arrowhead: tip at the card's edge, level, six units long.
      expect(lines[i]).toContain(`d="M ${e.x2} ${e.y2} l -6 -3 v 6 z"`)
      // The line: level at both ends, both control points at the midpoint, ending inside the head.
      const main = [...lines[i]!.matchAll(/class="path [^"]*" d="([^"]*)"/g)].pop()![1]!
      const end = e.x2 - 5
      const mid = (e.x1 + end) / 2
      expect(main).toBe(e.y1 === e.y2 ? `M ${e.x1} ${e.y1} H ${end}` : `M ${e.x1} ${e.y1} C ${mid} ${e.y1} ${mid} ${e.y2} ${end} ${e.y2}`)
    })
  })

  it('keeps what a way in is connected to at full strength, under the pointer or selected, and dims the rest', () => {
    for (const markup of [draw(rossiEditore(), { selectedId: 'door:place:pl-2' }), draw(rossiEditore(), {}, 'door:place:pl-2')]) {
      for (const lit of ['door:place:pl-2', 'sg-2', 'controller', 'group:Marketing']) expect(tagOf(markup, lit), lit).not.toContain('dim')
      for (const dimmed of ['door:place:pl-3', 'sg-1', 'group:Delivery', 'own', 'unidentified']) expect(tagOf(markup, dimmed), dimmed).toContain('dim')
      // Its own line and the organisation's line to Marketing; the other five step back.
      expect(count(sheet(markup), /<g class="line">/g)).toBe(2)
      expect(count(sheet(markup), /<g class="line dim">/g)).toBe(5)
    }
    expect(tagOf(draw(rossiEditore(), { selectedId: 'door:place:pl-2' }), 'door:place:pl-2')).toContain('selected')
  })

  it('lets the pointer speak over the selection, and dims nothing while it is on the organisation', () => {
    const markup = draw(rossiEditore(), { selectedId: 'door:place:pl-2' }, 'group:Delivery')
    expect(tagOf(markup, 'door:place:pl-3')).not.toContain('dim')
    expect(tagOf(markup, 'door:place:pl-2')).toContain('dim')
    expect(draw(rossiEditore(), { selectedId: 'door:place:pl-2' }, 'controller')).not.toContain(' dim')
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
      find(t, 'more:group:Marketing')!.onClick!(ev())
      expect(log).toEqual(['select doorGroup:form', 'select group:Marketing'])
    })

    it('opens a row of destinations by its id, and closes it again', () => {
      const log: string[] = []
      find(tree({}, log), 'unidentified')!.onClick!(ev())
      expect(log).toEqual(['select unidentified', 'group unidentified'])
      const log2: string[] = []
      find(tree({ openGroup: 'unidentified' }, log2), 'unidentified')!.onKeyDown!(ev('Enter'))
      expect(log2).toEqual(['select unidentified', 'group null'])
    })

    it('reports the row the pointer is on, and that it has left', () => {
      const log: string[] = []
      const t = MapView({
        layout: computeLayout(dorsaleUgly()),
        selected: null,
        onSelect: () => {},
        openGroup: null,
        onToggleGroup: () => {},
        openKind: null,
        onToggleKind: () => {},
        onHover: (id) => log.push(`hover ${id}`),
      })
      const row = find(t, 'group:Sales') as unknown as { onMouseEnter: () => void; onMouseLeave: () => void }
      row.onMouseEnter()
      row.onMouseLeave()
      expect(log).toEqual(['hover group:Sales', 'hover null'])
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

// The sheet is rendered to static markup rather than into a DOM: every claim here is about what
// the map says and how it is marked up, which the markup answers on its own.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeLayout } from '../../src/core/layout'
import { MapView } from '../../src/renderer/components/MapView'
import { STRINGS } from '../../src/renderer/strings'
import { rossiEditore } from '../fixtures/rossiEditore'
import { emptyProject } from '../fixtures/projects'
import type { Project } from '../../src/core/types'

const SIZE = { width: 800, height: 500 }

function draw(project: Project = rossiEditore(), open: string | null = null): string {
  return renderToStaticMarkup(
    <MapView
      layout={computeLayout(project, SIZE, open)}
      selected={null}
      onSelect={() => {}}
      openGroup={open}
      onToggleGroup={() => {}}
    />,
  )
}

const count = (markup: string, pattern: RegExp): number => (markup.match(pattern) ?? []).length

describe('MapView', () => {
  it('draws an arrowhead on every line', () => {
    const markup = draw()
    const paths = count(markup, /class="path[^"]*"/g)
    expect(paths).toBeGreaterThan(0)
    expect(count(markup, /marker-end="url\(#arrow\)"/g)).toBe(paths)
  })

  it('draws a rectangle for every door', () => {
    // Anchored on the door group, not on .door-mark: the legend draws one of those too, and a
    // test that counts four would be counting the key as a door.
    expect(count(draw(), /class="door door--/g)).toBe(3)
  })

  it('says under each door whether it was discovered or declared', () => {
    const markup = draw()
    expect(count(markup, new RegExp(STRINGS.doorDeclared, 'g'))).toBe(2)
    expect(count(markup, new RegExp(STRINGS.doorDiscovered, 'g'))).toBe(1)
  })

  it('names the controller when a document did', () => {
    expect(draw()).toContain('Rossi Editore srl')
  })

  it('speaks for the controller when nothing has named one', () => {
    const p = emptyProject()
    p.places = [
      {
        id: 'pl-1',
        name: 'Mailchimp',
        kind: 'processor',
        purposeGroup: 'Marketing',
        holder: 'supplier',
        leavesEEA: true,
        sources: [],
        confidence: 'declared',
      },
    ]
    expect(draw(p)).toContain(STRINGS.yourOrganisation)
  })

  it('gives a path the class of its door colour', () => {
    const markup = draw()
    expect(markup).toContain('path path--0')
    expect(markup).toContain('path path--1')
  })

  it('draws an uncoloured path for a group no door reaches', () => {
    expect(draw()).toContain('path path--neutral')
  })

  it('states no EEA count anywhere on the sheet', () => {
    expect(draw()).not.toMatch(/outside the EEA/i)
  })

  it('draws the members of an open ring around it', () => {
    const markup = draw(rossiEditore(), 'Marketing')
    expect(markup).toContain('stat.rossi-editore.it')
    expect(count(markup, /class="node-member/g)).toBe(2)
  })

  it('leaves an open ring on the sheet as a boundary, so it can be closed again', () => {
    // Without this the only way out of an open ring is to click a different one, which is not a
    // way back to the closed reading at all.
    const markup = draw(rossiEditore(), 'Marketing')
    expect(count(markup, /class="node-boundary"/g)).toBe(1)
    expect(markup).toContain('node--opened')
  })

  it('draws no boundary when nothing is open', () => {
    expect(draw()).not.toContain('node-boundary')
  })

  it('says the map is empty rather than drawing an empty sheet', () => {
    expect(draw(emptyProject())).toContain(STRINGS.mapEmpty)
  })

  it('draws a +N more mark beyond the cap, highlighted when the selection is hidden', () => {
    const p = rossiEditore()
    for (let i = 0; i < 8; i++) {
      p.places.push({
        id: `cap-${i}`,
        name: `Vendor ${i}`,
        kind: 'processor',
        purposeGroup: 'Marketing',
        holder: 'supplier',
        leavesEEA: false,
        sources: [],
        confidence: 'declared',
      })
    }
    const hidden = p.places[p.places.length - 1]!.id
    const markup = renderToStaticMarkup(
      <MapView
        layout={computeLayout(p, SIZE, 'Marketing', hidden)}
        selected={hidden}
        onSelect={() => {}}
        openGroup="Marketing"
        onToggleGroup={() => {}}
      />,
    )
    expect(markup).toMatch(/class="more more--highlighted"[^>]*role="button"/)
    expect(markup).toMatch(/\+5 more/)
  })

  // No DOM in this suite, so the component is called as a function and its element tree walked:
  // MapView is hook-free and draws host elements only, which makes the handlers reachable.
  describe('the +N more marks', () => {
    type El = { props?: { className?: string; children?: unknown; [k: string]: unknown } }
    const collect = (node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
      if (Array.isArray(node)) node.forEach((n) => collect(n, out))
      const el = node as El
      if (el === null || typeof el !== 'object' || el.props === undefined) return out
      if (typeof el.props.className === 'string' && el.props.className.split(' ').includes('more')) out.push(el.props)
      return collect(el.props.children, out)
    }
    const many = (doors: number, members: number): Project => {
      const p = rossiEditore()
      p.places = p.places.filter((pl) => pl.kind !== 'collection' && pl.purposeGroup !== 'Marketing')
      for (let i = 0; i < members; i++) {
        p.places.push({ id: `cap-${i}`, name: `V${i}`, kind: 'processor', purposeGroup: 'Marketing', holder: 'supplier', leavesEEA: false, sources: [], confidence: 'declared' })
      }
      p.collectionPoints = Array.from({ length: doors }, (_, i) => ({ id: `cp-${i}`, page: `https://x.it/${i}`, fields: [], sources: [], confidence: 'observed' as const }))
      return p
    }
    const tree = (onSelect: (id: string | null) => void) =>
      MapView({
        layout: computeLayout(many(10, 9), SIZE, 'Marketing'),
        selected: null,
        onSelect,
        openGroup: 'Marketing',
        onToggleGroup: () => {},
      })
    const ringMark = (t: unknown) => {
      return collect(t).find((m) => m.onClick !== undefined) as Record<string, (ev: unknown) => void>
    }
    const ev = (key?: string) => ({ key, stopPropagation: () => {}, preventDefault: () => {} })

    it('selects the group on click, Enter and Space', () => {
      const picked: (string | null)[] = []
      const props = ringMark(tree((id) => picked.push(id)))
      props.onClick!(ev())
      props.onKeyDown!(ev('Enter'))
      props.onKeyDown!(ev(' '))
      props.onKeyDown!(ev('a'))
      expect(picked).toEqual(['group:Marketing', 'group:Marketing', 'group:Marketing'])
    })

    it('leaves the door mark inert and out of the tab order', () => {
      const marks = collect(tree(() => {}))
      expect(marks).toHaveLength(2)
      const inert = marks.filter((m) => m.onClick === undefined)
      expect(inert).toHaveLength(1)
      expect(inert[0]!.tabIndex).toBeUndefined()
      expect(inert[0]!.role).toBeUndefined()
    })
  })
})

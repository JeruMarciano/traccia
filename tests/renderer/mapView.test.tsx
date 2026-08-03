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

  it('draws the members of an open ring in place of it', () => {
    const markup = draw(rossiEditore(), 'Marketing')
    expect(markup).toContain('stat.rossi-editore.it')
    expect(count(markup, /class="node-member/g)).toBe(2)
  })

  it('says the map is empty rather than drawing an empty sheet', () => {
    expect(draw(emptyProject())).toContain(STRINGS.mapEmpty)
  })
})

import { describe, it, expect } from 'vitest'
import { answerByHand } from '../../src/core/answers'
import { rossiEditore } from '../fixtures/rossiEditore'

const placeIn = (p: ReturnType<typeof rossiEditore>, id: string) =>
  p.places.find((pl) => pl.id === id)

describe('answerByHand', () => {
  it('records a retention somebody typed', () => {
    const after = answerByHand(rossiEditore(), 'pl-7', 'retention', '24 months')
    expect(placeIn(after, 'pl-7')?.retention).toBe('24 months')
  })

  it('marks the field as entered by hand, so the panel can say so', () => {
    // Without this the fact would inherit the place's attribution and a typed answer would
    // appear over a document's name. The panel's whole claim is that every fact says who said
    // it, and this is what keeps that true once a person can answer one.
    const after = answerByHand(rossiEditore(), 'pl-4', 'retention', 'six weeks')
    expect(placeIn(after, 'pl-4')?.handEntered).toEqual(['retention'])
  })

  it('answers whether data leaves the EEA', () => {
    const after = answerByHand(rossiEditore(), 'pl-7', 'leavesEEA', true)
    expect(placeIn(after, 'pl-7')?.leavesEEA).toBe(true)
    expect(placeIn(after, 'pl-7')?.handEntered).toEqual(['leavesEEA'])

    const no = answerByHand(rossiEditore(), 'pl-7', 'leavesEEA', false)
    expect(placeIn(no, 'pl-7')?.leavesEEA).toBe(false)
  })

  it('does not list a field twice when it is answered again', () => {
    const once = answerByHand(rossiEditore(), 'pl-7', 'retention', 'a year')
    const twice = answerByHand(once, 'pl-7', 'retention', 'two years')
    expect(placeIn(twice, 'pl-7')?.handEntered).toEqual(['retention'])
    expect(placeIn(twice, 'pl-7')?.retention).toBe('two years')
  })

  it('keeps an earlier hand-entered field when a second one is answered', () => {
    const one = answerByHand(rossiEditore(), 'pl-7', 'retention', 'a year')
    const two = answerByHand(one, 'pl-7', 'leavesEEA', false)
    expect(placeIn(two, 'pl-7')?.handEntered).toEqual(['retention', 'leavesEEA'])
  })

  it('treats a blank answer as no answer', () => {
    // The wrong answer: storing '' and marking the field answered, which turns a question the
    // map was honestly asking into a fact that says nothing.
    const before = rossiEditore()
    expect(answerByHand(before, 'pl-7', 'retention', '   ')).toEqual(before)
  })

  it('trims what was typed', () => {
    const after = answerByHand(rossiEditore(), 'pl-7', 'retention', '  24 months  ')
    expect(placeIn(after, 'pl-7')?.retention).toBe('24 months')
  })

  it('leaves the project untouched for an id that names nothing', () => {
    const before = rossiEditore()
    expect(answerByHand(before, 'pl-999', 'retention', 'a year')).toEqual(before)
  })

  it('does not mutate the project it was given', () => {
    const before = rossiEditore()
    answerByHand(before, 'pl-7', 'retention', 'a year')
    expect(placeIn(before, 'pl-7')?.retention).toBeUndefined()
  })
})

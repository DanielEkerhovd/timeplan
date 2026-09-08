import { describe, expect, it } from 'vitest'
import { coversSlot, planToggle, slotHours } from '../slots'
import { weekId, weekStartFromId, daysOfWeek, toDateKey } from '../week'
import type { TeamSlot } from '../types'

const slot = (id: string, start: number, end: number): TeamSlot => ({
  id, team_id: 't', day_type: 'weekday', start_hour: start, end_hour: end, sort: start,
})
const s18 = slot('a', 18, 21)
const s19 = slot('b', 19, 22)
const s20 = slot('c', 20, 23)
const day = [s18, s19, s20]

describe('planToggle', () => {
  it('turns a slot on by adding its hours', () => {
    expect(planToggle(undefined, s19, day)).toEqual({ add: [19, 20, 21], remove: [] })
  })
  it('only adds the hours that are missing', () => {
    expect(planToggle(new Set([19, 20, 21]), s18, day)).toEqual({ add: [18], remove: [] })
  })
  it('turning off 19–22 keeps hours still covered by 18–21', () => {
    expect(planToggle(new Set([18, 19, 20, 21]), s19, day)).toEqual({ add: [], remove: [21] })
  })
  it('turning off the only selected slot removes all of it', () => {
    expect(planToggle(new Set([19, 20, 21]), s19, day)).toEqual({ add: [], remove: [19, 20, 21] })
  })
  it('coversSlot needs every hour', () => {
    expect(coversSlot(new Set([19, 20]), s19)).toBe(false)
    expect(coversSlot(new Set([19, 20, 21, 22]), s19)).toBe(true)
    expect(slotHours(s20)).toEqual([20, 21, 22])
  })
})

describe('week helpers', () => {
  it('round-trips ISO week ids', () => {
    const monday = weekStartFromId('2026-W37')
    expect(toDateKey(monday)).toBe('2026-09-07')
    expect(weekId(monday)).toBe('2026-W37')
    expect(daysOfWeek(monday).map((d) => d.key)[6]).toBe('2026-09-13')
  })
  it('handles week 1 and week 53 correctly', () => {
    expect(toDateKey(weekStartFromId('2027-W01'))).toBe('2027-01-04')
    expect(toDateKey(weekStartFromId('2026-W53'))).toBe('2026-12-28')
    expect(weekId(new Date(2027, 0, 1))).toBe('2026-W53')
  })
  it('falls back to the current week on garbage', () => {
    expect(weekId(weekStartFromId('nope'))).toBe(weekId(new Date()))
  })
})

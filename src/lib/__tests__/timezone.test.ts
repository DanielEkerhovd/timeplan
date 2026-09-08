import { describe, expect, it } from 'vitest'
import { hoursAhead, yourTime, zoneNote, zoneOffsetMinutes } from '../timezone'

const winter = new Date('2026-01-12T12:00:00Z')
const summer = new Date('2026-07-13T12:00:00Z')

describe('zoneOffsetMinutes', () => {
  it('følger sommertid', () => {
    expect(zoneOffsetMinutes('Europe/Oslo', winter)).toBe(60)
    expect(zoneOffsetMinutes('Europe/Oslo', summer)).toBe(120)
  })
  it('takler halve timer', () => {
    expect(zoneOffsetMinutes('Asia/Kolkata', winter)).toBe(330)
  })
  it('gir null for ukjent sone', () => {
    expect(zoneOffsetMinutes('Ingen/Sone', winter)).toBe(null)
  })
})

describe('hoursAhead', () => {
  it('er null i samme sone', () => {
    expect(hoursAhead('Europe/Oslo', winter, 'Europe/Oslo')).toBe(null)
  })
  it('er null når to ulike soner viser samme klokke', () => {
    expect(hoursAhead('Europe/Oslo', winter, 'Europe/Berlin')).toBe(null)
  })
  it('teller timene laget ligger foran', () => {
    expect(hoursAhead('Europe/Oslo', winter, 'Europe/London')).toBe(1)
    expect(hoursAhead('Europe/Oslo', winter, 'America/New_York')).toBe(6)
  })
  it('blir negativt når laget ligger bak', () => {
    expect(hoursAhead('Europe/London', winter, 'Europe/Oslo')).toBe(-1)
  })
})

describe('yourTime', () => {
  it('trekker fra forskjellen', () => {
    expect(yourTime(20, 1)).toBe('19:00')
    expect(yourTime(20, -2)).toBe('22:00')
  })
  it('går rundt døgnet', () => {
    expect(yourTime(1, 3)).toBe('22:00')
    expect(yourTime(23, -2)).toBe('01:00')
  })
  it('takler halve timer', () => {
    expect(yourTime(20, 4.5)).toBe('15:30')
  })
})

describe('zoneNote', () => {
  it('sier ingenting i samme sone', () => {
    expect(zoneNote('Europe/Oslo', winter, 'Europe/Oslo')).toBe(null)
  })
  it('forklarer forskjellen med et eksempel', () => {
    expect(zoneNote('Europe/Oslo', winter, 'Europe/London')).toBe(
      'Times are in Europe/Oslo, 1 hour ahead of you — 20:00 here is 19:00 for you.',
    )
    expect(zoneNote('Europe/London', winter, 'Europe/Oslo')).toBe(
      'Times are in Europe/London, 1 hour behind you — 20:00 here is 21:00 for you.',
    )
  })
})

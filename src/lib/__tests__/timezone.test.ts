import { describe, expect, it } from 'vitest'
import { hoursAhead, yourTime, zoneHour, zoneNote, zoneOffsetMinutes, zoneSlotLabel, zoneSlotShort } from '../timezone'

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

describe('zoneSlotShort', () => {
  it('dropper minuttene når de er null', () => {
    expect(zoneSlotShort(19, 22, 0, 1)).toBe('19–22')
    expect(zoneSlotShort(9, 12, 0, 1)).toBe('09–12')
  })
  it('beholder minuttene når sonen skyver en halv time', () => {
    // 19:00 hos laget er 14:30 i India (5,5 timer bak).
    expect(zoneSlotShort(19, 22, 5.5, 1)).toBe('13:30–16:30')
  })
  it('tar med dagen og +1 som den lange etiketten', () => {
    expect(zoneSlotShort(20, 23, -8, 1)).toBe('Tue 04–07')
    expect(zoneSlotShort(18, 22, -5, 1)).toBe('23–03 +1')
  })
})

describe('zoneSlotLabel', () => {
  it('lar lagets tid stå når du er i samme sone', () => {
    expect(zoneSlotLabel(19, 22, 0, 1)).toBe('19:00 - 22:00')
  })
  it('trekker fra forskjellen', () => {
    expect(zoneSlotLabel(19, 22, 6, 1)).toBe('13:00 - 16:00')
  })
  it('setter dagen foran når blokka havner på et annet døgn', () => {
    // Laget planlegger mandag 20-23. I Tokyo er det tirsdag natt.
    expect(zoneSlotLabel(20, 23, -8, 1)).toBe('Tue 04:00 - 07:00')
    expect(zoneSlotLabel(1, 3, 6, 3)).toBe('Tue 19:00 - 21:00')
  })
  it('merker slutten når blokka krysser midnatt hos deg', () => {
    // Laget: 18-22. Fem timer bak laget: 23:00 samme dag til 03:00 dagen etter.
    expect(zoneSlotLabel(18, 22, -5, 1)).toBe('23:00 - 03:00 +1')
  })
  it('sier det uten dagsnavn når vi ikke vet hvilken dag det er', () => {
    expect(zoneSlotLabel(20, 23, -8)).toBe('next day 04:00 - 07:00')
    expect(zoneSlotLabel(1, 3, 6)).toBe('day before 19:00 - 21:00')
  })
})

describe('zoneHour', () => {
  it('går rundt døgnet', () => {
    expect(zoneHour(1, 3)).toBe(22)
    expect(zoneHour(23, -2)).toBe(1)
  })
})

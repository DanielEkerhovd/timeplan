// Dates in a team's time zone, with nothing but Intl.
//
// Hours in the database are numbers in the team's zone (0016). To show them on
// Discord as <t:...> we need the instant they point at, and to decide "has
// Sunday 20:00 passed yet" we need the local clock. Both live here.

function parts(d: Date, tz: string): Record<string, number> {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const out: Record<string, number> = {}
  for (const p of f.formatToParts(d)) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out
}

/** Offset of `tz` from UTC at instant `d`, in minutes. */
function offsetAt(d: Date, tz: string): number {
  const p = parts(d, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - d.getTime()) / 60_000)
}

/**
 * The instant for `YYYY-MM-DD` at `hour:minute` on the team's clock. `hour` may
 * carry half steps (19.5 = 19:30); the fraction is folded into the minutes.
 * Two passes for DST edges.
 */
export function localToInstant(dateKey: string, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  const whole = Math.floor(hour)
  const guess = Date.UTC(y, m - 1, d, whole, minute + Math.round((hour - whole) * 60))
  let t = guess - offsetAt(new Date(guess), tz) * 60_000
  t = guess - offsetAt(new Date(t), tz) * 60_000
  return new Date(t)
}

export const unix = (d: Date) => Math.floor(d.getTime() / 1000)

export interface LocalNow {
  dateKey: string
  /** 1 = Monday … 7 = Sunday, ISO style, like the database. */
  isodow: number
  /** Minutes since local midnight. */
  minutes: number
}

export function localNow(tz: string, at = new Date()): LocalNow {
  const p = parts(at, tz)
  const dateKey = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
  return { dateKey, isodow: dow === 0 ? 7 : dow, minutes: p.hour * 60 + p.minute }
}

export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Monday of the week that contains `dateKey`. */
export function mondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7
  return addDays(dateKey, -(dow - 1))
}

export function isoWeek(mondayKey: string): { year: number; week: number } {
  const d = new Date(mondayKey + 'T00:00:00Z')
  const thursday = new Date(d.getTime() + 3 * 86_400_000)
  const year = thursday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const week1Monday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86_400_000)
  return { year, week: Math.round((d.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1 }
}

/** "HH:MM" or "HH:MM:SS" from Postgres → minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function weekRangeLabel(mondayKey: string): string {
  const a = new Date(mondayKey + 'T00:00:00Z')
  const b = new Date(a.getTime() + 6 * 86_400_000)
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
    : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
}

export function dayName(dateKey: string): string {
  const dow = new Date(dateKey + 'T00:00:00Z').getUTCDay() || 7
  return DAYS[dow - 1]
}

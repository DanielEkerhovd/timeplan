// Shared between the `share` (link) and `share-image` (picture) functions.

export interface SharePerson {
  name: string
  avatar: string | null
}
export interface ShareEvent {
  title: string
  opponent: string | null
  color: string
  start_hour: number
  end_hour: number
  people: SharePerson[]
}
export interface ShareDay {
  date: string
  events: ShareEvent[]
  free: { start_hour: number; end_hour: number }[]
}
export interface ShareWeek {
  team: { name: string; timezone: string }
  week_start: string
  members: number
  days: ShareDay[]
}

/** Monday (YYYY-MM-DD) for a '2026-W37' id, or for this week when the id is missing/bad. */
export function mondayFromWeekId(id: string | null): string {
  const m = id?.match(/^(\d{4})-W(\d{2})$/)
  let d: Date
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 53) {
    // 4 January is always in ISO week 1.
    const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4))
    const dow = jan4.getUTCDay() || 7
    d = new Date(jan4.getTime() - (dow - 1) * 86_400_000 + (Number(m[2]) - 1) * 7 * 86_400_000)
  } else {
    const now = new Date()
    const dow = now.getUTCDay() || 7
    d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dow - 1)))
  }
  return d.toISOString().slice(0, 10)
}

export function weekId(mondayKey: string): string {
  const d = new Date(mondayKey + 'T00:00:00Z')
  const thursday = new Date(d.getTime() + 3 * 86_400_000)
  const year = thursday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4dow = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4.getTime() - (jan4dow - 1) * 86_400_000)
  const week = Math.round((d.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Calls the public share_week() function through PostgREST with the anon key. */
export async function fetchShareWeek(slug: string, monday: string): Promise<ShareWeek | null> {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_ANON_KEY')!
  const res = await fetch(`${url}/rest/v1/rpc/share_week`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, week_start: monday }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data ?? null
}

export const hour = (h: number) => `${String(h).padStart(2, '0')}:00`
export const range = (a: number, b: number) => `${hour(a)} - ${hour(b)}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function formatRange(mondayKey: string): string {
  const a = new Date(mondayKey + 'T00:00:00Z')
  const b = new Date(a.getTime() + 6 * 86_400_000)
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
    : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
}

export function dayNumber(dateKey: string): number {
  return Number(dateKey.slice(8, 10))
}

/** Same palette as src/lib/colors.ts. */
export const palette: Record<string, { soft: string; ink: string; sub: string }> = {
  yellow: { soft: '#FFF6DA', ink: '#6B4E00', sub: '#8A6A10' },
  green: { soft: '#E1F1E5', ink: '#2F6B45', sub: '#4E8A63' },
  coral: { soft: '#FBE3D6', ink: '#8A3F1C', sub: '#A65C3A' },
  purple: { soft: '#E8E1F5', ink: '#4E3A7A', sub: '#7A66A8' },
  blue: { soft: '#E3ECF7', ink: '#2C4F73', sub: '#4F6E93' },
  teal: { soft: '#DDF1EE', ink: '#1F5F58', sub: '#3F8078' },
  pink: { soft: '#FBE2EC', ink: '#86304F', sub: '#A6506F' },
  grey: { soft: '#ECEAE5', ink: '#4E4B46', sub: '#7A7368' },
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

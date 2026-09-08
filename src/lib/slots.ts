// Pure helpers for time slots and free hours. No Supabase here, so they are easy to unit test.
import type { Availability, TeamSlot } from './types'

/** hours[dateKey][userId] = set of free hours that day. */
export type HoursByDayUser = Record<string, Record<string, Set<number>>>

export function indexHours(rows: Pick<Availability, 'user_id' | 'date' | 'hour'>[]): HoursByDayUser {
  const out: HoursByDayUser = {}
  for (const r of rows) {
    const byUser = (out[r.date] ??= {})
    const set = (byUser[r.user_id] ??= new Set<number>())
    set.add(r.hour)
  }
  return out
}

export function slotHours(slot: Pick<TeamSlot, 'start_hour' | 'end_hour'>): number[] {
  return Array.from({ length: slot.end_hour - slot.start_hour }, (_, i) => slot.start_hour + i)
}

/** True when every hour in the slot is in the set. */
export function coversSlot(hours: Set<number> | undefined, slot: Pick<TeamSlot, 'start_hour' | 'end_hour'>): boolean {
  if (!hours) return false
  return slotHours(slot).every((h) => hours.has(h))
}

/**
 * Work out which hours to add or remove when a slot button is toggled.
 * Turning a slot off only removes hours that no other selected slot on that day still covers,
 * so 18–21 + 19–22 minus 19–22 leaves 18–21 intact.
 */
export function planToggle(
  current: Set<number> | undefined,
  slot: TeamSlot,
  daySlots: TeamSlot[],
): { add: number[]; remove: number[] } {
  const hours = current ?? new Set<number>()
  if (!coversSlot(hours, slot)) {
    return { add: slotHours(slot).filter((h) => !hours.has(h)), remove: [] }
  }
  const keep = new Set<number>()
  for (const other of daySlots) {
    if (other.id === slot.id) continue
    if (coversSlot(hours, other)) slotHours(other).forEach((h) => keep.add(h))
  }
  return { add: [], remove: slotHours(slot).filter((h) => !keep.has(h)) }
}


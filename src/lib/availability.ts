import { supabase } from './supabase'
import { indexHours, type HoursByDayUser } from './slots'
import type { Availability, TeamSlot } from './types'

export { coversSlot, indexHours, planToggle, slotHours, type HoursByDayUser } from './slots'

export async function fetchTeamSlots(teamId: string): Promise<TeamSlot[]> {
  const { data, error } = await supabase
    .from('team_slots')
    .select('*')
    .eq('team_id', teamId)
    // Earliest start first, everywhere the slots are listed.
    .order('start_hour')
    .order('end_hour')
  if (error) throw error
  return (data ?? []) as TeamSlot[]
}

export async function fetchAvailability(teamId: string, fromKey: string, toKey: string): Promise<HoursByDayUser> {
  const { data, error } = await supabase
    .from('availability')
    .select('user_id, date, hour')
    .eq('team_id', teamId)
    .gte('date', fromKey)
    .lte('date', toKey)
  if (error) throw error
  return indexHours((data ?? []) as Pick<Availability, 'user_id' | 'date' | 'hour'>[])
}

export async function applyToggle(teamId: string, userId: string, dateKey: string, plan: { add: number[]; remove: number[] }) {
  if (plan.add.length > 0) {
    // user_id is set by the database (default auth.uid()); sending it would be refused.
    const { error } = await supabase
      .from('availability')
      .upsert(
        plan.add.map((hour) => ({ team_id: teamId, date: dateKey, hour })),
        { onConflict: 'team_id,user_id,date,hour', ignoreDuplicates: true },
      )
    if (error) throw error
  }
  if (plan.remove.length > 0) {
    const { error } = await supabase
      .from('availability')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('date', dateKey)
      .in('hour', plan.remove)
    if (error) throw error
  }
}

/** Live updates for one team's availability. Calls onChange on every insert/delete; the caller refetches. */
export function subscribeAvailability(teamId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`availability:${teamId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'availability', filter: `team_id=eq.${teamId}` },
      () => onChange(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'events', filter: `team_id=eq.${teamId}` },
      () => onChange(),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_responses' }, () => onChange())
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}

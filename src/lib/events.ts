import { supabase } from './supabase'
import type { ResponseStatus, TeamEvent } from './types'

export interface EventWithResponses extends TeamEvent {
  responses: { user_id: string; status: ResponseStatus }[]
}

export async function fetchEvents(teamId: string, fromKey: string, toKey: string): Promise<EventWithResponses[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*, responses:event_responses(user_id, status)')
    .eq('team_id', teamId)
    .gte('date', fromKey)
    .lte('date', toKey)
    .order('date')
    .order('start_hour')
  if (error) throw error
  return (data ?? []) as unknown as EventWithResponses[]
}

export async function respondToEvent(eventId: string, status: ResponseStatus) {
  // Update first, insert if there was nothing to update. Not an upsert: that would try to
  // SET event_id too, and users are only allowed to update the status column.
  // user_id is filled in by the database on insert.
  const { data, error } = await supabase
    .from('event_responses')
    .update({ status })
    .eq('event_id', eventId)
    .select('event_id')
  if (error) throw error
  if (data && data.length > 0) return
  const { error: insertError } = await supabase.from('event_responses').insert({ event_id: eventId, status })
  if (insertError) throw insertError
}

export const eventTypeLabel: Record<TeamEvent['type'], string> = {
  scrim: 'Scrim',
  practice: 'Practice',
  match: 'Match',
  other: 'Event',
}

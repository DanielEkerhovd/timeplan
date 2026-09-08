import { supabase } from './supabase'
import { palette, type Palette } from './colors'
import type { ActivityColor, ActivityType, ResponseStatus, TeamEvent } from './types'

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

export async function fetchActivityTypes(teamId: string): Promise<ActivityType[]> {
  const { data, error } = await supabase
    .from('activity_types')
    .select('*')
    .eq('team_id', teamId)
    .order('sort')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as ActivityType[]
}

/** Join = a "coming" response. Update first, insert if there was nothing to update (users cannot SET event_id). */
export async function joinEvent(eventId: string) {
  const { data, error } = await supabase
    .from('event_responses')
    .update({ status: 'coming' })
    .eq('event_id', eventId)
    .select('event_id')
  if (error) throw error
  if (data && data.length > 0) return
  const { error: insertError } = await supabase.from('event_responses').insert({ event_id: eventId, status: 'coming' })
  if (insertError) throw insertError
}

/** Leave = remove your own response. RLS makes sure only your row can go. */
export async function leaveEvent(eventId: string) {
  const { error } = await supabase.from('event_responses').delete().eq('event_id', eventId)
  if (error) throw error
}

export function hasJoined(event: EventWithResponses, userId: string): boolean {
  return event.responses.some((r) => r.user_id === userId && r.status === 'coming')
}

export function joinedUserIds(event: EventWithResponses): string[] {
  return event.responses.filter((r) => r.status === 'coming').map((r) => r.user_id)
}

/** What an activity is called: the type's name, or the custom title. */
export function eventTitle(event: TeamEvent, types: ActivityType[]): string {
  if (event.type_id) return types.find((t) => t.id === event.type_id)?.name ?? 'Activity'
  return event.title ?? 'Activity'
}

/** "Scrim · Nordic Wolves" — title plus the optional line. */
export function eventLabel(event: TeamEvent, types: ActivityType[]): string {
  const title = eventTitle(event, types)
  return event.opponent ? `${title} · ${event.opponent}` : title
}

export function eventColor(event: TeamEvent, types: ActivityType[]): ActivityColor {
  if (event.type_id) return types.find((t) => t.id === event.type_id)?.color ?? 'grey'
  return event.color ?? 'grey'
}

export function eventPalette(event: TeamEvent, types: ActivityType[]): Palette {
  return palette[eventColor(event, types)]
}

export interface EventInput {
  date: string
  start_hour: number
  end_hour: number
  type_id: string | null
  title: string | null
  color: ActivityColor | null
  opponent: string | null
  note: string | null
}

export async function createEvent(teamId: string, input: EventInput): Promise<void> {
  // created_by is filled in by the database.
  const { error } = await supabase.from('events').insert({ team_id: teamId, ...input })
  if (error) throw error
}

export async function updateEvent(eventId: string, input: EventInput): Promise<void> {
  const { error } = await supabase.from('events').update(input).eq('id', eventId)
  if (error) throw error
}

export async function deleteEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from('events').delete().eq('id', eventId)
  if (error) throw error
}

/** True when two activities share at least one hour on the same day. */
export function overlaps(a: Pick<TeamEvent, 'date' | 'start_hour' | 'end_hour'>, b: Pick<TeamEvent, 'date' | 'start_hour' | 'end_hour'>): boolean {
  return a.date === b.date && a.start_hour < b.end_hour && b.start_hour < a.end_hour
}

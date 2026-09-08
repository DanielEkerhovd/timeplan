// Speiler tabellene i supabase/migrations/0001_init.sql.
// Når skjemaet vokser: `supabase gen types typescript --local > src/lib/database.types.ts`
// og bytt til de genererte typene.

export type MemberRole = 'owner' | 'coach' | 'player'

export const roleLabel: Record<MemberRole, string> = {
  owner: 'Owner',
  coach: 'Coach',
  player: 'Player',
}

/** Eier og trener kan redigere planen. */
export const canEdit = (role: MemberRole) => role === 'owner' || role === 'coach'
export type DayType = 'weekday' | 'weekend'
export type EventType = 'scrim' | 'practice' | 'match' | 'other'
export type ResponseStatus = 'coming' | 'not_coming'

export interface Team {
  id: string
  name: string
  timezone: string
  share_slug: string
  share_enabled: boolean
  created_at: string
}

export interface Member {
  team_id: string
  user_id: string
  role: MemberRole
  position: string | null
  joined_at: string
}

export interface Profile {
  user_id: string
  display_name: string
  avatar_url: string | null
}

export interface TeamSlot {
  id: string
  team_id: string
  day_type: DayType
  start_hour: number
  end_hour: number
  sort: number
}

export interface Availability {
  team_id: string
  user_id: string
  date: string // YYYY-MM-DD
  hour: number
}

export interface TeamEvent {
  id: string
  team_id: string
  date: string
  start_hour: number
  end_hour: number
  type: EventType
  title: string
  opponent: string | null
  note: string | null
  created_by: string | null
  updated_at: string
}

export interface SlotCount {
  team_id: string
  date: string
  start_hour: number
  end_hour: number
  sort: number
  available_count: number
  user_ids: string[]
}

/** Feilkoder databasen kaster (raise exception '<kode>'). */
export const dbErrors = {
  not_authenticated: 'You need to sign in first.',
  not_owner: 'Only the owner can do this.',
  not_editor: 'Only the owner and coaches can do this.',
  cannot_remove_owner: 'The owner cannot be removed. Transfer ownership first.',
  owner_cannot_leave: 'Transfer ownership to someone else before leaving the team.',
  use_transfer_ownership: 'Use "Transfer ownership" to change the owner.',
  not_a_member: 'That person is not on the team.',
  team_limit: 'You cannot create more than 3 teams.',
  team_full: 'The team is full (max 15).',
  too_many_invites: 'The team already has 5 active invite codes.',
  invite_too_long: 'An invite code can last at most 30 days.',
  too_many_attempts: 'Too many failed attempts. Try again in an hour.',
  too_many_events: 'Max 4 activities per day.',
  date_out_of_range: 'The date must be within one year.',
  name_mismatch: 'The name does not match.',
  use_leave_team: 'Use "Leave team" to remove yourself.',
} as const

/** Gjør en Supabase/Postgres-feil om til en setning folk forstår. */
export function friendlyError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err)
  for (const [code, text] of Object.entries(dbErrors)) {
    if (msg.includes(code)) return text
  }
  if (msg.includes('row-level security')) return 'You do not have access to this.'
  if (msg.includes('permission denied')) return 'You do not have access to this.'
  return 'Something went wrong. Please try again.'
}

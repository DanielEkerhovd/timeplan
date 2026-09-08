// Speiler tabellene i supabase/migrations/0001_init.sql.
// Når skjemaet vokser: `supabase gen types typescript --local > src/lib/database.types.ts`
// og bytt til de genererte typene.

export type MemberRole = 'owner' | 'coach' | 'player'

export const roleLabel: Record<MemberRole, string> = {
  owner: 'Eier',
  coach: 'Trener',
  player: 'Spiller',
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
  not_authenticated: 'Du må logge inn først.',
  not_owner: 'Bare eieren kan gjøre dette.',
  not_editor: 'Bare eier og trener kan gjøre dette.',
  cannot_remove_owner: 'Eieren kan ikke fjernes. Overfør eierskapet først.',
  owner_cannot_leave: 'Gi eierskapet til noen andre før du forlater laget.',
  use_transfer_ownership: 'Bruk «Overfør eierskap» for å bytte eier.',
  not_a_member: 'Personen er ikke med på laget.',
  team_limit: 'Du kan ikke lage flere enn 3 lag.',
  team_full: 'Laget er fullt (maks 15).',
  too_many_invites: 'Laget har allerede 5 aktive koder.',
  invite_too_long: 'En kode kan vare maks 30 dager.',
  too_many_attempts: 'For mange feil forsøk. Prøv igjen om en time.',
  too_many_events: 'Maks 4 aktiviteter per dag.',
  date_out_of_range: 'Datoen må være innenfor ett år.',
  name_mismatch: 'Navnet stemmer ikke.',
  use_leave_team: 'Bruk «Forlat laget» for å fjerne deg selv.',
} as const

/** Gjør en Supabase/Postgres-feil om til en setning folk forstår. */
export function friendlyError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err)
  for (const [code, text] of Object.entries(dbErrors)) {
    if (msg.includes(code)) return text
  }
  if (msg.includes('row-level security')) return 'Du har ikke tilgang til dette.'
  if (msg.includes('permission denied')) return 'Du har ikke tilgang til dette.'
  return 'Noe gikk galt. Prøv igjen.'
}

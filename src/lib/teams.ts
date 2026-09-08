import { supabase } from './supabase'
import type { Member, Team } from './types'

export interface MyTeam extends Team {
  role: Member['role']
}

/** Lagene du er med i. RLS gjør at dette bare kan returnere dine egne. */
export async function fetchMyTeams(userId: string): Promise<MyTeam[]> {
  const { data, error } = await supabase
    .from('members')
    .select('role, teams(*)')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? [])
    .map((row) => {
      const team = row.teams as unknown as Team | null
      return team ? { ...team, role: row.role as Member['role'] } : null
    })
    .filter((t): t is MyTeam => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
}

export async function createTeam(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_team', { team_name: name })
  if (error) throw error
  return data as string
}

/** Returnerer lagets id, eller null hvis koden er feil, utløpt eller oppbrukt. */
export async function joinTeam(code: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('join_team', { invite_code: code })
  if (error) throw error
  return (data as string | null) ?? null
}

const ACTIVE_KEY = 'timeplan.activeTeam'

export function getActiveTeamId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

export function setActiveTeamId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // privat modus o.l. – ikke kritisk
  }
}

import { appBase } from './share'
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
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** `roles` er navnene i rekkefølge. Tom liste = laget bruker ikke roller. */
export async function createTeam(name: string, roles: string[] = []): Promise<string> {
  const { data, error } = await supabase.rpc('create_team', { team_name: name, roles })
  if (error) throw error
  return data as string
}

/** Returnerer lagets id, eller null hvis koden er feil, utløpt eller oppbrukt. */
export async function joinTeam(code: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('join_team', { invite_code: code })
  if (error) throw error
  return (data as string | null) ?? null
}

/** Koden slik den ser ut i databasen: store bokstaver og tall, ingen mellomrom. */
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase()
}

export function isInviteCode(code: string): boolean {
  return /^[A-Z0-9]{6,20}$/.test(code)
}

/**
 * Lenka du limer i Discord. Koden ligger i stien, ikke som ?code=, fordi Supabase
 * bruker akkurat det navnet til OAuth-koden sin når du kommer tilbake fra Discord.
 */
export function inviteLink(code: string): string {
  return `${appBase()}/join/${code}`
}

const ACTIVE_KEY = 'timeplan.activeTeam'
const PENDING_INVITE_KEY = 'timeplan.pendingInvite'

/**
 * Koden tas vare på over Discord-runden. Normalt kommer du tilbake til /join/<kode> og
 * trenger den ikke, men står ikke stien i Supabase sin Redirect URL-liste havner du på
 * forsiden i stedet — da fyller /new-team inn koden herfra så den ikke er tapt.
 */
export function setPendingInvite(code: string | null) {
  try {
    if (code) localStorage.setItem(PENDING_INVITE_KEY, code)
    else localStorage.removeItem(PENDING_INVITE_KEY)
  } catch {
    // privat modus o.l. – ikke kritisk
  }
}

export function takePendingInvite(): string | null {
  try {
    const code = localStorage.getItem(PENDING_INVITE_KEY)
    localStorage.removeItem(PENDING_INVITE_KEY)
    return code
  } catch {
    return null
  }
}

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

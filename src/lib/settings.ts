import { supabase } from './supabase'
import type { ActivityColor, ActivityType, DayType, Invite, MemberWithProfile, TeamRole, TeamSlot } from './types'

// ---------- members ----------

export async function fetchMembers(teamId: string): Promise<MemberWithProfile[]> {
  const { data, error } = await supabase.from('members').select('*, profile:profiles(*)').eq('team_id', teamId)
  if (error) throw error
  const rows = (data ?? []) as unknown as MemberWithProfile[]
  // Stable order (who joined first) so rows do not jump around while you edit positions.
  rows.sort((a, b) => a.joined_at.localeCompare(b.joined_at))
  return rows
}

/** Your own display name in every team. Empty = back to the Discord name. */
export async function setDisplayName(name: string | null) {
  const { error } = await supabase.rpc('set_display_name', { new_name: name })
  if (error) throw error
}

/**
 * Henter Discord-navnet på nytt. Metadataen vi lagret ble bare lest ved innlogging,
 * så bytter du visningsnavn på Discord står vårt gamle navn igjen til tokenet fornyes.
 * Returnerer navnet Discord kjenner deg som nå.
 */
export async function refreshDiscordName(): Promise<string | null> {
  const { data, error } = await supabase.rpc('refresh_discord_name')
  if (error) throw error
  return (data as string | null) ?? null
}

/** Your own timezone, in every team. Empty = we stop guessing and show nothing. */
export async function setTimezone(userId: string, timezone: string | null) {
  const { error } = await supabase.from('profiles').update({ timezone }).eq('user_id', userId)
  if (error) throw error
}

// ---------- roller ----------

/** Lagets egen liste, i den rekkefølgen laget har satt. */
export async function fetchTeamRoles(teamId: string): Promise<TeamRole[]> {
  const { data, error } = await supabase.from('team_roles').select('*').eq('team_id', teamId).order('sort').order('name')
  if (error) throw error
  return (data ?? []) as TeamRole[]
}

export async function addTeamRole(teamId: string, name: string, sort: number) {
  const { error } = await supabase.from('team_roles').insert({ team_id: teamId, name: name.trim(), sort })
  if (error) throw error
}

export async function renameTeamRole(id: string, name: string) {
  const { error } = await supabase.from('team_roles').update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function deleteTeamRole(id: string) {
  const { error } = await supabase.from('team_roles').delete().eq('id', id)
  if (error) throw error
}

/**
 * Lagrer rekkefølgen etter en flytting. Bare radene som faktisk endret plass blir skrevet.
 * Enkle update-kall, ikke upsert: appen har ikke lov til å skrive `id`, bare navn og sort.
 */
export async function reorderTeamRoles(ordered: TeamRole[]) {
  const changed = ordered.map((r, i) => ({ id: r.id, sort: i + 1 })).filter((r, i) => r.sort !== ordered[i].sort)
  if (changed.length === 0) return
  const results = await Promise.all(changed.map((r) => supabase.from('team_roles').update({ sort: r.sort }).eq('id', r.id)))
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}

/**
 * Rekkefølgen i ukevisningen: lista laget har satt, så de uten rolle, så på navn.
 * Har laget ingen roller i det hele tatt, blir det bare navn.
 */
export function lineupOrder<T extends Pick<MemberWithProfile, 'role_id' | 'profile'>>(members: T[], roles: TeamRole[] = []): T[] {
  const rank = (m: T) => {
    const i = roles.findIndex((r) => r.id === m.role_id)
    return i === -1 ? roles.length : i
  }
  return [...members].sort((a, b) => rank(a) - rank(b) || (a.profile?.display_name ?? '').localeCompare(b.profile?.display_name ?? ''))
}

/** Navnet på rollen et medlem har, eller null. */
export function roleName(member: Pick<MemberWithProfile, 'role_id'>, roles: TeamRole[]): string | null {
  return roles.find((r) => r.id === member.role_id)?.name ?? null
}

/** Din egen rolle, eller alles når du er admin. RLS gjør andre tilfeller til 0 rader. */
export async function setMemberRole(teamId: string, userId: string, roleId: string | null) {
  const { error } = await supabase.from('members').update({ role_id: roleId }).eq('team_id', teamId).eq('user_id', userId)
  if (error) throw error
}

/** Tilgang: admin eller ikke. Bare eieren kan endre den. */
export async function setAccess(teamId: string, userId: string, role: 'admin' | 'member') {
  const { error } = await supabase.rpc('set_role', { team: teamId, member: userId, new_role: role })
  if (error) throw error
}

export async function transferOwnership(teamId: string, userId: string) {
  const { error } = await supabase.rpc('transfer_ownership', { team: teamId, new_owner: userId })
  if (error) throw error
}

export async function removeMember(teamId: string, userId: string) {
  const { error } = await supabase.rpc('remove_member', { team: teamId, member: userId })
  if (error) throw error
}

export async function leaveTeam(teamId: string) {
  const { error } = await supabase.rpc('leave_team', { team: teamId })
  if (error) throw error
}

export async function deleteTeam(teamId: string, confirmName: string) {
  const { error } = await supabase.rpc('delete_team', { team: teamId, confirm_name: confirmName })
  if (error) throw error
}

/**
 * Lagets tidssone. Bare eieren, og bare et ekte sonenavn (trigger i basen).
 * Timene som ligger lagret er tall og flytter seg ikke — det er hva de betyr
 * som endrer seg, så den som trykker må vite det først.
 */
export async function setTeamTimezone(teamId: string, timezone: string) {
  const { error } = await supabase.from('teams').update({ timezone }).eq('id', teamId)
  if (error) throw error
}

export async function renameTeam(teamId: string, name: string) {
  const { error } = await supabase.from('teams').update({ name: name.trim() }).eq('id', teamId)
  if (error) throw error
}

// ---------- invites ----------

export async function fetchInvites(teamId: string): Promise<Invite[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Invite[]
}

export async function createInvite(teamId: string, days: number, maxUses: number) {
  const expires = new Date(Date.now() + days * 86_400_000).toISOString()
  const { error } = await supabase.from('invites').insert({ team_id: teamId, expires_at: expires, max_uses: maxUses })
  if (error) throw error
}

export async function deleteInvite(inviteId: string) {
  const { error } = await supabase.from('invites').delete().eq('id', inviteId)
  if (error) throw error
}

export function inviteIsActive(inv: Invite): boolean {
  return new Date(inv.expires_at).getTime() > Date.now() && inv.used_count < inv.max_uses
}

// ---------- time slots ----------

export async function addSlot(teamId: string, dayType: DayType, start: number, end: number, sort: number) {
  const { error } = await supabase
    .from('team_slots')
    .insert({ team_id: teamId, day_type: dayType, start_hour: start, end_hour: end, sort })
  if (error) throw error
}

export async function updateSlot(slotId: string, patch: Partial<Pick<TeamSlot, 'start_hour' | 'end_hour' | 'sort'>>) {
  const { error } = await supabase.from('team_slots').update(patch).eq('id', slotId)
  if (error) throw error
}

export async function deleteSlot(slotId: string) {
  const { error } = await supabase.from('team_slots').delete().eq('id', slotId)
  if (error) throw error
}

// ---------- activity types ----------

export interface TypeInput {
  name: string
  color: ActivityColor
  ask_opponent: boolean
  default_hours: number
}

export async function addActivityType(teamId: string, input: TypeInput, sort: number) {
  const { error } = await supabase.from('activity_types').insert({ team_id: teamId, ...input, sort })
  if (error) throw error
}

export async function updateActivityType(typeId: string, patch: Partial<TypeInput & Pick<ActivityType, 'archived' | 'sort'>>) {
  const { error } = await supabase.from('activity_types').update(patch).eq('id', typeId)
  if (error) throw error
}

/** Delete when unused; the database refuses if a booking points at it, then we archive instead. */
export async function removeActivityType(typeId: string) {
  const { error } = await supabase.from('activity_types').delete().eq('id', typeId)
  if (!error) return
  if (String(error.message).includes('foreign key')) {
    await updateActivityType(typeId, { archived: true })
    return
  }
  throw error
}

// ---------- usual week ----------

/** Returns how many hours were saved. */
export async function saveDefaultWeek(teamId: string, mondayKey: string): Promise<number> {
  const { data, error } = await supabase.rpc('save_default_week', { team: teamId, week_start: mondayKey })
  if (error) throw error
  return (data as number) ?? 0
}

/** Setter uka til nøyaktig den vanlige uka di. Returnerer hvor mange timer som står igjen. */
export async function replaceWithDefaultWeek(teamId: string, mondayKey: string): Promise<number> {
  const { data, error } = await supabase.rpc('replace_with_default_week', { team: teamId, week_start: mondayKey })
  if (error) throw error
  return (data as number) ?? 0
}

/** Tømmer dine egne timer i uka. Returnerer hvor mange som ble fjernet. */
export async function clearWeek(teamId: string, mondayKey: string): Promise<number> {
  const { data, error } = await supabase.rpc('clear_week', { team: teamId, week_start: mondayKey })
  if (error) throw error
  return (data as number) ?? 0
}

/** Antall timer i den vanlige uka di, 0 om du ikke har en. */
export async function defaultWeekHours(teamId: string, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('default_week')
    .select('hour', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .eq('user_id', userId)
  if (error) throw error
  return count ?? 0
}

export async function hasDefaultWeek(teamId: string, userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('default_week')
    .select('hour', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .eq('user_id', userId)
  if (error) throw error
  return (count ?? 0) > 0
}

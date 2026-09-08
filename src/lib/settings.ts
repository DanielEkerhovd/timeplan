import { supabase } from './supabase'
import type { ActivityColor, ActivityType, DayType, Invite, MemberRole, MemberWithProfile, TeamSlot } from './types'

// ---------- members ----------

export async function fetchMembers(teamId: string): Promise<MemberWithProfile[]> {
  const { data, error } = await supabase.from('members').select('*, profile:profiles(*)').eq('team_id', teamId)
  if (error) throw error
  const rows = (data ?? []) as unknown as MemberWithProfile[]
  const rank: Record<MemberRole, number> = { owner: 0, coach: 1, player: 2 }
  rows.sort(
    (a, b) => rank[a.role] - rank[b.role] || (a.profile?.display_name ?? '').localeCompare(b.profile?.display_name ?? ''),
  )
  return rows
}

export async function setRole(teamId: string, userId: string, role: 'coach' | 'player') {
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

/** Returns how many hours were added. */
export async function applyDefaultWeek(teamId: string, mondayKey: string): Promise<number> {
  const { data, error } = await supabase.rpc('apply_default_week', { team: teamId, week_start: mondayKey })
  if (error) throw error
  return (data as number) ?? 0
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

// Roles: the picker (GET) and the role the bot manages (POST).
//
// A role the bot manages is created by the bot and kept in step with the team:
// join the team in Gather, get the role. Adding is done here and on every
// sync. Taking the role away when someone leaves the team comes with the
// notification round (it hangs off the same trigger as "member removed").

export const config = { runtime: 'edge' }

import { botMember, discord, DiscordError, explain, has, P, topPosition } from '../_lib/discord'
import type { Role } from '../_lib/discord'
import { guard, HttpError, json } from '../_lib/env'
import { db, log, requireOwner } from '../_lib/supabase'
import type { DiscordLink } from '../_lib/supabase'

const GATHER_GREEN = 0x3e9a63

export default function handler(req: Request): Promise<Response> {
  return guard(async () => {
    const url = new URL(req.url)
    const teamId = url.searchParams.get('team') ?? ''
    await requireOwner(req, teamId)
    const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` })
    if (!link) throw new HttpError(409, 'not connected')

    if (req.method === 'GET') {
      const roles = await discord<Role[]>('GET', `/guilds/${link.guild_id}/roles`)
      return json({
        roles: roles
          .filter((r) => r.id !== link.guild_id && !r.managed)
          .sort((a, b) => b.position - a.position)
          .map((r) => ({ id: r.id, name: r.name, color: r.color })),
      })
    }
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed')

    const body = (await req.json().catch(() => ({}))) as { action?: string }
    if (body.action === 'create') return json(await createManaged(teamId, link))
    if (body.action === 'sync') return json(await sync(teamId, link))
    throw new HttpError(400, 'unknown action')
  })
}

async function createManaged(teamId: string, link: DiscordLink) {
  const team = await db.one<{ name: string }>('teams', { id: `eq.${teamId}`, select: 'name' })
  const me = await botMember(link.guild_id)
  if (!me) throw new HttpError(409, 'The bot is no longer in the server. Connect again.')

  let role: Role
  try {
    role = await discord<Role>('POST', `/guilds/${link.guild_id}/roles`, {
      name: team?.name ?? 'Gather team',
      color: GATHER_GREEN,
      mentionable: true,
      hoist: false,
    })
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
  await db.update('discord_links', { team_id: `eq.${teamId}` }, { ping_mode: 'role', ping_role_id: role.id, managed_role: true })
  await log(teamId, 'link', `Created the @${role.name} role`, true)
  const result = await sync(teamId, { ...link, ping_mode: 'role', ping_role_id: role.id, managed_role: true })
  return { role: { id: role.id, name: role.name }, ...result }
}

/** Give the managed role to every team member who is in the server. */
async function sync(teamId: string, link: DiscordLink) {
  if (!link.managed_role || !link.ping_role_id) throw new HttpError(409, 'the team has no managed role')
  const me = await botMember(link.guild_id)
  if (!me) throw new HttpError(409, 'The bot is no longer in the server. Connect again.')
  const roles = await discord<Role[]>('GET', `/guilds/${link.guild_id}/roles`)
  const role = roles.find((r) => r.id === link.ping_role_id)
  if (!role) throw new HttpError(409, 'The role was deleted on Discord. Pick a ping mode again.')
  const all = [link.guild_id, ...me.roles].reduce((acc, id) => acc | BigInt(roles.find((r) => r.id === id)?.permissions ?? '0'), 0n)
  if (!has(all, P.ADMINISTRATOR) && !has(all, P.MANAGE_ROLES)) throw new HttpError(409, 'The bot needs Manage Roles to keep the role in sync.')
  if (topPosition(roles, me) <= role.position) {
    throw new HttpError(409, `Drag the Gather role above @${role.name} in Server Settings → Roles, then try again.`)
  }

  const members = await db.select<{ profiles: { discord_id: string | null } }>('members', {
    select: 'profiles(discord_id)',
    team_id: `eq.${teamId}`,
  })
  let given = 0
  let missing = 0
  for (const m of members) {
    const id = m.profiles?.discord_id
    if (!id) {
      missing++
      continue
    }
    try {
      await discord('PUT', `/guilds/${link.guild_id}/members/${id}/roles/${role.id}`)
      given++
    } catch (err) {
      // 10007 = not a member of the server. They joined the team, not the Discord. Fine.
      if (err instanceof DiscordError && err.code === 10007) missing++
      else throw new HttpError(409, explain(err))
    }
  }
  return { given, missing }
}

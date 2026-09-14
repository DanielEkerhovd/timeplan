// Roles: the picker (GET) and the role the bot manages (POST).
//
// A role the bot manages is created by the bot and kept in step with the team:
// join the team in Gather, get the role. Adding is done here and on every
// sync. Taking the role away when someone leaves the team comes with the
// notification round (it hangs off the same trigger as "member removed").

export const config = { runtime: 'edge' }

import { botMember, canManageRole, discord, DiscordError, explain, has, P } from '../_lib/discord'
import type { Role } from '../_lib/discord'
import { guard, HttpError, json } from '../_lib/env'
import { db, log, requireOwner, throttle } from '../_lib/supabase'
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

    const body = (await req.json().catch(() => ({}))) as { action?: string; name?: string; mode?: string; role_id?: string | null }
    if (body.action === 'pick') return json(await pick(teamId, link, body.mode, body.role_id))
    if (body.action === 'create') {
      await throttle(teamId, 5)
      return json(await createManaged(teamId, link, body.name))
    }
    if (body.action === 'rename') return json(await renameManaged(teamId, link, body.name ?? ''))
    if (body.action === 'sync') return json(await sync(teamId, link))
    throw new HttpError(400, 'unknown action')
  })
}

/**
 * Who the week post pings: everyone with a Discord account, or a role. A role
 * the owner picks must exist in the linked server and be one the server made,
 * not an integration's and not @everyone. It is never "ours": managed_role is
 * cleared, so sync/rename/disconnect leave it alone.
 */
async function pick(teamId: string, link: DiscordLink, mode?: string, roleId?: string | null) {
  if (mode === 'members') {
    await db.update('discord_links', { team_id: `eq.${teamId}` }, { ping_mode: 'members', ping_role_id: null, managed_role: false })
    const removed = await dropManaged(teamId, link)
    return { ok: true, removed }
  }
  if (mode !== 'role') throw new HttpError(400, 'unknown ping mode')
  const id = String(roleId ?? '')
  if (!/^[0-9]{5,25}$/.test(id)) throw new HttpError(400, 'bad role id')
  if (id === link.guild_id) throw new HttpError(409, 'That would ping the whole server.')
  const roles = await discord<Role[]>('GET', `/guilds/${link.guild_id}/roles`)
  const role = roles.find((r) => r.id === id)
  if (!role) throw new HttpError(409, 'That role is not on the connected server.')
  if (role.managed) throw new HttpError(409, 'That role belongs to an integration and cannot be picked.')
  // Picking the role the bot made keeps it managed; anything else is the server's own.
  const managed = Boolean(link.managed_role && link.ping_role_id === id)
  await db.update('discord_links', { team_id: `eq.${teamId}` }, { ping_mode: 'role', ping_role_id: id, managed_role: managed })
  const removed = managed ? null : await dropManaged(teamId, link)
  return { ok: true, role: { id: role.id, name: role.name }, removed }
}

/**
 * The role the bot made has no purpose once the team stops pinging it, so it
 * goes when the choice changes; otherwise every "let me try everyone instead"
 * leaves a stray @Team on the server. Best effort: the choice is saved first,
 * and a role that cannot be deleted is left with a line in the log.
 */
async function dropManaged(teamId: string, link: DiscordLink): Promise<string | null> {
  if (!link.managed_role || !link.ping_role_id) return null
  try {
    const roles = await discord<Role[]>('GET', `/guilds/${link.guild_id}/roles`)
    const role = roles.find((r) => r.id === link.ping_role_id)
    if (!role) return null
    await discord('DELETE', `/guilds/${link.guild_id}/roles/${role.id}`)
    await log(teamId, 'link', `Removed the @${role.name} role from the server`, true)
    return role.name
  } catch (err) {
    await log(teamId, 'link', 'Could not remove the team role from the server', false, explain(err))
    return null
  }
}

async function createManaged(teamId: string, link: DiscordLink, wanted?: string) {
  const team = await db.one<{ name: string }>('teams', { id: `eq.${teamId}`, select: 'name' })
  const me = await botMember(link.guild_id)
  if (!me) throw new HttpError(409, 'The bot is no longer in the server. Connect again.')
  const name = (wanted?.trim() || team?.name || 'Gather team').slice(0, 100)

  const roles = await discord<Role[]>('GET', `/guilds/${link.guild_id}/roles`)

  // Already have one, and it still exists? Then this is a repeat click (back
  // and forth in the setup, a double tap). Hand back the role we have instead
  // of littering the server with copies.
  if (link.managed_role && link.ping_role_id) {
    const have = roles.find((r) => r.id === link.ping_role_id)
    if (have) {
      const result = await sync(teamId, link)
      return { role: { id: have.id, name: have.name }, ...result }
    }
  }

  // A role with that name already on the server is not ours to take over: it
  // may carry permissions we know nothing about. The owner can pick it under
  // "use a role the server already has" if that is what they mean.
  const clash = roles.find((r) => r.id !== link.guild_id && r.name.toLowerCase() === name.toLowerCase())
  if (clash) throw new HttpError(409, `There is already a role called @${clash.name} on the server. Pick another name, or choose that role under "Use a role the server already has".`)

  let role: Role
  try {
    role = await discord<Role>('POST', `/guilds/${link.guild_id}/roles`, {
      name,
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

/** Rename the role the bot manages. Only that one: roles the server made are the server's to rename. */
async function renameManaged(teamId: string, link: DiscordLink, wanted: string) {
  if (!link.managed_role || !link.ping_role_id) throw new HttpError(409, 'The team has no role managed by Gather.')
  const name = wanted.trim().slice(0, 100)
  if (name.length < 1) throw new HttpError(400, 'Give the role a name.')
  const roles = await discord<Role[]>('GET', `/guilds/${link.guild_id}/roles`)
  const have = roles.find((r) => r.id === link.ping_role_id)
  if (!have) throw new HttpError(409, 'The role was deleted on Discord. Pick a ping mode again.')
  const clash = roles.find((r) => r.id !== have.id && r.id !== link.guild_id && r.name.toLowerCase() === name.toLowerCase())
  if (clash) throw new HttpError(409, `There is already a role called @${clash.name} on the server. Pick another name.`)
  try {
    await discord('PATCH', `/guilds/${link.guild_id}/roles/${have.id}`, { name })
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
  await log(teamId, 'link', `Renamed the team role to @${name}`, true)
  return { role: { id: have.id, name } }
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
  if (!canManageRole(roles, me, role)) {
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

// Where Discord sends the owner back after they picked a server.
//
// Discord has already added the bot at this point. What we decide here is
// whether the TEAM gets linked: only if the person who started the flow holds
// Manage Server in the server they picked. That is the real check against a
// stranger's team hooking itself up to your server. The permissions come from
// Discord's own answer to /users/@me/guilds, not from anything the client sent.

export const config = { runtime: 'edge' }

import { readState } from '../_lib/crypto'
import { P, has } from '../_lib/discord'
import { env } from '../_lib/env'
import { db, log } from '../_lib/supabase'

const back = (teamId: string, query: Record<string, string>) => {
  const u = new URL(`${env.appUrl()}/team/${teamId}/settings`)
  u.searchParams.set('tab', 'discord')
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  return Response.redirect(u.toString(), 302)
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const state = await readState(env.stateSecret(), url.searchParams.get('state') ?? '')
  if (!state?.team || !state.user) {
    return new Response('This link has expired. Start again from Settings in Gather.', { status: 400 })
  }
  const teamId = state.team
  try {
    return await finish(url, teamId, state.user)
  } catch (err) {
    console.error(err)
    return back(teamId, { discord: 'token' })
  }
}

async function finish(url: URL, teamId: string, userId: string): Promise<Response> {
  if (url.searchParams.get('error')) return back(teamId, { discord: 'cancelled' })
  const code = url.searchParams.get('code') ?? ''
  if (!code) return back(teamId, { discord: 'cancelled' })

  // Code → the person's token. Short-lived, used for two reads, then forgotten.
  const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.appId(),
      client_secret: env.clientSecret(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${env.appUrl()}/api/discord/callback`,
    }),
  })
  if (!tokenRes.ok) return back(teamId, { discord: 'token' })
  const token = (await tokenRes.json()) as { access_token: string; guild?: { id: string; name: string } }
  // The server the bot was actually added to, from Discord's own answer — not from the query string.
  const guildId = token.guild?.id ?? ''
  if (!/^[0-9]{5,25}$/.test(guildId)) return back(teamId, { discord: 'cancelled' })
  const bearer = { Authorization: `Bearer ${token.access_token}` }

  const [meRes, guildsRes] = await Promise.all([
    fetch('https://discord.com/api/v10/users/@me', { headers: bearer }),
    fetch('https://discord.com/api/v10/users/@me/guilds', { headers: bearer }),
  ])
  if (!meRes.ok || !guildsRes.ok) return back(teamId, { discord: 'token' })
  const me = (await meRes.json()) as { id: string }
  const guilds = (await guildsRes.json()) as { id: string; name: string; permissions: string }[]
  const guild = guilds.find((g) => g.id === guildId)

  // The Discord account that just approved must be the one the Gather user signed
  // in with. Otherwise a link to /api/discord/install could be handed to someone
  // else, and their approval would connect a stranger's team to their server.
  const profile = await db.one<{ discord_id: string | null }>('profiles', { user_id: `eq.${userId}`, select: 'discord_id' })
  if (profile?.discord_id && profile.discord_id !== me.id) {
    await log(teamId, 'link', 'Not linked: the Discord account did not match the one you signed in with', false)
    return back(teamId, { discord: 'wrong_account' })
  }

  const perms = guild ? BigInt(guild.permissions) : 0n
  if (!guild || !(has(perms, P.MANAGE_GUILD) || has(perms, P.ADMINISTRATOR))) {
    await log(teamId, 'link', `Not linked: you need Manage Server in ${guild?.name ?? 'that server'}`, false)
    return back(teamId, { discord: 'no_manage_server' })
  }

  // Their Discord id on the profile, for people who signed in before 0017. Never overwrites one we have.
  if (!profile?.discord_id) await db.update('profiles', { user_id: `eq.${userId}`, discord_id: 'is.null' }, { discord_id: me.id })

  // Moving to another server: channels, the living post and the ping role belonged to the old one.
  const existing = await db.one<{ guild_id: string }>('discord_links', { team_id: `eq.${teamId}`, select: 'guild_id' })
  const moved = existing !== null && existing.guild_id !== guildId
  if (moved) {
    await db.remove('discord_week_post', { team_id: `eq.${teamId}` })
    await db.remove('discord_channels', { team_id: `eq.${teamId}` })
  }

  await db.upsert('discord_links', {
    team_id: teamId,
    guild_id: guildId,
    guild_name: (token.guild?.name ?? guild.name).slice(0, 100),
    linked_by: userId,
    ...(moved || !existing ? { ping_mode: 'members', ping_role_id: null, managed_role: false } : {}),
  })
  await db.upsert('discord_schedules', { team_id: teamId }, 'team_id')
  await log(teamId, 'link', `Connected to ${guild.name}`, true)
  return back(teamId, { discord: 'linked' })
}

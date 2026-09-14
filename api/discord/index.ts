// Discord calls this for every slash command and button press (the Interactions
// Endpoint URL on the application). No bot process, no websocket: Discord POSTs,
// we answer within three seconds, done.
//
// Two things that matter here and nowhere else in the app:
//
//   * The signature check runs on the raw bytes. Discord signs `timestamp + body`
//     with Ed25519 and sends deliberately bad requests at setup to make sure we
//     reject them. Parse the JSON only after the check passes.
//   * There is no signed-in user. Everything the button knows is a Discord user
//     id in the payload, so RLS never runs — writes go through the service role
//     and THIS file is the authorisation. Membership is checked against the
//     event's own team, looked up from our database, never from the button's
//     custom_id.

export const config = { runtime: 'edge' }

import { verifyDiscordSignature } from '../_lib/crypto'
import { env, json } from '../_lib/env'
import { db } from '../_lib/supabase'
import type { DiscordChannel, DiscordLink, WeekPost } from '../_lib/supabase'
import { addDays, localNow, mondayOf } from '../_lib/time'
import { buildWeekMessage, COMPONENTS_V2, contentHash, fetchBotWeek } from '../_lib/week'

interface Interaction {
  type: number
  id: string
  token: string
  guild_id?: string
  channel_id?: string
  member?: { user: { id: string }; roles: string[] }
  user?: { id: string }
  message?: { id: string; channel_id: string }
  data?: {
    name?: string
    custom_id?: string
    options?: { name: string; value: string | number | boolean }[]
  }
}

const EPHEMERAL = 64

const reply = (content: string) => json({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } })

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const signature = req.headers.get('x-signature-ed25519') ?? ''
  const timestamp = req.headers.get('x-signature-timestamp') ?? ''
  const raw = await req.text()
  if (!(await verifyDiscordSignature(env.publicKey(), signature, timestamp, raw))) {
    return new Response('invalid request signature', { status: 401 })
  }

  let it: Interaction
  try {
    it = JSON.parse(raw) as Interaction
  } catch {
    return new Response('bad json', { status: 400 })
  }

  // 1 = PING. Discord's setup check, and its periodic health check.
  if (it.type === 1) return json({ type: 1 })

  try {
    if (it.type === 2 && it.data?.name === 'week') return await weekCommand(it)
    if (it.type === 3 && it.data?.custom_id) return await button(it)
  } catch (err) {
    console.error(err)
    return reply('Something went wrong on our side. Try again in a moment.')
  }
  return reply('That command is not wired up yet.')
}

const userId = (it: Interaction) => it.member?.user.id ?? it.user?.id ?? null

/**
 * Which team a channel belongs to. A channel belongs to at most one team
 * (unique in the database), so this is unambiguous when it answers at all.
 */
async function teamForChannel(channelId: string): Promise<string | null> {
  const row = await db.one<DiscordChannel>('discord_channels', { channel_id: `eq.${channelId}` })
  return row?.team_id ?? null
}

/** Teams in this server the Discord user is a member of. */
async function teamsForUser(guildId: string, discordId: string): Promise<string[]> {
  const links = await db.select<DiscordLink>('discord_links', { guild_id: `eq.${guildId}` })
  if (links.length === 0) return []
  const rows = await db.select<{ team_id: string }>('members', {
    select: 'team_id,profiles!inner(discord_id)',
    team_id: `in.(${links.map((l) => l.team_id).join(',')})`,
    'profiles.discord_id': `eq.${discordId}`,
  })
  return rows.map((r) => r.team_id)
}

async function weekCommand(it: Interaction): Promise<Response> {
  if (!it.guild_id || !it.channel_id) return reply('Use this in a server channel.')
  const me = userId(it)
  if (!me) return reply('Could not tell who you are.')

  let teamId = await teamForChannel(it.channel_id)
  // In a team channel the reply is for everyone there. Anywhere else it is for the
  // person who asked: the roster does not belong in #general.
  let flags = COMPONENTS_V2
  if (!teamId) {
    const mine = await teamsForUser(it.guild_id, me)
    if (mine.length === 1) teamId = mine[0]
    else if (mine.length === 0) return reply(`You are not on a team in this server. Join one at ${env.appUrl()}`)
    else return reply('This channel is not linked to a team, and you are on more than one here. Use /week in one of the team channels.')
    flags |= EPHEMERAL
  }

  const which = String(it.data?.options?.find((o) => o.name === 'which')?.value ?? 'this')
  const [team, link] = await Promise.all([
    db.one<{ id: string; timezone: string }>('teams', { id: `eq.${teamId}`, select: 'id,timezone' }),
    db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` }),
  ])
  if (!team) return reply('That team no longer exists.')
  const today = localNow(team.timezone).dateKey
  const monday = mondayOf(which === 'next' ? addDays(today, 7) : today)

  const week = await fetchBotWeek(teamId, monday)
  if (!week) return reply('That team no longer exists.')
  const msg = buildWeekMessage(week, { ping: null, link, appUrl: env.appUrl() })
  // A lookup, not the living post: a plain reply where the command was typed.
  return json({ type: 4, data: { ...msg, flags } })
}

async function button(it: Interaction): Promise<Response> {
  const me = userId(it)
  const m = it.data?.custom_id?.match(/^(join|cant):([0-9a-f-]{36})$/)
  if (!me || !m) return reply('That button is not wired up.')
  const [, action, eventId] = m

  // The team comes from the event row, never from the button. Three seconds to
  // answer, so the reads that do not depend on each other go out together.
  const event = await db.one<{ id: string; team_id: string; date: string; teams: { timezone: string } }>('events', {
    id: `eq.${eventId}`,
    select: 'id,team_id,date,teams(timezone)',
  })
  if (!event) return reply('That session was removed.')

  const [rows, link, live] = await Promise.all([
    db.select<{ user_id: string }>('members', {
      select: 'user_id,profiles!inner(discord_id)',
      team_id: `eq.${event.team_id}`,
      'profiles.discord_id': `eq.${me}`,
    }),
    db.one<DiscordLink>('discord_links', { team_id: `eq.${event.team_id}` }),
    it.message ? db.one<WeekPost>('discord_week_post', { team_id: `eq.${event.team_id}` }) : Promise.resolve(null),
  ])
  const member = rows[0]
  if (!member) return reply(`You are not on this team in Gather. Ask for an invite link, or sign in at ${env.appUrl()}`)

  const today = localNow(event.teams?.timezone ?? 'UTC').dateKey
  if (event.date < mondayOf(today)) return reply('That week is over.')

  await db.upsert(
    'event_responses',
    { event_id: eventId, user_id: member.user_id, status: action === 'join' ? 'coming' : 'not_coming', updated_at: new Date().toISOString() },
    'event_id,user_id',
  )

  // Redraw the message the button sits on, so the names are right for everyone.
  const week = await fetchBotWeek(event.team_id, mondayOf(event.date))
  if (!week) return reply('Saved.')
  const msg = buildWeekMessage(week, { ping: null, link, appUrl: env.appUrl() })

  // If this is the living post, remember what it now says so the cron does not PATCH it again for nothing.
  if (it.message) {
    if (live && live.message_id === it.message.id) {
      const hash = await contentHash(msg)
      await db.update('discord_week_post', { team_id: `eq.${event.team_id}` }, { content_hash: hash, updated_at: new Date().toISOString() })
    }
  }

  // 7 = UPDATE_MESSAGE: replace the message the button is on.
  return json({ type: 7, data: { ...msg, flags: COMPONENTS_V2 } })
}

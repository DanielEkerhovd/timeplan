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
import type { DiscordChannel, DiscordLink } from '../_lib/supabase'
import { addDays, localNow, mondayOf } from '../_lib/time'
import { buildWeekMessage, fetchBotWeek } from '../_lib/week'
import { buildNewSessionsCard, buildUpdateCard, peopleFor } from '../_lib/updates'
import type { OutboxRow } from '../_lib/updates'
import { silent } from '../_lib/updateCard'
import type { BotWeek } from '../_lib/week'

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

/** Something only the person who clicked sees. Used for every "no" and every error. */
const reply = (content: string) => json({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } })

/** Vercel's edge runtime hands us this as the second argument. `waitUntil` keeps the function alive after the response. */
interface EdgeContext {
  waitUntil?: (p: Promise<unknown>) => void
}

/**
 * Discord gives us three seconds, and a cold start plus a few database calls
 * can eat that. So every command and button is answered at once with "working
 * on it" (a deferred response), and the real answer is written into the
 * message afterwards through the interaction's webhook. Nothing the person
 * sees changes; the spinner just never turns into "did not respond in time".
 */
export default async function handler(req: Request, ctx?: EdgeContext): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const signature = req.headers.get('x-signature-ed25519') ?? ''
  const timestamp = req.headers.get('x-signature-timestamp') ?? ''
  const raw = await req.text()
  if (!(await verifyDiscordSignature(env.publicKey(), signature, timestamp, raw))) {
    return new Response('invalid request signature', { status: 401 })
  }
  // A signed request is valid forever unless the clock is checked. Five
  // minutes covers Discord's retries; a replay from an old log does not get in.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return new Response('stale request', { status: 401 })
  }

  let it: Interaction
  try {
    it = JSON.parse(raw) as Interaction
  } catch {
    return new Response('bad json', { status: 400 })
  }

  // 1 = PING. Discord's setup check, and its periodic health check.
  if (it.type === 1) return json({ type: 1 })

  const later = async (work: Promise<void>) => {
    const p = work.catch(async (err) => {
      console.error(err)
      await followUp(it, 'Something went wrong on our side. Try again in a moment.')
    })
    if (ctx?.waitUntil) ctx.waitUntil(p)
    else await p
  }

  if (it.type === 2 && it.data?.name === 'week') {
    // Public in a team channel, private anywhere else. That has to be decided
    // before deferring, so one quick lookup comes first.
    const teamId = it.channel_id ? await teamForChannel(it.channel_id) : null
    await later(weekCommand(it, teamId))
    // 5 = DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: "thinking…" until we edit it.
    return json({ type: 5, data: { flags: teamId ? 0 : EPHEMERAL } })
  }
  if (it.type === 3 && it.data?.custom_id) {
    await later(it.data.custom_id.startsWith('u') ? updateButton(it) : button(it))
    // 6 = DEFERRED_UPDATE_MESSAGE: the message stays as it is until we edit it.
    return json({ type: 6 })
  }
  return reply('That command is not wired up yet.')
}

const webhook = (it: Interaction) => `https://discord.com/api/v10/webhooks/${env.appId()}/${it.token}`

/** Replace the deferred answer (or, for a button, the message it sits on). */
async function editOriginal(it: Interaction, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${webhook(it)}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`edit original: ${res.status} ${await res.text().catch(() => '')}`)
}

/** A private note to the person who clicked, on top of whatever the message shows. */
async function followUp(it: Interaction, content: string): Promise<void> {
  await fetch(webhook(it), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, flags: EPHEMERAL, allowed_mentions: { parse: [] } }),
  }).catch(() => undefined)
}

/** For a deferred command, "reply" means: turn the thinking message into this text. */
async function say(it: Interaction, content: string): Promise<void> {
  await editOriginal(it, { content, components: [], allowed_mentions: { parse: [] } })
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

async function weekCommand(it: Interaction, fromChannel: string | null): Promise<void> {
  if (!it.guild_id || !it.channel_id) return say(it, 'Use this in a server channel.')
  const me = userId(it)
  if (!me) return say(it, 'Could not tell who you are.')

  let teamId = fromChannel
  if (!teamId) {
    const mine = await teamsForUser(it.guild_id, me)
    if (mine.length === 1) teamId = mine[0]
    else if (mine.length === 0) return say(it, `You are not on a team in this server. Join one at ${env.appUrl()}`)
    else return say(it, 'This channel is not linked to a team, and you are on more than one here. Use /week in one of the team channels.')
  }

  const which = String(it.data?.options?.find((o) => o.name === 'which')?.value ?? 'this')
  const [team, link] = await Promise.all([
    db.one<{ id: string; timezone: string }>('teams', { id: `eq.${teamId}`, select: 'id,timezone' }),
    db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` }),
  ])
  if (!team) return say(it, 'That team no longer exists.')
  const today = localNow(team.timezone).dateKey
  const monday = mondayOf(which === 'next' ? addDays(today, 7) : today)

  const week = await fetchBotWeek(teamId, monday)
  if (!week) return say(it, 'That team no longer exists.')
  // A lookup, not the living post: a plain reply where the command was typed.
  await editOriginal(it, buildWeekMessage(week, { ping: null, link, appUrl: env.appUrl() }))
}

async function button(it: Interaction): Promise<void> {
  const me = userId(it)
  const m = it.data?.custom_id?.match(/^(join|cant):([0-9a-f-]{36})$/)
  if (!me || !m) return followUp(it, 'That button is not wired up.')
  const [, action, eventId] = m

  // One round trip. The database checks that this Discord account is on the
  // event's team (the team comes from the event row, never from the button),
  // saves the answer, and hands back the week to draw.
  const r = await db.rpc<{ error?: string; week?: BotWeek; event?: { title: string; opponent: string | null; date: string } }>('bot_respond', {
    discord_id: me,
    event_id: eventId,
    status: action === 'join' ? 'coming' : 'not_coming',
  })
  if (r.error === 'gone') return followUp(it, 'That session was removed.')
  if (r.error === 'not_member') return followUp(it, `You are not on this team in Gather. Ask for an invite link, or sign in at ${env.appUrl()}`)
  if (r.error === 'past') return followUp(it, 'That week is over.')
  if (!r.week) return

  const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${r.week.team.id}` })
  await editOriginal(it, buildWeekMessage(r.week, { ping: null, link, appUrl: env.appUrl() }))

  // Nothing is written to the stored content hash here. Two fast clicks can
  // land their edits out of order; the cron rebuilds from the database on its
  // next run, sees the hash differ, and puts the message right. Self-healing
  // beats a lock.

  // No confirmation note: the names on the card are the confirmation. Only a
  // "no" (not on the team, week over, session gone) gets a private message.
}

/**
 * Still in / Can't on a change card. Same write as the week-plan buttons, then
 * the card is redrawn from its own queue row (found by message id), so the
 * "moved from" line stays and only the names change.
 */
async function updateButton(it: Interaction): Promise<void> {
  const me = userId(it)
  // The queue row id rides in the button, so the card can be redrawn wherever
  // it lives: the channel, or a DM (which has no message lookup on our side).
  const m = it.data?.custom_id?.match(/^(uj|uc):([0-9a-f-]{36}):(\d{1,12})$/)
  if (!me || !m) return followUp(it, 'That button is not wired up.')
  const [, action, eventId, rowId] = m

  const r = await db.rpc<{ error?: string; week?: unknown }>('bot_respond', {
    discord_id: me,
    event_id: eventId,
    status: action === 'uj' ? 'coming' : 'not_coming',
  })
  if (r.error === 'gone') return followUp(it, 'That session was removed.')
  if (r.error === 'not_member') return followUp(it, `You are not on this team in Gather. Ask for an invite link, or sign in at ${env.appUrl()}`)
  if (r.error === 'past') return followUp(it, 'That week is over.')

  const row = await db.one<OutboxRow>('discord_outbox', { id: `eq.${rowId}` })
  if (!row || row.event_id !== eventId) return
  const team = await db.one<{ timezone: string; name: string }>('teams', { id: `eq.${row.team_id}`, select: 'timezone,name' })
  const tz = team?.timezone ?? 'UTC'
  // No guild: the button was pressed in a DM, so the redraw is the private version.
  const dm = it.guild_id ? undefined : { team: team?.name ?? 'Your team', me }

  if (row.kind === 'new') {
    // The card may hold several new sessions (one ping for a burst). Redraw it
    // from every row that went out in the same message, names included.
    // Rows in one card share a message id (channel) or, for DM-only sends, the
    // same sent_at stamp.
    const siblings = row.message_id
      ? await db.select<OutboxRow>('discord_outbox', { message_id: `eq.${row.message_id}`, order: 'id.asc' })
      : row.sent_at
        ? await db.select<OutboxRow>('discord_outbox', { team_id: `eq.${row.team_id}`, kind: 'eq.new', sent_at: `eq.${row.sent_at}`, order: 'id.asc' })
        : [row]
    const people = await Promise.all(siblings.map((s) => peopleFor(s.event_id)))
    await editOriginal(it, buildNewSessionsCard(siblings, tz, silent, people, dm))
    return
  }
  await editOriginal(it, buildUpdateCard(row, tz, await peopleFor(eventId), dm))
}

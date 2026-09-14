// Owner actions that need the bot token: post the week now, send a test
// message, disconnect. POST with { action } and the owner's Supabase session.

export const config = { runtime: 'edge' }

import { discord, explain } from '../_lib/discord'
import { env, guard, HttpError, json } from '../_lib/env'
import { db, log, requireOwner } from '../_lib/supabase'
import type { DiscordChannel, DiscordLink, DiscordSchedule, WeekPost } from '../_lib/supabase'
import { addDays, localNow, mondayOf } from '../_lib/time'
import { buildWeekMessage, COMPONENTS_V2, ensureWeekPost, fetchBotWeek } from '../_lib/week'
import { buildUpdateCard, drainOutbox, updatesChannel } from '../_lib/updates'
import type { OutboxRow } from '../_lib/updates'

export default function handler(req: Request): Promise<Response> {
  return guard(async () => {
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed')
    const body = (await req.json().catch(() => ({}))) as { team?: string; action?: string; which?: string }
    const teamId = body.team ?? ''
    const user = await requireOwner(req, teamId)
    const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` })
    if (!link) throw new HttpError(409, 'not connected')

    if (body.action === 'test') return json(await test(teamId))
    if (body.action === 'test_dm') return json(await testDm(teamId, user.id, link))
    if (body.action === 'post') return json(await postNow(teamId, body.which === 'next' ? 'next' : 'this'))
    if (body.action === 'preview') return json(await preview(teamId, user.id))
    if (body.action === 'sample_change') return json(await sampleChange(teamId, user.id))
    if (body.action === 'flush') return json(await flush(teamId))
    if (body.action === 'ping_me') return json(await pingMe(teamId, user.id, link))
    if (body.action === 'disconnect') return json(await disconnect(teamId, link))
    throw new HttpError(400, 'unknown action')
  })
}

/** The owner's Discord id, or a clear error when the profile has none yet. */
async function ownDiscordId(userId: string): Promise<string> {
  const profile = await db.one<{ discord_id: string | null }>('profiles', { user_id: `eq.${userId}`, select: 'discord_id' })
  if (!profile?.discord_id) throw new HttpError(409, 'Your Discord account is not linked to your profile yet. Sign out and in again, then retry.')
  return profile.discord_id
}

/** Open (or find) the DM with one person and post there. */
async function dm(discordId: string, msg: Record<string, unknown>) {
  const ch = await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: discordId })
  await discord('POST', `/channels/${ch.id}/messages`, { ...msg, allowed_mentions: { parse: [] } })
}

/** A card with the small grey "test" line at the bottom, so nobody mistakes it for the real thing. */
function markTest(msg: Record<string, unknown>): Record<string, unknown> {
  const comps = (msg.components as { type: number; components?: Record<string, unknown>[] }[]).map((c) =>
    c.type === 17 && c.components
      ? {
          ...c,
          // Buttons on a sample would point at nothing. Drop them, add the label.
          components: [...c.components.filter((b) => b.type !== 1), { type: 10, content: '-# Test from Settings · nothing real was changed' }],
        }
      : c,
  )
  return { ...msg, components: comps }
}

/** The week plan as it looks right now, to the owner's DMs only. Nobody else sees a thing. */
async function preview(teamId: string, userId: string) {
  const me = await ownDiscordId(userId)
  const team = await db.one<{ timezone: string }>('teams', { id: `eq.${teamId}`, select: 'timezone' })
  if (!team) throw new HttpError(404, 'team not found')
  const week = await fetchBotWeek(teamId, mondayOf(localNow(team.timezone).dateKey))
  if (!week) throw new HttpError(404, 'team not found')
  try {
    await dm(me, markTest(buildWeekMessage(week, { ping: null, link: null, appUrl: env.appUrl() })))
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
  await log(teamId, 'test', 'Week plan preview sent as a DM', true)
  return { ok: true }
}

/**
 * A made-up "Moved" card, delivered the way changes are set to go: the channel,
 * a DM to the owner, or both. Real sessions are not touched, and only the
 * owner is mentioned.
 */
async function sampleChange(teamId: string, userId: string) {
  const me = await ownDiscordId(userId)
  const [team, schedule, channel] = await Promise.all([
    db.one<{ timezone: string; name: string }>('teams', { id: `eq.${teamId}`, select: 'timezone,name' }),
    db.one<DiscordSchedule>('discord_schedules', { team_id: `eq.${teamId}` }),
    updatesChannel(teamId),
  ])
  if (!team || !schedule) throw new HttpError(404, 'team not found')
  if (!channel) throw new HttpError(409, 'Pick a channel first.')
  const today = localNow(team.timezone).dateKey
  const before = { id: 'sample', date: addDays(today, 1), start_hour: 20, end_hour: 23, title: 'Scrim', opponent: 'Sample FC', color: 'yellow' }
  const row: OutboxRow = { id: 0, team_id: teamId, kind: 'changed', event_id: '00000000-0000-4000-8000-000000000000', payload: { before, after: { ...before, date: addDays(today, 2) } }, send_after: '', attempts: 0, sent_at: null, message_id: null }
  const card = markTest(buildUpdateCard(row, team.timezone, [me]))
  const mode = schedule.updates_mode
  const where: string[] = []
  try {
    if (mode === 'channel' || mode === 'both') {
      await discord('POST', `/channels/${channel}/messages`, card)
      where.push('channel')
    }
    if (mode === 'dm' || mode === 'both') {
      await dm(me, markTest(buildUpdateCard(row, team.timezone, [me], { team: team.name, me })))
      where.push('DM')
    }
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
  await log(teamId, 'test', `Sample change sent (${where.join(' + ')})`, true)
  return { ok: true, where }
}

/** Run the clock for this team now: refresh the week plan, send what is queued. */
async function flush(teamId: string) {
  const team = await db.one<{ timezone: string }>('teams', { id: `eq.${teamId}`, select: 'timezone' })
  if (!team) throw new HttpError(404, 'team not found')
  const live = await db.one<WeekPost>('discord_week_post', { team_id: `eq.${teamId}` })
  let week: string = 'no post'
  if (live) {
    try {
      week = (await ensureWeekPost(teamId, live.week_start, 'refresh')).action
    } catch (err) {
      week = `error: ${explain(err)}`
    }
  }
  const updates = await drainOutbox(20, teamId)
  const sent = Object.values(updates).filter((v) => v === 'sent').length
  const errors = Object.values(updates).filter((v) => v.startsWith('error')).length
  return { week, sent, errors, detail: updates }
}

/** A card that mentions only the owner, in the updates channel. Proves the mention renders and notifies. */
async function pingMe(teamId: string, userId: string, link: DiscordLink) {
  const me = await ownDiscordId(userId)
  const channel = await updatesChannel(teamId)
  if (!channel) throw new HttpError(409, 'Pick a channel first.')
  try {
    await discord('POST', `/channels/${channel}/messages`, {
      flags: COMPONENTS_V2,
      components: [
        {
          type: 17,
          accent_color: 0x3e9a63,
          components: [{ type: 10, content: `**Ping test**\n<@${me}>\n-# Only you were mentioned. When the bot pings ${link.ping_mode === 'role' ? 'the team role' : 'the team'}, everyone on it gets this.` }],
        },
      ],
      allowed_mentions: { parse: [], users: [me] },
    })
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
  await log(teamId, 'test', 'Ping test sent', true)
  return { ok: true }
}

async function test(teamId: string) {
  const [team, channels] = await Promise.all([
    db.one<{ name: string }>('teams', { id: `eq.${teamId}`, select: 'name' }),
    db.select<DiscordChannel>('discord_channels', { team_id: `eq.${teamId}` }),
  ])
  const targets = new Map<string, string[]>()
  for (const c of channels) targets.set(c.channel_id, [...(targets.get(c.channel_id) ?? []), c.kind])
  if (targets.size === 0) throw new HttpError(409, 'Pick at least one channel first.')

  const sent: string[] = []
  const failed: { kind: string; reason: string }[] = []
  for (const [channelId, kinds] of targets) {
    const what = kinds.map((k) => (k === 'schedule' ? 'the week plan' : k)).join(' and ')
    try {
      await discord('POST', `/channels/${channelId}/messages`, {
        flags: COMPONENTS_V2,
        components: [
          {
            type: 17,
            accent_color: 0x3e9a63,
            components: [{ type: 10, content: `**Gather is connected to ${team?.name ?? 'the team'}.**\n-# This channel gets ${what}. Nothing else will be posted until the week is up.` }],
          },
        ],
        allowed_mentions: { parse: [] },
      })
      sent.push(channelId)
    } catch (err) {
      failed.push({ kind: kinds.join(', '), reason: explain(err) })
    }
  }
  const summary = failed.length ? `Test message failed for ${failed.map((f) => f.kind).join(', ')}` : `Test message sent to ${sent.length} channel${sent.length === 1 ? '' : 's'}`
  await log(teamId, 'test', summary, failed.length === 0, failed.map((f) => f.reason).join(' ') || undefined)
  return { sent: sent.length, failed }
}

/**
 * A DM to the person pressing the button. Two Discord calls: open (or find) the
 * DM channel, then post in it. The interesting outcome is the failure: 50007
 * means their privacy settings block DMs from this server, which is exactly
 * what the reminders will run into for some players.
 */
async function testDm(teamId: string, userId: string, link: DiscordLink) {
  const profile = await db.one<{ discord_id: string | null }>('profiles', { user_id: `eq.${userId}`, select: 'discord_id' })
  if (!profile?.discord_id) throw new HttpError(409, 'Your Discord account is not linked to your profile yet. Sign out and in again, then retry.')
  const team = await db.one<{ name: string }>('teams', { id: `eq.${teamId}`, select: 'name' })
  try {
    const dm = await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: profile.discord_id })
    await discord('POST', `/channels/${dm.id}/messages`, {
      flags: COMPONENTS_V2,
      components: [
        {
          type: 17,
          accent_color: 0x3e9a63,
          components: [{ type: 10, content: `**Test from Gather.**\n-# Reminders for ${team?.name ?? 'the team'} on ${link.guild_name ?? 'Discord'} will look like this. Nothing else was sent.` }],
        },
      ],
      allowed_mentions: { parse: [] },
    })
    await log(teamId, 'test', 'Test DM sent', true)
    return { ok: true }
  } catch (err) {
    const reason = explain(err)
    await log(teamId, 'test', 'Test DM failed', false, reason)
    throw new HttpError(409, reason)
  }
}

async function postNow(teamId: string, which: 'this' | 'next') {
  const team = await db.one<{ timezone: string }>('teams', { id: `eq.${teamId}`, select: 'timezone' })
  if (!team) throw new HttpError(404, 'team not found')
  const today = localNow(team.timezone).dateKey
  const monday = mondayOf(which === 'next' ? addDays(today, 7) : today)
  try {
    return await ensureWeekPost(teamId, monday, 'manual')
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
}

async function disconnect(teamId: string, link: DiscordLink) {
  // Take the living post down so a dead week does not stay pinned.
  const post = await db.one<WeekPost>('discord_week_post', { team_id: `eq.${teamId}` })
  if (post) {
    try {
      await discord('DELETE', `/channels/${post.channel_id}/messages/pins/${post.message_id}`)
    } catch {
      /* fine */
    }
    try {
      await discord('DELETE', `/channels/${post.channel_id}/messages/${post.message_id}`)
    } catch {
      /* fine */
    }
  }
  if (link.managed_role && link.ping_role_id) {
    try {
      await discord('DELETE', `/guilds/${link.guild_id}/roles/${link.ping_role_id}`)
    } catch {
      /* already gone, or no permission: not worth blocking the disconnect */
    }
  }
  await db.remove('discord_week_post', { team_id: `eq.${teamId}` })
  await db.remove('discord_channels', { team_id: `eq.${teamId}` })
  await db.remove('discord_schedules', { team_id: `eq.${teamId}` })
  await db.remove('discord_links', { team_id: `eq.${teamId}` })
  await log(teamId, 'link', `Disconnected from ${link.guild_name ?? 'Discord'}`, true)

  // Several teams can share one server, with one bot between them. The bot
  // leaves only when the last of them is gone; until then it is still working
  // for someone. Channels are never touched: they belong to the server.
  const others = await db.select<{ team_id: string }>('discord_links', { select: 'team_id', guild_id: `eq.${link.guild_id}` })
  let left = false
  if (others.length === 0) {
    try {
      await discord('DELETE', `/users/@me/guilds/${link.guild_id}`)
      left = true
    } catch {
      /* already kicked, or no such server any more */
    }
  }
  return { ok: true, left, remaining: others.length }
}

// Owner actions that need the bot token: post the week now, send a test
// message, disconnect. POST with { action } and the owner's Supabase session.

export const config = { runtime: 'edge' }

import { discord, explain } from '../_lib/discord'
import { guard, HttpError, json } from '../_lib/env'
import { db, log, requireOwner } from '../_lib/supabase'
import type { DiscordChannel, DiscordLink, WeekPost } from '../_lib/supabase'
import { addDays, localNow, mondayOf } from '../_lib/time'
import { COMPONENTS_V2, ensureWeekPost } from '../_lib/week'

export default function handler(req: Request): Promise<Response> {
  return guard(async () => {
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed')
    const body = (await req.json().catch(() => ({}))) as { team?: string; action?: string; which?: string }
    const teamId = body.team ?? ''
    await requireOwner(req, teamId)
    const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` })
    if (!link) throw new HttpError(409, 'not connected')

    if (body.action === 'test') return json(await test(teamId))
    if (body.action === 'post') return json(await postNow(teamId, body.which === 'next' ? 'next' : 'this'))
    if (body.action === 'disconnect') return json(await disconnect(teamId, link))
    throw new HttpError(400, 'unknown action')
  })
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
  return { ok: true }
}

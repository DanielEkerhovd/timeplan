// Owner actions that need the bot token: post the week now, send a test
// message, disconnect. POST with { action } and the owner's Supabase session.

export const config = { runtime: 'edge' }

import { discord, explain, leaveGuild } from '../_lib/discord'
import { env, guard, HttpError, json } from '../_lib/env'
import { db, log, requireEditor, requireOwner, requireUser, throttle } from '../_lib/supabase'
import type { DiscordChannel, DiscordLink, DiscordSchedule, WeekPost } from '../_lib/supabase'
import { addDays, localNow, mondayOf } from '../_lib/time'
import { buildWeekMessage, COMPONENTS_V2, ensureWeekPost, fetchBotWeek } from '../_lib/week'
import { buildUpdateCard, drainOutbox } from '../_lib/updates'
import { buildReminderCard } from '../_lib/updateCard'
import { remindNow } from '../_lib/reminders'
import { nudgeNow } from '../_lib/nudge'
import type { OutboxRow } from '../_lib/updates'

export default function handler(req: Request): Promise<Response> {
  return guard(async () => {
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed')
    const body = (await req.json().catch(() => ({}))) as { team?: string; action?: string; which?: string; event_id?: string; outbox_id?: number }
    const teamId = body.team ?? ''
    // "Send a reminder now" belongs to whoever books sessions: owner or admin.
    // Everything else here is the owner's.
    if (body.action === 'remind') {
      await requireEditor(req, teamId)
      await throttle(teamId)
      const eventId = String(body.event_id ?? '')
      if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new HttpError(400, 'bad event id')
      return json(await remindNow(teamId, eventId))
    }
    // Any signed-in person can ask the bot to DM them. It reaches only their
    // own inbox, so there is nothing here to gate on a team or a role.
    if (body.action === 'my_dm') return json(await myDm(req))
    const user = await requireOwner(req, teamId)
    const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` })
    if (!link) throw new HttpError(409, 'not connected')
    if (body.action !== 'disconnect') await throttle(teamId)

    if (body.action === 'test') return json(await test(teamId))
    if (body.action === 'test_dm') return json(await testDm(teamId, user.id, link))
    if (body.action === 'post') return json(await postNow(teamId, body.which === 'next' ? 'next' : 'this'))
    if (body.action === 'self_check') return json(await selfCheck(teamId, user.id))
    if (body.action === 'nudge_now') return json(await nudgeNow(teamId))
    if (body.action === 'outbox_send') return json(await outboxSend(teamId, body.outbox_id))
    if (body.action === 'outbox_cancel') return json(await outboxCancel(teamId, body.outbox_id))
    if (body.action === 'flush') return json(await flush(teamId))
    if (body.action === 'disconnect') return json(await disconnect(teamId, link))
    throw new HttpError(400, 'unknown action')
  })
}

/**
 * "Can the bot reach me?" from a person's own profile. Discord's DM privacy
 * setting is per person and fails silently, so the player who is missing
 * messages needs to be able to check it themselves.
 */
async function myDm(req: Request) {
  const user = await requireUser(req)
  const me = await ownDiscordId(user.id)
  try {
    await dm(me, {
      flags: COMPONENTS_V2,
      components: [{ type: 17, components: [{ type: 10, content: "## The bot can reach you\nReminders and changes will land here.\n-# Sent from your profile in Gather" }] }],
    })
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
  return { ok: true }
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


/**
 * Everything the bot sends, to the owner's own DMs: the week as it stands, a
 * made-up change, a made-up reminder. Nothing is posted where the team reads —
 * a fake "Moved · Scrim vs Sample FC" in the updates channel is noise somebody
 * has to scroll past and wonder about.
 */
async function selfCheck(teamId: string, userId: string) {
  const me = await ownDiscordId(userId)
  const team = await db.one<{ timezone: string; name: string }>('teams', { id: `eq.${teamId}`, select: 'timezone,name' })
  if (!team) throw new HttpError(404, 'team not found')
  const today = localNow(team.timezone).dateKey
  const week = await fetchBotWeek(teamId, mondayOf(today))

  const before = { id: 'sample', date: addDays(today, 1), start_hour: 20, end_hour: 23, title: 'Scrim', opponent: 'Sample FC', color: 'yellow' }
  const moved: OutboxRow = { id: 0, team_id: teamId, kind: 'changed', event_id: '00000000-0000-4000-8000-000000000000', payload: { before, after: { ...before, date: addDays(today, 2) } }, send_after: '', attempts: 0, sent_at: null, message_id: null }
  const soon = { id: '00000000-0000-4000-8000-000000000000', date: today, start_hour: 20, end_hour: 23, title: 'Scrim', opponent: 'Sample FC', color: 'yellow' }

  const cards: Record<string, unknown>[] = []
  if (week) cards.push(markTest(buildWeekMessage(week, { ping: null, link: null, appUrl: env.appUrl() })))
  cards.push(markTest(buildUpdateCard(moved, team.timezone, [me], { team: team.name, me })))
  cards.push(markTest(buildReminderCard(soon, team.timezone, [me], today, { team: team.name, me })))

  try {
    for (const c of cards) await dm(me, c)
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
  await log(teamId, 'test', `Check sent as ${cards.length} DMs`, true)
  return { ok: true, sent: cards.length }
}



/** One queued change, sent now instead of waiting out its two minutes. */
async function outboxSend(teamId: string, id?: number) {
  const row = await pendingRow(teamId, id)
  const out = await drainOutbox(1, teamId, row.id)
  const result = Object.values(out)[0] ?? 'nothing to send'
  if (result.startsWith('error')) throw new HttpError(409, result.slice(7))
  return { ok: true, result }
}

/** One queued change, thrown away before anyone sees it. */
async function outboxCancel(teamId: string, id?: number) {
  const row = await pendingRow(teamId, id)
  await db.remove('discord_outbox', { id: `eq.${row.id}`, team_id: `eq.${teamId}` })
  return { ok: true, result: 'cancelled' }
}

/** The queued row, checked against the team in the request. Never trust the id alone. */
async function pendingRow(teamId: string, id?: number) {
  if (!Number.isInteger(id) || (id as number) < 1) throw new HttpError(400, 'bad message id')
  const row = await db.one<OutboxRow>('discord_outbox', { id: `eq.${id}`, team_id: `eq.${teamId}`, sent_at: 'is.null' })
  if (!row) throw new HttpError(404, 'That message has already gone out, or is no longer waiting.')
  return row
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
  // Nothing sent and nothing failed is the confusing case. Say which of the
  // three reasons it was, instead of leaving a silent zero.
  let why: string | undefined
  if (sent === 0 && errors === 0) {
    const [schedule, pending] = await Promise.all([
      db.one<DiscordSchedule>('discord_schedules', { team_id: `eq.${teamId}` }),
      db.select<{ id: number }>('discord_outbox', { select: 'id', team_id: `eq.${teamId}`, sent_at: 'is.null', limit: '1' }),
    ])
    if (!schedule?.updates_enabled) why = 'Change messages are turned off for this team.'
    else if (pending.length > 0) why = 'Something is waiting, but it could not go out. Check the log.'
    else if (!live) why = 'Nothing was waiting. New and changed sessions are only announced for the week that is posted — post the week first.'
    else why = 'Nothing was waiting.'
  }
  await log(teamId, 'test', `Sent what was waiting: week ${week}, ${sent} sent, ${errors} failed`, errors === 0)
  return { week, sent, errors, why, detail: updates }
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
    const r = await ensureWeekPost(teamId, monday, 'manual')
    // "posted" logs itself; the other outcomes leave a row too, so the throttle sees every press.
    if (r.action !== 'posted') await log(teamId, 'week_post', `Post now: ${r.action}${r.detail ? ` (${r.detail})` : ''}`, r.action !== 'skipped')
    return r
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
  let leaveError: string | null = null
  if (others.length === 0) {
    leaveError = await leaveGuild(link.guild_id)
    left = leaveError === null
    // The team's rows are gone by now, so this cannot land in its log. Vercel's log has it, and the clock retries.
    if (leaveError) console.error(`[discord/disconnect] could not leave ${link.guild_id}: ${leaveError}`)
  }
  return { ok: true, left, remaining: others.length, leaveError }
}

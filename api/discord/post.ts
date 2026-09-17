// Actions that need the bot token: post the week now, run the wizard's test,
// send or cancel a queued change, nudge, disconnect. POST with { action } and
// the caller's Supabase session; every branch checks who is asking.

export const config = { runtime: 'edge' }

import { discord, explain, leaveGuild } from '../_lib/discord'
import { guard, HttpError, json } from '../_lib/env'
import { db, log, requireEditor, requireOwner, requireUser, throttle } from '../_lib/supabase'
import { forget, postAndRecord, wipeMessages } from '../_lib/sent'
import type { DiscordChannel, DiscordLink, WeekPost } from '../_lib/supabase'
import { addDays, localNow, mondayOf } from '../_lib/time'
import { COMPONENTS_V2, ensureWeekPost } from '../_lib/week'
import { drainOutbox } from '../_lib/updates'
import { remindNow } from '../_lib/reminders'
import { nudgeNow } from '../_lib/nudge'
import type { OutboxRow } from '../_lib/updates'

export default function handler(req: Request): Promise<Response> {
  return guard(async () => {
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed')
    const body = (await req.json().catch(() => ({}))) as { team?: string; action?: string; which?: string; event_id?: string; outbox_id?: number; confirm?: string }
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
    await requireOwner(req, teamId)
    const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` })
    if (!link) throw new HttpError(409, 'not connected')
    // Opprydding og frakobling går utenom: de er eierens egne, store grep, og
    // oppryddingen holder farten selv mellom hver sletting.
    if (body.action !== 'disconnect' && body.action !== 'wipe') await throttle(teamId)

    if (body.action === 'test') return json(await test(teamId))
    if (body.action === 'post') return json(await postNow(teamId, body.which === 'next' ? 'next' : 'this'))
    if (body.action === 'nudge_now') return json(await nudgeNow(teamId))
    if (body.action === 'outbox_send') return json(await outboxSend(teamId, body.outbox_id))
    if (body.action === 'outbox_cancel') return json(await outboxCancel(teamId, body.outbox_id))
    if (body.action === 'disconnect') return json(await disconnect(teamId, link))
    if (body.action === 'wipe') return json(await wipe(teamId, body.confirm))
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
      await postAndRecord(
        teamId,
        channelId,
        {
          flags: COMPONENTS_V2,
          components: [
            {
              type: 17,
              accent_color: 0x3e9a63,
              components: [{ type: 10, content: `**Gather is connected to ${team?.name ?? 'the team'}.**\n-# This channel gets ${what}. Nothing else will be posted until the week is up.` }],
            },
          ],
          allowed_mentions: { parse: [] },
        },
        'test',
      )
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
    const r = await ensureWeekPost(teamId, monday, 'manual')
    // "posted" logs itself; the other outcomes leave a row too, so the throttle sees every press.
    if (r.action !== 'posted') await log(teamId, 'week_post', `Post now: ${r.action}${r.detail ? ` (${r.detail})` : ''}`, r.action !== 'skipped')
    return r
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
}

/**
 * Ta ned alt boten har lagt ut for dette laget. Én bunke per kall; appen
 * kaller til `remaining` er 0, slik at en lang historikk ikke må ryddes
 * innenfor levetiden til én funksjon.
 *
 * Bekreftelsen er lagets eget navn, skrevet av eieren. Ikke fordi noen andre
 * kommer forbi requireOwner, men fordi dette ikke kan gjøres om igjen, og et
 * uhell med musepekeren skal ikke holde.
 */
async function wipe(teamId: string, confirm?: string) {
  const team = await db.one<{ name: string }>('teams', { id: `eq.${teamId}`, select: 'name' })
  if (!team) throw new HttpError(404, 'team not found')
  if ((confirm ?? '').trim().toLowerCase() !== team.name.trim().toLowerCase()) {
    throw new HttpError(400, `Type the team name (${team.name}) to confirm.`)
  }
  const r = await wipeMessages(teamId)
  if (r.stopped && r.deleted === 0) throw new HttpError(409, r.stopped)
  return r
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
    await forget(post.message_id)
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

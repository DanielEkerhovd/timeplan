// Change messages: cards in the updates channel (and/or DMs) when a session is
// added, moved, changed or cancelled. The database queues them (discord_outbox,
// 0019/0020) with a two-minute wait so a burst of edits becomes one card; the
// cron drains the queue here.

import { channelInGuild, discord, DiscordError, explain } from './discord'
import { db, log } from './supabase'
import type { DiscordChannel, DiscordLink, DiscordSchedule } from './supabase'
import { buildNewSessionsCard, buildUpdateCard, forPeople, forRole, silent, title } from './updateCard'
import type { Audience, OutboxRow } from './updateCard'

export { buildUpdateCard, buildNewSessionsCard }
export type { OutboxRow, Snapshot } from './updateCard'

/** Discord ids of the people who currently say yes to a session. Empty once it is gone. */
export async function peopleFor(eventId: string): Promise<string[]> {
  try {
    return (await db.rpc<string[] | null>('discord_event_people', { ev: eventId })) ?? []
  } catch {
    return []
  }
}

/** Everyone on the team with a Discord account. `forDm` leaves out those Discord refuses DMs to. */
async function teamPeople(teamId: string, forDm: boolean): Promise<string[]> {
  try {
    return (await db.rpc<string[] | null>('discord_team_people', { team: teamId, for_dm: forDm })) ?? []
  } catch {
    return []
  }
}

/** Where change messages go: the updates channel, else the week-plan channel. */
export async function updatesChannel(teamId: string): Promise<string | null> {
  const rows = await db.select<DiscordChannel>('discord_channels', { team_id: `eq.${teamId}` })
  return rows.find((c) => c.kind === 'updates')?.channel_id ?? rows.find((c) => c.kind === 'schedule')?.channel_id ?? null
}

interface TeamCtx {
  link: DiscordLink
  schedule: DiscordSchedule
  timezone: string
  name: string
  channel: string
}

async function teamCtx(teamId: string): Promise<TeamCtx | null> {
  const [link, schedule, team, channel] = await Promise.all([
    db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` }),
    db.one<DiscordSchedule>('discord_schedules', { team_id: `eq.${teamId}` }),
    db.one<{ timezone: string; name: string }>('teams', { id: `eq.${teamId}`, select: 'timezone,name' }),
    updatesChannel(teamId),
  ])
  if (!link || !schedule || !team || !channel) return null
  // One check per team per run: the channel must be in the linked server.
  if (!(await channelInGuild(channel, link.guild_id))) {
    await log(teamId, 'update', 'The updates channel is not in the connected server. Pick it again in Settings.', false)
    return null
  }
  return { link, schedule, timezone: team.timezone, name: team.name, channel }
}

/**
 * A DM to each person, written for that person. Discord refusing (50007:
 * their privacy settings) is not an error to retry, it is a fact to remember:
 * the person is marked, skipped next time, and handed back so the caller can
 * ping them in the channel instead.
 */
async function sendDms(people: string[], msgFor: (id: string) => Record<string, unknown>): Promise<{ sent: string[]; blocked: string[] }> {
  const sent: string[] = []
  const blocked: string[] = []
  for (const id of people) {
    try {
      const dm = await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: id })
      await discord('POST', `/channels/${dm.id}/messages`, { ...msgFor(id), allowed_mentions: { parse: [] } })
      sent.push(id)
    } catch (err) {
      if (err instanceof DiscordError && err.code === 50007) {
        blocked.push(id)
        await db.update('profiles', { discord_id: `eq.${id}` }, { dm_blocked_at: new Date().toISOString() }).catch(() => undefined)
      } else {
        throw err
      }
    }
  }
  return { sent, blocked }
}

/**
 * Deliver one card the way the team chose. Channel: post it. DM: one per
 * person, and whoever could not be reached gets pinged in the channel after
 * all. Both: the channel card and the DMs.
 */
async function deliver(ctx: TeamCtx, card: Record<string, unknown>, audience: Audience, dmTo: string[], dmCard: (me: string) => Record<string, unknown>): Promise<string | null> {
  const mode = ctx.schedule.updates_mode
  let messageId: string | null = null
  if (mode === 'channel' || mode === 'both') {
    const posted = await discord<{ id: string }>('POST', `/channels/${ctx.channel}/messages`, card)
    messageId = posted.id
  }
  if (mode === 'dm' || mode === 'both') {
    const { blocked } = await sendDms(dmTo, dmCard)
    if (mode === 'dm' && (blocked.length || dmTo.length === 0)) {
      // DM-only, but some (or all) could not be reached: the channel is the fallback, pinging only them.
      const fallback = blocked.length ? forPeople(blocked) : audience
      const posted = await discord<{ id: string }>('POST', `/channels/${ctx.channel}/messages`, { ...card, allowed_mentions: { parse: [], users: fallback.users, roles: fallback.roles } })
      messageId = posted.id
    }
  }
  return messageId
}

const KIND_LABEL = { new: 'New', changed: 'Changed', cancelled: 'Cancelled' } as const

async function fail(row: OutboxRow, err: unknown): Promise<string> {
  const reason = explain(err)
  // Rate-limited by Discord: not this row's fault, and not an attempt. Wait a
  // minute and try again, so a noisy team cannot get another team's
  // messages dropped.
  if (err instanceof DiscordError && err.status === 429) {
    await db.update('discord_outbox', { id: `eq.${row.id}` }, { last_error: reason.slice(0, 500), send_after: new Date(Date.now() + 60_000).toISOString() })
    return 'rate limited'
  }
  const attempts = row.attempts + 1
  await db.update('discord_outbox', { id: `eq.${row.id}` }, {
    attempts,
    last_error: reason.slice(0, 500),
    send_after: new Date(Date.now() + attempts * 5 * 60_000).toISOString(),
  })
  if (attempts >= 5) await log(row.team_id, 'update', 'Could not post a change after five tries', false, reason)
  return `error: ${reason}`
}

async function done(rows: OutboxRow[], messageId: string | null) {
  const now = new Date().toISOString()
  for (const r of rows) await db.update('discord_outbox', { id: `eq.${r.id}` }, { sent_at: now, message_id: messageId, last_error: null })
}

/**
 * Send what is due. At most `limit` rows per call, oldest first. New sessions
 * for the same team go out as one card with one ping. A failure counts an
 * attempt and pushes the row back; after five it is left alone and shows up
 * in the team's log.
 */
export async function drainOutbox(limit = 20, onlyTeam?: string): Promise<Record<string, string>> {
  const due = await db.select<OutboxRow>('discord_outbox', {
    sent_at: 'is.null',
    // "Send what's waiting now" from Settings skips the two-minute wait; the clock respects it.
    ...(onlyTeam ? { team_id: `eq.${onlyTeam}` } : { send_after: `lte.${new Date().toISOString()}` }),
    attempts: 'lt.5',
    order: 'send_after.asc',
    limit: String(limit),
  })
  const out: Record<string, string> = {}
  const ctxs = new Map<string, TeamCtx | null>()
  const ctxFor = async (teamId: string) => {
    if (!ctxs.has(teamId)) ctxs.set(teamId, await teamCtx(teamId))
    return ctxs.get(teamId) ?? null
  }

  // 1. New sessions, grouped per team.
  const newByTeam = new Map<string, OutboxRow[]>()
  for (const r of due) if (r.kind === 'new') newByTeam.set(r.team_id, [...(newByTeam.get(r.team_id) ?? []), r])
  for (const [teamId, rows] of newByTeam) {
    const ctx = await ctxFor(teamId)
    if (!ctx) {
      await done(rows, null)
      out[`${teamId}:new`] = 'dropped'
      continue
    }
    for (let i = 0; i < rows.length; i += 5) {
      const batch = rows.slice(i, i + 5)
      try {
        const audience = ctx.link.ping_mode === 'role' && ctx.link.ping_role_id ? forRole(ctx.link.ping_role_id) : forPeople(await teamPeople(teamId, false))
        const card = buildNewSessionsCard(batch, ctx.timezone, audience)
        const dmCard = (me: string) => buildNewSessionsCard(batch, ctx.timezone, silent, [], { team: ctx.name, me })
        const messageId = await deliver(ctx, card, audience, await teamPeople(teamId, true), dmCard)
        await done(batch, messageId)
        await log(teamId, 'update', batch.length === 1 && batch[0].payload.after ? `New: ${title(batch[0].payload.after)}` : `${batch.length} new sessions`, true)
        out[`${teamId}:new`] = 'sent'
      } catch (err) {
        for (const r of batch) out[`${teamId}:${r.event_id}`] = await fail(r, err)
      }
    }
  }

  // 2. Moves and cancellations, one card each, to the people they concern.
  for (const row of due) {
    if (row.kind === 'new') continue
    const key = `${row.team_id}:${row.event_id}`
    const ctx = await ctxFor(row.team_id)
    if (!ctx) {
      await done([row], null)
      out[key] = 'dropped'
      continue
    }
    try {
      const people = row.kind === 'cancelled' ? (row.payload.people ?? []) : await peopleFor(row.event_id)
      const card = buildUpdateCard(row, ctx.timezone, people)
      const audience = people.length ? forPeople(people) : silent
      const dmTo = people.length ? (await teamPeople(row.team_id, true)).filter((id) => people.includes(id)) : []
      const dmCard = (me: string) => buildUpdateCard(row, ctx.timezone, people, { team: ctx.name, me })
      const messageId = await deliver(ctx, card, audience, dmTo, dmCard)
      await done([row], messageId)
      const what = row.payload.after ?? row.payload.before
      await log(row.team_id, 'update', `${KIND_LABEL[row.kind]}: ${what ? title(what) : 'session'}`, true)
      out[key] = 'sent'
    } catch (err) {
      out[key] = await fail(row, err)
    }
  }

  await db.rpc('discord_outbox_prune', {}).catch(() => undefined)
  return out
}

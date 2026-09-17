// The reminder before a session. The clock asks the database for sessions that
// might be due (discord_reminder_candidates, 0023), works out each one's start
// on the team's clock, and sends when the team's "hours before" has been
// reached. One send per session: the row is stamped, and the stamp is cleared
// by a trigger if the session moves.

import { channelInGuild, discord, DiscordError, explain } from './discord'
import { db, log } from './supabase'
import { HttpError } from './env'
import type { DiscordChannel, DiscordLink } from './supabase'
import { localNow, localToInstant } from './time'
import { buildReminderCard } from './updateCard'
import type { Snapshot } from './updateCard'

interface Candidate {
  event_id: string
  team_id: string
  timezone: string
  team_name: string
  date: string
  start_hour: number
  end_hour: number
  title: string
  opponent: string | null
  color: string
  hours_before: number
  mode: 'channel' | 'dm' | 'both'
}

/** Where reminders land: the reminders channel, else updates, else the week plan. */
async function reminderChannel(teamId: string): Promise<string | null> {
  const rows = await db.select<DiscordChannel>('discord_channels', { team_id: `eq.${teamId}` })
  const pick = (k: DiscordChannel['kind']) => rows.find((c) => c.kind === k)?.channel_id
  return pick('reminders') ?? pick('updates') ?? pick('schedule') ?? null
}

async function people(eventId: string): Promise<string[]> {
  try {
    return (await db.rpc<string[] | null>('discord_event_people', { ev: eventId })) ?? []
  } catch {
    return []
  }
}

async function dmable(teamId: string): Promise<Set<string>> {
  try {
    return new Set((await db.rpc<string[] | null>('discord_team_people', { team: teamId, for_dm: true })) ?? [])
  } catch {
    return new Set()
  }
}

/**
 * Send what is due. Returns one line per session it looked at. A session
 * nobody has said yes to is stamped without a message: there is nobody to
 * remind, and it should not be checked every five minutes until it starts.
 */
export async function sendReminders(now = new Date()): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const rows = await db.rpc<Candidate[]>('discord_reminder_candidates', {})
  for (const c of rows) {
    const start = localToInstant(c.date, Number(c.start_hour), 0, c.timezone)
    const due = start.getTime() - Number(c.hours_before) * 3_600_000
    if (now.getTime() < due) continue
    if (now.getTime() >= start.getTime()) {
      // Too late: the window was missed (the bot was off, or the reminder was
      // turned on after the fact). Stamp and move on rather than nag mid-session.
      await stamp(c.event_id)
      out[c.event_id] = 'window passed'
      continue
    }
    try {
      out[c.event_id] = await sendOne(c, now)
    } catch (err) {
      const reason = explain(err)
      await log(c.team_id, 'reminder', `Could not send the reminder for ${c.title}`, false, reason)
      out[c.event_id] = `error: ${reason}`
      // Stamp anyway: a broken channel should not produce a failure every five minutes.
      if (err instanceof DiscordError) await stamp(c.event_id)
    }
  }
  return out
}

/**
 * "Send a reminder now" from the session's own form. Goes out at once to the
 * people who said yes, and stamps the session, so the scheduled one does not
 * follow. Works whether or not the team has reminders turned on; the team's
 * channel/DM choice still decides how.
 */
export async function remindNow(teamId: string, eventId: string): Promise<{ sent: string; people: number }> {
  const e = await db.one<{ id: string; team_id: string; date: string; start_hour: number; end_hour: number; title: string; opponent: string | null; color: string; activity_types: { name: string; color: string } | null }>('events', {
    id: `eq.${eventId}`,
    team_id: `eq.${teamId}`,
    select: 'id,team_id,date,start_hour,end_hour,title,opponent,color,activity_types(name,color)',
  })
  if (!e) throw new HttpError(404, 'That session is gone.')
  const [team, schedule] = await Promise.all([
    db.one<{ timezone: string; name: string }>('teams', { id: `eq.${teamId}`, select: 'timezone,name' }),
    db.one<{ same_day_mode: 'channel' | 'dm' | 'both' }>('discord_schedules', { team_id: `eq.${teamId}`, select: 'same_day_mode' }),
  ])
  if (!team || !schedule) throw new HttpError(409, 'The team is not connected to Discord.')
  const now = new Date()
  const start = localToInstant(e.date, Number(e.start_hour), 0, team.timezone)
  if (start.getTime() <= now.getTime()) throw new HttpError(409, 'That session has already started.')
  const c: Candidate = {
    event_id: e.id,
    team_id: teamId,
    timezone: team.timezone,
    team_name: team.name,
    date: e.date,
    start_hour: Number(e.start_hour),
    end_hour: Number(e.end_hour),
    title: e.activity_types?.name ?? e.title,
    opponent: e.opponent,
    color: e.activity_types?.color ?? e.color,
    hours_before: 0,
    mode: schedule.same_day_mode,
  }
  const who = await people(eventId)
  if (who.length === 0) throw new HttpError(409, 'Nobody has said yes to this session yet, so there is nobody to remind.')
  try {
    const sent = await sendOne(c, now)
    return { sent, people: who.length }
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
}

async function stamp(eventId: string) {
  await db.update('events', { id: `eq.${eventId}` }, { reminder_sent_at: new Date().toISOString() })
}

async function sendOne(c: Candidate, now: Date): Promise<string> {
  const who = await people(c.event_id)
  if (who.length === 0) {
    await stamp(c.event_id)
    return 'nobody in'
  }
  const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${c.team_id}` })
  const channel = await reminderChannel(c.team_id)
  if (!link || !channel) {
    await stamp(c.event_id)
    return 'no channel'
  }
  const snap: Snapshot = { id: c.event_id, date: c.date, start_hour: Number(c.start_hour), end_hour: Number(c.end_hour), title: c.title, opponent: c.opponent, color: c.color }
  const today = localNow(c.timezone, now).dateKey
  const card = buildReminderCard(snap, c.timezone, who, today)

  const sent: string[] = []
  let blocked: string[] = []
  if (c.mode === 'dm' || c.mode === 'both') {
    const ok = await dmable(c.team_id)
    for (const id of who) {
      if (!ok.has(id)) {
        blocked.push(id)
        continue
      }
      try {
        const dm = await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: id })
        await discord('POST', `/channels/${dm.id}/messages`, { ...buildReminderCard(snap, c.timezone, who, today, { team: c.team_name, me: id }), allowed_mentions: { parse: [] } })
        sent.push(id)
      } catch (err) {
        if (err instanceof DiscordError && err.code === 50007) {
          blocked.push(id)
          await db.update('profiles', { discord_id: `eq.${id}` }, { dm_blocked_at: new Date().toISOString() }).catch(() => undefined)
        } else throw err
      }
    }
  }
  if (c.mode === 'channel' || c.mode === 'both' || blocked.length) {
    // DM-only, but some could not be reached: the channel card pings only them.
    const pingOnly = c.mode === 'dm' ? blocked : who
    if (!(await channelInGuild(channel, link.guild_id))) throw new DiscordError(404, 10003, 'The reminder channel is not in the connected server.')
    await discord('POST', `/channels/${channel}/messages`, {
      ...card,
      allowed_mentions: { parse: [], users: pingOnly.slice(0, 100) },
    })
    blocked = []
  }
  await stamp(c.event_id)
  const summary = c.mode === 'dm' ? `Reminder: ${c.title} (DM to ${sent.length})` : c.mode === 'both' ? `Reminder: ${c.title} (channel + DM to ${sent.length})` : `Reminder: ${c.title} (channel)`
  await log(c.team_id, 'reminder', summary, true)
  return 'sent'
}

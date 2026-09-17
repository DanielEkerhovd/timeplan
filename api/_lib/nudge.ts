// The nudge for next week. On the team's chosen weekday and time, whoever has
// not marked a single hour for next week gets asked to. One per week per team:
// discord_nudge holds the week last nudged (0024). Everyone answered? The week
// is stamped and nobody is bothered.

import { channelInGuild, discord, DiscordError, explain } from './discord'
import { env, HttpError } from './env'
import { db, log } from './supabase'
import { postAndRecord } from './sent'
import type { DiscordLink, DiscordSchedule } from './supabase'
import { addDays, localNow, mondayOf, timeToMinutes } from './time'
import { buildNudgeCard } from './updateCard'
import type { Missing } from './updateCard'
import { dmable, notifyChannel } from './reminders'

interface Team {
  id: string
  name: string
  timezone: string
}

/** The week a nudge sent now is about: the one after the team's current week. */
const targetWeek = (todayKey: string) => addDays(mondayOf(todayKey), 7)

/** Send the nudges that are due. One line per team the clock looked at. */
export async function sendNudges(now = new Date()): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const schedules = await db.select<DiscordSchedule>('discord_schedules', { nudge_enabled: 'is.true' })
  if (schedules.length === 0) return out
  const ids = schedules.map((s) => s.team_id).join(',')
  const [teams, stamps] = await Promise.all([
    db.select<Team>('teams', { select: 'id,name,timezone', id: `in.(${ids})` }),
    db.select<{ team_id: string; week_start: string }>('discord_nudge', { team_id: `in.(${ids})` }),
  ])

  for (const s of schedules) {
    const team = teams.find((t) => t.id === s.team_id)
    if (!team) continue
    const clock = localNow(team.timezone, now)
    if (clock.isodow !== s.nudge_dow || clock.minutes < timeToMinutes(s.nudge_at)) continue
    const week = targetWeek(clock.dateKey)
    // Already done for this week. Missing the exact minute is fine; a second
    // nudge for the same week is not.
    if (stamps.find((x) => x.team_id === s.team_id)?.week_start === week) continue
    try {
      out[s.team_id] = await nudgeTeam(team, s.nudge_mode, week)
    } catch (err) {
      const reason = explain(err)
      await log(team.id, 'nudge', 'Could not send the nudge for next week', false, reason)
      out[s.team_id] = `error: ${reason}`
      // A broken channel should not fail every five minutes until Sunday.
      if (err instanceof DiscordError) await stamp(team.id, week)
    }
  }
  return out
}

/**
 * "Nudge them now" from Settings: the same message, off the clock. Stamps the
 * week, so the scheduled one does not follow.
 */
export async function nudgeNow(teamId: string): Promise<{ sent: string; missing: number }> {
  const team = await db.one<Team>('teams', { id: `eq.${teamId}`, select: 'id,name,timezone' })
  const schedule = await db.one<DiscordSchedule>('discord_schedules', { team_id: `eq.${teamId}` })
  if (!team || !schedule) throw new HttpError(409, 'The team is not connected to Discord.')
  const week = targetWeek(localNow(team.timezone).dateKey)
  const missing = await whoIsMissing(teamId, week)
  if (missing.length === 0) throw new HttpError(409, 'Everyone has marked next week already.')
  try {
    const sent = await nudgeTeam(team, schedule.nudge_mode, week)
    return { sent, missing: missing.length }
  } catch (err) {
    throw new HttpError(409, explain(err))
  }
}

async function whoIsMissing(teamId: string, week: string): Promise<Missing[]> {
  return (await db.rpc<Missing[] | null>('discord_nudge_missing', { team: teamId, week_start: week })) ?? []
}

async function stamp(teamId: string, week: string) {
  await db.upsert('discord_nudge', { team_id: teamId, week_start: week, sent_at: new Date().toISOString() }, 'team_id')
}

async function nudgeTeam(team: Team, mode: 'channel' | 'dm' | 'both', week: string): Promise<string> {
  const missing = await whoIsMissing(team.id, week)
  if (missing.length === 0) {
    await stamp(team.id, week)
    return 'everyone answered'
  }
  const members = await db.select<{ user_id: string }>('members', { select: 'user_id', team_id: `eq.${team.id}` })
  const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${team.id}` })
  const channel = await notifyChannel(team.id)
  if (!link || !channel) {
    await stamp(team.id, week)
    return 'no channel'
  }
  const card = buildNudgeCard({ weekStart: week, missing, total: members.length, appUrl: env.appUrl(), team: team.name })

  let blocked = 0
  if (mode === 'dm' || mode === 'both') {
    const ok = await dmable(team.id)
    const dmCard = buildNudgeCard({ weekStart: week, missing, total: members.length, appUrl: env.appUrl(), team: team.name }, true)
    for (const m of missing) {
      if (!m.discord_id || !ok.has(m.discord_id)) {
        blocked++
        continue
      }
      try {
        const dm = await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: m.discord_id })
        await postAndRecord(team.id, dm.id, { ...dmCard, allowed_mentions: { parse: [] } }, 'nudge', true)
      } catch (err) {
        if (err instanceof DiscordError && err.code === 50007) {
          blocked++
          await db.update('profiles', { discord_id: `eq.${m.discord_id}` }, { dm_blocked_at: new Date().toISOString() }).catch(() => undefined)
        } else throw err
      }
    }
  }
  // DM-only, but somebody could not be reached (no Discord account, or DMs
  // closed): the channel card names everyone missing, so nobody is forgotten.
  if (mode === 'channel' || mode === 'both' || blocked > 0) {
    if (!(await channelInGuild(channel, link.guild_id))) throw new DiscordError(404, 10003, 'The channel is not in the connected server.')
    await postAndRecord(team.id, channel, card, 'nudge')
  }
  await stamp(team.id, week)
  await log(team.id, 'nudge', `Nudged ${missing.length} of ${members.length} about next week`, true)
  return 'sent'
}

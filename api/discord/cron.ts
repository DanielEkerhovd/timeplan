// The clock. pg_cron in Supabase calls this every five minutes (see README);
// nothing runs between calls. Protected by a shared secret, not by a user.
//
// Two jobs per team, both idempotent, so a missed or doubled call does no harm:
//
//   1. The weekly post. On the chosen weekday, once the chosen time has passed
//      on the team's own clock, post the target week if it is not up yet. The
//      target is the week containing "today + 1 day": Sunday evening means next
//      week, Monday morning means this one. Missing the exact minute does not
//      matter — it posts on the next call after the time, the same day.
//
//   2. Keep the living post current. Rebuild it from the database and PATCH
//      only when something actually changed (a content hash says so). Silent:
//      an edit never pings anyone, which is exactly why changes get their own
//      channel (job 3).
//
//   3. Change messages. The database queues added, moved and cancelled
//      sessions (discord_outbox); anything that has waited its two minutes is
//      posted in the updates channel, pinging the people it concerns.
//
//   4. Reminders. A session that starts within the team's chosen number of
//      hours gets one card to the people who said yes (reminders.ts).
//
//   5. The nudge. On the team's chosen weekday and time, whoever has not
//      marked a single hour for next week is asked to (nudge.ts).
//
//   6. The team role, taken back off whoever left the team (roleQueue.ts).

export const config = { runtime: 'edge' }

import { env, json, text } from '../_lib/env'
import { db } from '../_lib/supabase'
import type { DiscordSchedule, WeekPost } from '../_lib/supabase'
import { addDays, localNow, mondayOf, timeToMinutes } from '../_lib/time'
import { ensureWeekPost } from '../_lib/week'
import { drainOutbox } from '../_lib/updates'
import { sendReminders } from '../_lib/reminders'
import { sendNudges } from '../_lib/nudge'
import { drainRoleQueue } from '../_lib/roleQueue'
import { sameSecret } from '../_lib/crypto'
import { leaveOrphanGuilds } from '../_lib/discord'

interface TeamRow {
  id: string
  timezone: string
}

export default async function handler(req: Request): Promise<Response> {
  // pg_net sends x-cron-secret; Vercel Cron sends Authorization: Bearer <CRON_SECRET>. Either works.
  // Never the query string: that ends up in request logs.
  const auth = req.headers.get('authorization') ?? ''
  const key = req.headers.get('x-cron-secret') ?? (auth.startsWith('Bearer ') ? auth.slice(7) : '')
  if (!key || !(await sameSecret(key, env.cronSecret()))) return text('forbidden', 403)

  // 0. Leave servers no team is linked to any more (a deleted team, a failed
  //    disconnect). Before the early return: with the last team gone, this is
  //    the only job left to do.
  let orphans: Record<string, string> = {}
  try {
    const links = await db.select<{ guild_id: string }>('discord_links', { select: 'guild_id' })
    orphans = await leaveOrphanGuilds(links.map((l) => l.guild_id))
  } catch (err) {
    orphans = { error: err instanceof Error ? err.message : String(err) }
  }

  const schedules = await db.select<DiscordSchedule>('discord_schedules', {})
  if (schedules.length === 0) return json({ teams: 0, orphans, roles: await drainRoleQueue().catch(() => ({})) })
  const teams = await db.select<TeamRow>('teams', { select: 'id,timezone', id: `in.(${schedules.map((s) => s.team_id).join(',')})` })
  const posts = await db.select<WeekPost>('discord_week_post', {})

  const out: Record<string, string> = {}
  for (const s of schedules) {
    const team = teams.find((t) => t.id === s.team_id)
    if (!team) continue
    const now = localNow(team.timezone)
    const live = posts.find((p) => p.team_id === s.team_id)
    try {
      // 1. The weekly post.
      if (s.post_enabled && now.isodow === s.post_dow && now.minutes >= timeToMinutes(s.post_at)) {
        const target = mondayOf(addDays(now.dateKey, 1))
        if (!live || live.week_start !== target) {
          const r = await ensureWeekPost(s.team_id, target, 'scheduled')
          out[s.team_id] = `${r.action}${r.detail ? ` (${r.detail})` : ''}`
          continue
        }
      }
      // 2. Keep the living post current, as long as its week is not over.
      if (live && live.week_start >= mondayOf(now.dateKey)) {
        const r = await ensureWeekPost(s.team_id, live.week_start, 'refresh')
        out[s.team_id] = r.action
      }
    } catch (err) {
      out[s.team_id] = `error: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  // 3. Change messages that have waited their two minutes.
  const updates = await drainOutbox()
  // 4. Reminders before sessions, to the people who said yes.
  let reminders: Record<string, string> = {}
  try {
    reminders = await sendReminders()
  } catch (err) {
    reminders = { error: err instanceof Error ? err.message : String(err) }
  }
  // 5. The nudge for next week.
  let nudges: Record<string, string> = {}
  try {
    nudges = await sendNudges()
  } catch (err) {
    nudges = { error: err instanceof Error ? err.message : String(err) }
  }
  // 6. The team role, off whoever left.
  let roles: Record<string, string> = {}
  try {
    roles = await drainRoleQueue()
  } catch (err) {
    roles = { error: err instanceof Error ? err.message : String(err) }
  }
  return json({ teams: schedules.length, out, updates, reminders, nudges, roles, orphans })
}

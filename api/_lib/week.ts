// The one living week post per team: post it, keep it current, replace it
// when the week turns. The message itself is built in message.ts.

import { discord, explain, DiscordError } from './discord'
import { env } from './env'
import { db, log } from './supabase'
import type { DiscordLink, WeekPost } from './supabase'
import { isoWeek } from './time'
import { buildWeekMessage, contentHash, pingLine } from './message'
import type { BotWeek } from './message'

export { COMPONENTS_V2, buildWeekMessage, contentHash, pingLine } from './message'
export type { BotWeek, BotEvent, BotPerson } from './message'

export function fetchBotWeek(teamId: string, mondayKey: string): Promise<BotWeek | null> {
  return db.rpc<BotWeek | null>('bot_week', { team: teamId, week_start: mondayKey })
}

interface Message {
  id: string
  channel_id: string
}

async function pin(channelId: string, messageId: string) {
  try {
    await discord('PUT', `/channels/${channelId}/messages/pins/${messageId}`)
  } catch (err) {
    // Pins are a nicety. Full pin list or no Manage Messages: the post is still up.
    if (err instanceof DiscordError && (err.code === 30003 || err.code === 50013)) return
    throw err
  }
}

async function unpinAndDelete(channelId: string, messageId: string) {
  try {
    await discord('DELETE', `/channels/${channelId}/messages/pins/${messageId}`)
  } catch {
    /* already unpinned, or never was */
  }
  try {
    await discord('DELETE', `/channels/${channelId}/messages/${messageId}`)
  } catch (err) {
    if (err instanceof DiscordError && err.code === 10008) return
    throw err
  }
}

/**
 * Make sure the team's live post shows `mondayKey`, and is current.
 *
 *   * no post, or a post for another week: post a fresh one (with the ping),
 *     pin it, THEN take the old one down. New first, so a failure leaves two
 *     posts to tidy rather than none.
 *   * a post for this week: PATCH it if the content changed. Silent.
 *   * the message is gone on Discord: post again.
 */
export async function ensureWeekPost(teamId: string, mondayKey: string, reason: 'scheduled' | 'manual' | 'refresh'): Promise<{ action: 'posted' | 'edited' | 'unchanged' | 'skipped'; detail?: string }> {
  const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` })
  const channel = await db.one<{ channel_id: string }>('discord_channels', { team_id: `eq.${teamId}`, kind: 'eq.schedule' })
  if (!link || !channel) return { action: 'skipped', detail: 'no schedule channel' }

  const week = await fetchBotWeek(teamId, mondayKey)
  if (!week) return { action: 'skipped', detail: 'team not found' }

  const existing = await db.one<WeekPost>('discord_week_post', { team_id: `eq.${teamId}` })
  const sameWeek = existing && existing.week_start === mondayKey && existing.channel_id === channel.channel_id

  if (sameWeek) {
    const msg = buildWeekMessage(week, { ping: null, link, appUrl: env.appUrl() })
    const hash = await contentHash(msg)
    if (hash === existing.content_hash && reason !== 'manual') return { action: 'unchanged' }
    try {
      await discord('PATCH', `/channels/${existing.channel_id}/messages/${existing.message_id}`, msg)
      await db.update('discord_week_post', { team_id: `eq.${teamId}` }, { content_hash: hash, updated_at: new Date().toISOString() })
      return { action: 'edited' }
    } catch (err) {
      if (!(err instanceof DiscordError && err.code === 10008)) {
        await log(teamId, 'week_post', `Could not update week ${isoWeek(mondayKey).week}`, false, explain(err))
        throw err
      }
      // Someone deleted it on Discord. Fall through and post again.
      await db.remove('discord_week_post', { team_id: `eq.${teamId}` })
    }
  }

  const msg = buildWeekMessage(week, { ping: pingLine(week, link), link, appUrl: env.appUrl() })
  const hash = await contentHash(buildWeekMessage(week, { ping: null, link, appUrl: env.appUrl() }))
  let posted: Message
  try {
    posted = await discord<Message>('POST', `/channels/${channel.channel_id}/messages`, msg)
  } catch (err) {
    await log(teamId, 'week_post', `Could not post week ${isoWeek(mondayKey).week}`, false, explain(err))
    throw err
  }
  await pin(channel.channel_id, posted.id)
  await db.upsert('discord_week_post', {
    team_id: teamId,
    week_start: mondayKey,
    channel_id: channel.channel_id,
    message_id: posted.id,
    content_hash: hash,
    posted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (existing && !sameWeek) {
    try {
      await unpinAndDelete(existing.channel_id, existing.message_id)
    } catch (err) {
      await log(teamId, 'week_post', 'Posted the new week, but the old post could not be removed', false, explain(err))
    }
  }
  await log(teamId, 'week_post', `Week ${isoWeek(mondayKey).week} posted and pinned`, true)
  return { action: 'posted' }
}

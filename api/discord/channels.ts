// The channel picker: text channels in the linked server the bot can post in.
//
// A channel another team already uses is returned as `taken`, without saying
// which team — the owner of Dogs has no business knowing Foxes exists.

export const config = { runtime: 'edge' }

import { botMember, channelPermissions, discord, explain, guildPermissions, has, P, postableChannels } from '../_lib/discord'
import type { Channel, Role } from '../_lib/discord'
import { guard, HttpError, json } from '../_lib/env'
import { db, requireOwner } from '../_lib/supabase'
import type { DiscordChannel, DiscordLink } from '../_lib/supabase'

export interface PickerChannel {
  id: string
  name: string
  /** The bot can see it and send there. Channels it cannot see are not listed at all. */
  canPost: boolean
  canPin: boolean
  /** Used by another team in this server. */
  taken: boolean
  /** Used by this team, and for what. */
  mine: 'schedule' | 'updates' | 'reminders' | null
}

export default function handler(req: Request): Promise<Response> {
  return guard(async () => {
    const teamId = new URL(req.url).searchParams.get('team') ?? ''
    await requireOwner(req, teamId)

    const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` })
    if (!link) throw new HttpError(409, 'not connected')

    const me = await botMember(link.guild_id)
    if (!me) throw new HttpError(409, 'The bot is no longer in the server. Connect again.')

    if (req.method === 'POST') {
      // Make a text channel. Needs Manage Channels, which older installs did not
      // ask for; the fix is one more trip through Connect to Discord.
      const body = (await req.json().catch(() => ({}))) as { name?: string }
      const name = (body.name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9æøå_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100)
      if (name.length < 2) throw new HttpError(400, 'Give the channel a name.')
      const roles = await discord<Role[]>('GET', `/guilds/${link.guild_id}/roles`)
      const perms = guildPermissions(link.guild_id, roles, me)
      if (!has(perms, P.ADMINISTRATOR) && !has(perms, P.MANAGE_CHANNELS)) {
        throw new HttpError(409, 'The bot cannot create channels yet. Press Connect to Discord once more to give it Manage Channels, then try again.')
      }
      try {
        const made = await discord<Channel>('POST', `/guilds/${link.guild_id}/channels`, { name, type: 0 })
        return json({ id: made.id, name: made.name })
      } catch (err) {
        throw new HttpError(409, explain(err))
      }
    }

    const [roles, channels, links] = await Promise.all([
      discord<Role[]>('GET', `/guilds/${link.guild_id}/roles`),
      discord<Channel[]>('GET', `/guilds/${link.guild_id}/channels`),
      db.select<{ team_id: string }>('discord_links', { select: 'team_id', guild_id: `eq.${link.guild_id}` }),
    ])
    // Every channel any team in this server uses. Only "taken or not" leaves this function.
    const used = await db.select<DiscordChannel>('discord_channels', { team_id: `in.(${links.map((l) => l.team_id).join(',')})` })
    const botId = me.user?.id ?? ''

    const list: PickerChannel[] = []
    for (const c of postableChannels(channels)) {
      const perms = channelPermissions(link.guild_id, roles, me, botId, c)
      if (!has(perms, P.VIEW_CHANNEL)) continue
      const row = used.find((u) => u.channel_id === c.id)
      list.push({
        id: c.id,
        name: c.name,
        canPost: has(perms, P.SEND_MESSAGES),
        canPin: has(perms, P.MANAGE_MESSAGES),
        taken: Boolean(row && row.team_id !== teamId),
        mine: row && row.team_id === teamId ? row.kind : null,
      })
    }
    return json({ guild: { id: link.guild_id, name: link.guild_name }, channels: list })
  })
}

// The status card. Four questions, answered against Discord right now, each
// with a sentence that says what to do when the answer is no.

export const config = { runtime: 'edge' }

import { botMember, channelPermissions, discord, DiscordError, has, P, topPosition } from '../_lib/discord'
import type { Channel, Role } from '../_lib/discord'
import { guard, HttpError, json } from '../_lib/env'
import { db, requireOwner } from '../_lib/supabase'
import type { DiscordChannel, DiscordLink } from '../_lib/supabase'

export interface Check {
  ok: boolean
  label: string
  /** What to do about it. Only when not ok. */
  fix?: string
}

export default function handler(req: Request): Promise<Response> {
  return guard(async () => {
    const teamId = new URL(req.url).searchParams.get('team') ?? ''
    await requireOwner(req, teamId)

    const link = await db.one<DiscordLink>('discord_links', { team_id: `eq.${teamId}` })
    if (!link) throw new HttpError(409, 'not connected')

    const checks: Check[] = []
    const me = await botMember(link.guild_id)
    if (!me) {
      checks.push({ ok: false, label: 'The bot is not in the server', fix: 'Someone removed it. Use Connect to Discord to add it again.' })
      return json({ checks })
    }
    checks.push({ ok: true, label: `Bot is in ${link.guild_name ?? 'the server'}` })

    const botId = me.user?.id ?? ''
    const [roles, channels] = await Promise.all([
      discord<Role[]>('GET', `/guilds/${link.guild_id}/roles`),
      db.select<DiscordChannel>('discord_channels', { team_id: `eq.${teamId}` }),
    ])

    for (const kind of ['schedule', 'updates', 'reminders'] as const) {
      const row = channels.find((c) => c.kind === kind)
      if (!row) continue
      let ch: Channel | null = null
      try {
        ch = await discord<Channel>('GET', `/channels/${row.channel_id}`)
      } catch (err) {
        if (!(err instanceof DiscordError && (err.status === 404 || err.status === 403))) throw err
      }
      const name = ch ? `#${ch.name}` : 'the channel'
      const label = kind === 'schedule' ? 'week plan' : kind
      if (!ch) {
        checks.push({ ok: false, label: `Cannot see the ${label} channel`, fix: 'It was deleted, or the bot lost access. Pick a channel again.' })
        continue
      }
      const perms = channelPermissions(link.guild_id, roles, me, botId, ch)
      if (!has(perms, P.VIEW_CHANNEL) || !has(perms, P.SEND_MESSAGES)) {
        checks.push({ ok: false, label: `Cannot post in ${name}`, fix: `Give the bot View Channel and Send Messages in ${name} on Discord.` })
        continue
      }
      checks.push({ ok: true, label: `Can post in ${name} (${label})` })
      if (kind === 'schedule') {
        if (has(perms, P.MANAGE_MESSAGES)) checks.push({ ok: true, label: `Can pin the week plan in ${name}` })
        else checks.push({ ok: false, label: `Cannot pin in ${name}`, fix: `Give the bot Manage Messages in ${name}, or the week plan will not stay pinned.` })
      }
    }

    if (link.ping_mode === 'role' && link.ping_role_id) {
      const role = roles.find((r) => r.id === link.ping_role_id)
      if (!role) {
        checks.push({ ok: false, label: 'The ping role is gone', fix: 'It was deleted on Discord. Pick another role, or switch to pinging members.' })
      } else if (link.managed_role) {
        const botTop = topPosition(roles, me)
        const all = [link.guild_id, ...me.roles].reduce((acc, id) => acc | BigInt(roles.find((r) => r.id === id)?.permissions ?? '0'), 0n)
        if (!has(all, P.ADMINISTRATOR) && !has(all, P.MANAGE_ROLES)) {
          checks.push({ ok: false, label: `Cannot manage @${role.name}`, fix: 'The bot lost Manage Roles. Give it back in Server Settings → Roles.' })
        } else if (botTop <= role.position) {
          checks.push({ ok: false, label: `The Gather role is below @${role.name} in the role list`, fix: `Drag the Gather role above @${role.name} in Server Settings → Roles, or the bot cannot keep the role in sync.` })
        } else {
          checks.push({ ok: true, label: `Keeps @${role.name} in sync with the team` })
        }
      } else {
        checks.push({ ok: true, label: `Pings @${role.name}` })
      }
    } else {
      checks.push({ ok: true, label: 'Pings the members of the team' })
    }

    return json({ checks })
  })
}

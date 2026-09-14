// Discord's REST API with the bot token, plus the permission maths the status page needs.

import { env, HttpError } from './env'

const API = 'https://discord.com/api/v10'

export class DiscordError extends Error {
  status: number
  code: number
  constructor(status: number, code: number, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** One call. Retries once on 429 if Discord says the wait is short. */
export async function discord<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${env.botToken()}`,
      // Only with a body: Discord rejects an empty body labelled as JSON.
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'User-Agent': 'Gather (https://www.gatherapp.gg, 1.0)',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 429 && attempt === 0) {
    const wait = Number(res.headers.get('retry-after') ?? '1')
    if (wait <= 3) {
      await new Promise((r) => setTimeout(r, wait * 1000))
      return discord<T>(method, path, body, 1)
    }
  }
  if (!res.ok) {
    let code = 0
    let message = res.statusText
    try {
      const data = (await res.json()) as { code?: number; message?: string }
      code = data.code ?? 0
      message = data.message ?? message
    } catch {
      /* no body */
    }
    throw new DiscordError(res.status, code, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * What a Discord error means for the person reading Settings. Codes are
 * meaningless to a team owner; "let the bot into the channel" is not.
 */
export function explain(err: unknown): string {
  if (err instanceof DiscordError) {
    switch (err.code) {
      case 10003:
        return 'That channel no longer exists.'
      case 10004:
        return 'The bot is no longer in the server. Reconnect from Settings.'
      case 10008:
        return 'The message was deleted on Discord. It will be posted again.'
      case 10011:
        return 'That role no longer exists on the server.'
      case 50001:
        return 'The bot cannot see that channel. Let it in under the channel’s permissions on Discord.'
      case 50007:
        return 'Discord blocks DMs from this server to that account. On Discord: User Settings → Content & Social → Direct Messages, allow messages from server members (or from this server specifically).'
      case 50013:
        return 'The bot is missing a permission. Check that it can send messages, and that its role is above the team role in Server Settings → Roles.'
      case 50035:
        return `Discord rejected the message: ${err.message}`
    }
    if (err.status === 401) return 'The bot token is wrong or has been reset.'
    return `Discord said: ${err.message}`
  }
  if (err instanceof HttpError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

// --- Permissions ------------------------------------------------------------

export const P = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  MANAGE_ROLES: 1n << 28n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
}

/** The permissions the install link asks for. Nothing more. */
export const INSTALL_PERMISSIONS = P.VIEW_CHANNEL | P.SEND_MESSAGES | P.MANAGE_MESSAGES | P.EMBED_LINKS | P.ATTACH_FILES | P.MANAGE_ROLES | P.MANAGE_CHANNELS | P.SEND_MESSAGES_IN_THREADS

export interface Role {
  id: string
  name: string
  position: number
  permissions: string
  managed: boolean
  color: number
}
export interface Channel {
  id: string
  type: number
  name: string
  guild_id?: string
  parent_id?: string | null
  position?: number
  permission_overwrites?: { id: string; type: number; allow: string; deny: string }[]
}
export interface GuildMember {
  user?: { id: string }
  roles: string[]
}

let botUserId: string | null = null

/** The bot's own user id. Same for the life of the token; fetched once per instance. */
export async function botId(): Promise<string> {
  if (!botUserId) botUserId = (await discord<{ id: string }>('GET', '/users/@me')).id
  return botUserId
}

/** The bot's own membership in a server, or null when it is not there. */
export async function botMember(guildId: string): Promise<GuildMember | null> {
  const id = await botId()
  try {
    const m = await discord<GuildMember>('GET', `/guilds/${guildId}/members/${id}`)
    return { ...m, user: m.user ?? { id } }
  } catch (err) {
    if (err instanceof DiscordError && (err.status === 404 || err.status === 403)) return null
    throw err
  }
}

/** Effective permissions for a member in a channel, the way Discord computes them. */
export function channelPermissions(guildId: string, roles: Role[], member: GuildMember, memberId: string, channel: Channel): bigint {
  const everyone = roles.find((r) => r.id === guildId)
  let base = everyone ? BigInt(everyone.permissions) : 0n
  for (const id of member.roles) {
    const r = roles.find((x) => x.id === id)
    if (r) base |= BigInt(r.permissions)
  }
  if (base & P.ADMINISTRATOR) return ~0n

  let perms = base
  const ows = channel.permission_overwrites ?? []
  const ev = ows.find((o) => o.id === guildId)
  if (ev) perms = (perms & ~BigInt(ev.deny)) | BigInt(ev.allow)
  let allow = 0n
  let deny = 0n
  for (const o of ows) {
    if (o.type === 0 && o.id !== guildId && member.roles.includes(o.id)) {
      allow |= BigInt(o.allow)
      deny |= BigInt(o.deny)
    }
  }
  perms = (perms & ~deny) | allow
  const me = ows.find((o) => o.type === 1 && o.id === memberId)
  if (me) perms = (perms & ~BigInt(me.deny)) | BigInt(me.allow)
  return perms
}

export const has = (perms: bigint, bit: bigint) => (perms & bit) === bit

/** Everything a member is allowed server-wide, before channel overwrites. */
export function guildPermissions(guildId: string, roles: Role[], member: GuildMember): bigint {
  return [guildId, ...member.roles].reduce((acc, id) => acc | BigInt(roles.find((r) => r.id === id)?.permissions ?? '0'), 0n)
}

/** The highest position among the roles a member holds. */
export function topPosition(roles: Role[], member: GuildMember): number {
  let top = 0
  for (const id of member.roles) {
    const r = roles.find((x) => x.id === id)
    if (r && r.position > top) top = r.position
  }
  return top
}

/**
 * Is role `a` above role `b` in the server's list, the way Discord decides it?
 * Higher position wins. Two roles can share a position (a new role is created at
 * the bottom, next to whatever is already there); then the older role, the one
 * with the smaller id, ranks higher.
 */
export function roleAbove(a: Role, b: Role): boolean {
  if (a.position !== b.position) return a.position > b.position
  return BigInt(a.id) < BigInt(b.id)
}

/** Can this member give out and take away `role`? Discord asks whether the member's highest role is above it. */
export function canManageRole(roles: Role[], member: GuildMember, role: Role): boolean {
  let top: Role | null = null
  for (const id of member.roles) {
    const r = roles.find((x) => x.id === id)
    if (r && (!top || roleAbove(r, top))) top = r
  }
  return top !== null && roleAbove(top, role)
}

/** Text channels the bot can post in, sorted the way Discord shows them. */
export function postableChannels(channels: Channel[]): Channel[] {
  // 0 = text, 5 = announcement, 11/12 = threads (they carry a channel id too, but they
  // archive themselves; leave them out of the picker).
  return channels
    .filter((c) => c.type === 0 || c.type === 5)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name))
}

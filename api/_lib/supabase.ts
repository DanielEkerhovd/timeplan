// Talking to Supabase from the server, without supabase-js: PostgREST over fetch.
//
// Two identities:
//   * the user's own token (Authorization: Bearer from the app) — RLS applies, so
//     "is this person the owner of this team" is answered by the database, not by us
//   * the service role — bypasses RLS. Used only for the bot's own tables
//     (discord_week_post, discord_log) and for bot_week(). Never handed to a client.

import { env, HttpError } from './env'

type Query = Record<string, string>

function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: env.anonKey(),
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

function url(path: string, query?: Query): string {
  const u = new URL(`${env.supabaseUrl()}/rest/v1/${path}`)
  for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v)
  return u.toString()
}

async function read<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new HttpError(res.status >= 500 ? 502 : res.status, `${what}: ${res.status} ${body.slice(0, 200)}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** PostgREST with the service role. */
export const db = {
  async select<T>(table: string, query: Query): Promise<T[]> {
    const res = await fetch(url(table, { select: '*', ...query }), { headers: headers(env.serviceKey()) })
    return read<T[]>(res, `select ${table}`)
  },
  async one<T>(table: string, query: Query): Promise<T | null> {
    const rows = await this.select<T>(table, { ...query, limit: '1' })
    return rows[0] ?? null
  },
  async insert<T>(table: string, rows: unknown): Promise<T[]> {
    const res = await fetch(url(table), {
      method: 'POST',
      headers: headers(env.serviceKey(), { Prefer: 'return=representation' }),
      body: JSON.stringify(rows),
    })
    return read<T[]>(res, `insert ${table}`)
  },
  async upsert<T>(table: string, rows: unknown, onConflict?: string): Promise<T[]> {
    const res = await fetch(url(table, onConflict ? { on_conflict: onConflict } : {}), {
      method: 'POST',
      headers: headers(env.serviceKey(), { Prefer: 'return=representation,resolution=merge-duplicates' }),
      body: JSON.stringify(rows),
    })
    return read<T[]>(res, `upsert ${table}`)
  },
  async update<T>(table: string, query: Query, patch: unknown): Promise<T[]> {
    const res = await fetch(url(table, query), {
      method: 'PATCH',
      headers: headers(env.serviceKey(), { Prefer: 'return=representation' }),
      body: JSON.stringify(patch),
    })
    return read<T[]>(res, `update ${table}`)
  },
  async remove(table: string, query: Query): Promise<void> {
    const res = await fetch(url(table, query), { method: 'DELETE', headers: headers(env.serviceKey()) })
    await read<unknown>(res, `delete ${table}`)
  },
  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${env.supabaseUrl()}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: headers(env.serviceKey()),
      body: JSON.stringify(args),
    })
    return read<T>(res, `rpc ${fn}`)
  },
}

/** The signed-in user behind a request from the app. Throws 401 when there is none. */
export async function requireUser(req: Request): Promise<{ id: string; token: string }> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new HttpError(401, 'not signed in')
  const res = await fetch(`${env.supabaseUrl()}/auth/v1/user`, { headers: { apikey: env.anonKey(), Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new HttpError(401, 'session expired')
  const user = (await res.json()) as { id?: string }
  if (!user.id) throw new HttpError(401, 'session expired')
  return { id: user.id, token }
}

/**
 * Owner check, answered by RLS with the user's own token: the row only comes
 * back if they can see it, and the role filter does the rest.
 */
export async function requireOwner(req: Request, teamId: string): Promise<{ id: string; token: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(teamId)) throw new HttpError(400, 'bad team id')
  const user = await requireUser(req)
  const res = await fetch(url('members', { select: 'role', team_id: `eq.${teamId}`, user_id: `eq.${user.id}`, role: 'eq.owner' }), {
    headers: headers(user.token),
  })
  const rows = await read<{ role: string }[]>(res, 'members')
  if (rows.length === 0) throw new HttpError(403, 'only the owner can do this')
  return user
}

export interface DiscordLink {
  team_id: string
  guild_id: string
  guild_name: string | null
  ping_mode: 'members' | 'role'
  ping_role_id: string | null
  managed_role: boolean
}
export interface DiscordChannel {
  team_id: string
  kind: 'schedule' | 'updates' | 'reminders'
  channel_id: string
}
export interface DiscordSchedule {
  team_id: string
  post_enabled: boolean
  post_dow: number
  post_at: string
  nudge_enabled: boolean
  nudge_dow: number
  nudge_at: string
  updates_enabled: boolean
  updates_mode: 'channel' | 'dm' | 'both'
  same_day_enabled: boolean
  same_day_hours: number
  same_day_mode: 'channel' | 'dm' | 'both'
}
export interface WeekPost {
  team_id: string
  week_start: string
  channel_id: string
  message_id: string
  content_hash: string
}

export async function log(teamId: string, kind: 'week_post' | 'update' | 'reminder' | 'nudge' | 'test' | 'link', summary: string, ok: boolean, detail?: string) {
  try {
    await db.insert('discord_log', { team_id: teamId, kind, summary: summary.slice(0, 200), ok, detail: detail?.slice(0, 500) ?? null })
  } catch (err) {
    console.error('discord_log', err)
  }
}

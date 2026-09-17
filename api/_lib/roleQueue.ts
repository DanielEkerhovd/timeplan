// Taking the team role back off someone who left. The database queues the job
// (discord_role_queue, 0025) because it cannot call Discord itself; the clock
// drains the queue here.

import { discord, DiscordError, explain } from './discord'
import { db, log } from './supabase'

interface Row {
  id: number
  team_id: string
  guild_id: string
  role_id: string
  discord_id: string
  attempts: number
}

// Nothing left to do: they are not in the server, the role is gone, or the bot
// is not in the server any more. All three mean the role is off them.
const DONE = [10004, 10007, 10011, 10013]

export async function drainRoleQueue(limit = 20): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const rows = await db.select<Row>('discord_role_queue', { attempts: 'lt.3', order: 'at.asc', limit: String(limit) })
  for (const r of rows) {
    const key = `${r.team_id}:${r.discord_id}`
    try {
      await discord('DELETE', `/guilds/${r.guild_id}/members/${r.discord_id}/roles/${r.role_id}`)
      await db.remove('discord_role_queue', { id: `eq.${r.id}` })
      out[key] = 'removed'
    } catch (err) {
      if (err instanceof DiscordError && DONE.includes(err.code)) {
        await db.remove('discord_role_queue', { id: `eq.${r.id}` })
        out[key] = 'already gone'
        continue
      }
      const attempts = r.attempts + 1
      await db.update('discord_role_queue', { id: `eq.${r.id}` }, { attempts })
      out[key] = `error: ${explain(err)}`
      // Three tries and we stop. Usually the bot's role sits below the team
      // role, which a person has to fix in Server Settings.
      if (attempts >= 3) await log(r.team_id, 'link', 'Could not take the team role off someone who left', false, explain(err))
    }
  }
  return out
}

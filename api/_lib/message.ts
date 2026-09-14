// The week as a Discord message: pure functions, no network, no environment.
// Built from Discord's own blocks (Components V2), not a picture. It is a list,
// not a calendar: day, time as <t:…> so everyone sees their own clock, title,
// Join / Can't, and the names of the people who said yes as chips that do not
// ping. Availability is not here and never will be — the bot shows what is
// booked, nothing else.

import { sha256 } from './crypto'
import { dayName, isoWeek, localToInstant, unix, weekRangeLabel } from './time'

export interface PingLink {
  ping_mode: 'members' | 'role'
  ping_role_id: string | null
}

export interface BotPerson {
  name: string
  discord_id: string | null
}
export interface BotEvent {
  id: string
  date: string
  start_hour: number
  end_hour: number
  title: string
  opponent: string | null
  color: string
  people: BotPerson[]
}
export interface BotWeek {
  team: { id: string; name: string; timezone: string }
  week_start: string
  events: BotEvent[]
  members: BotPerson[]
}

/** The accent bar. Same eight keys as the app; the "ink" values from index.css, which read well on Discord's dark grey. */
const ACCENT: Record<string, number> = {
  yellow: 0xf0cf7e,
  green: 0x8fcba6,
  coral: 0xf0a58e,
  purple: 0xc9b8ea,
  blue: 0x9fbee3,
  teal: 0x8fd0c8,
  pink: 0xefa9c4,
  grey: 0xc9c5be,
}
const GATHER_GREEN = 0x3e9a63

export const COMPONENTS_V2 = 1 << 15

// Discord allows 40 components in a V2 message. Each session card is five
// (container, text, row, two buttons); header, footer and the ping line are four.
const MAX_EVENTS = 7

// Discord has no width setting: a card is as wide as its widest line, so
// "4 minutes ago" turning into "an hour ago" made the whole message breathe.
// One line of blank braille cells (U+2800) is wide, invisible and one line
// tall; an image would have cost a whole blank band. It sets the width for
// every card in the message.
const WIDTH = '-# ' + '\u2800'.repeat(56)

const person = (p: BotPerson) => (p.discord_id ? `<@${p.discord_id}>` : p.name)

/**
 * The message body. `ping` is the line at the top of a fresh weekly post — the
 * one time this message notifies anyone. Edits pass null and stay silent.
 */
export function buildWeekMessage(week: BotWeek, opts: { ping: string | null; link: PingLink | null; appUrl: string }): Record<string, unknown> {
  const { year, week: nr } = isoWeek(week.week_start)
  const tz = week.team.timezone
  const url = `${opts.appUrl}/team/${week.team.id}?week=${year}-W${String(nr).padStart(2, '0')}`

  // The shape: a small header card, then one card per session in the session's
  // own colour, then a footer line. Colour is the one thing Discord lets us use
  // freely, and a bar per session is what makes a Scrim look different from a Match.
  const top: Record<string, unknown>[] = []
  if (opts.ping) top.push({ type: 10, content: opts.ping })

  const events = week.events.slice(0, MAX_EVENTS)
  const count = week.events.length
  const summary = count === 0 ? 'Nothing booked yet' : `${count} session${count === 1 ? '' : 's'}`
  top.push({
    type: 17,
    accent_color: GATHER_GREEN,
    components: [
      { type: 10, content: `## ${week.team.name} · Week ${nr}\n-# ${weekRangeLabel(week.week_start)}  ·  ${summary}\n${WIDTH}` },
    ],
  })

  for (const e of events) {
    const start = unix(localToInstant(e.date, e.start_hour, 0, tz))
    const end = unix(localToInstant(e.date, e.end_hour, 0, tz))
    const title = e.opponent ? `${e.title} vs ${e.opponent}` : e.title
    const who = e.people.length ? e.people.map(person).join('  ') : '-# No one yet'
    top.push({
      type: 17,
      accent_color: ACCENT[e.color] ?? GATHER_GREEN,
      components: [
        { type: 10, content: `### ${title}\n**${dayName(e.date)}**  <t:${start}:t> – <t:${end}:t>\n${who}` },
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Join', custom_id: `join:${e.id}` },
            { type: 2, style: 2, label: "Can't", custom_id: `cant:${e.id}` },
          ],
        },
      ],
    })
  }

  const tail: string[] = []
  if (count > MAX_EVENTS) tail.push(`+${count - MAX_EVENTS} more in the app`)
  tail.push(`Updated <t:${unix(new Date())}:R>`, `[Open in Gather](${url})`)
  top.push({ type: 10, content: `-# ${tail.join('  ·  ')}` })

  // Names render as chips either way; only the ping line is allowed to notify.
  const allowed: Record<string, unknown> = { parse: [] }
  if (opts.ping && opts.link) {
    if (opts.link.ping_mode === 'role' && opts.link.ping_role_id) allowed.roles = [opts.link.ping_role_id]
    else allowed.users = week.members.map((m) => m.discord_id).filter((id): id is string => Boolean(id)).slice(0, 100)
  }

  return { flags: COMPONENTS_V2, components: top, allowed_mentions: allowed }
}

/** The line that pings. A role mention, or every member with a Discord id. */
export function pingLine(week: BotWeek, link: PingLink): string | null {
  if (link.ping_mode === 'role' && link.ping_role_id) return `<@&${link.ping_role_id}> the week is up.`
  const ids = week.members.map((m) => m.discord_id).filter((id): id is string => Boolean(id))
  return ids.length ? `${ids.map((id) => `<@${id}>`).join(' ')} the week is up.` : null
}

/** What we hash to decide whether the live post needs a PATCH. The "updated" footer is left out. */
export function contentHash(msg: Record<string, unknown>): Promise<string> {
  return sha256(JSON.stringify(msg, (k, v) => (k === 'content' && typeof v === 'string' && v.startsWith('-# Updated') ? '' : v)))
}


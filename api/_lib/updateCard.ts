// The change cards themselves: pure, no network, no environment, so they can
// be tested on their own. Sending lives in updates.ts.
//
// Who a card pings is the whole design:
//   * new session(s): the team, because nobody has said yes yet. This is the
//     captain's "I added something" message, done by the bot.
//   * moved / changed: the people who had said yes.
//   * cancelled: the people who had said yes. Nobody had? Then nobody planned
//     for it, and nobody is pinged.

import { dayName, localToInstant, unix } from './time'
import { ACCENT, COMPONENTS_V2, GATHER_GREEN, WIDTH } from './message'

export interface Snapshot {
  id: string
  date: string
  start_hour: number
  end_hour: number
  title: string
  opponent: string | null
  color: string
}
export interface OutboxRow {
  id: number
  team_id: string
  kind: 'new' | 'changed' | 'cancelled'
  event_id: string
  payload: { before?: Snapshot; after?: Snapshot; people?: string[] }
  send_after: string
  attempts: number
  sent_at: string | null
  message_id: string | null
}

/** Who to notify, and how to write it. A role is one mention; members are one each. */
export interface Audience {
  /** The mention line at the top of the card, or null for a silent card. */
  line: string | null
  users: string[]
  roles: string[]
}

export const silent: Audience = { line: null, users: [], roles: [] }

export const forPeople = (people: string[]): Audience => ({
  line: people.length ? people.map((id) => `<@${id}>`).join(' ') : null,
  users: people.slice(0, 100),
  roles: [],
})

export const forRole = (roleId: string): Audience => ({ line: `<@&${roleId}>`, users: [], roles: [roleId] })

export const title = (s: Snapshot) => (s.opponent ? `${s.title} vs ${s.opponent}` : s.title)

function when(s: Snapshot, tz: string): string {
  const a = unix(localToInstant(s.date, s.start_hour, 0, tz))
  const b = unix(localToInstant(s.date, s.end_hour, 0, tz))
  return `**${dayName(s.date)}** <t:${a}:t> – <t:${b}:t>`
}

const sameTime = (a: Snapshot, b: Snapshot) => a.date === b.date && a.start_hour === b.start_hour && a.end_hour === b.end_hour

/** The row id rides in the button, so a click can redraw the card it sits on without any lookup by message. */
const buttons = (row: OutboxRow, yes: string) => ({
  type: 1,
  components: [
    { type: 2, style: 3, label: yes, custom_id: `uj:${row.event_id}:${row.id}` },
    { type: 2, style: 2, label: "Can't", custom_id: `uc:${row.event_id}:${row.id}` },
  ],
})

function wrap(accent: number, blocks: Record<string, unknown>[], audience: Audience): Record<string, unknown> {
  return {
    flags: COMPONENTS_V2,
    components: [{ type: 17, accent_color: accent, components: blocks }],
    // Chips render for everyone; only the audience is notified.
    allowed_mentions: { parse: [], users: audience.users, roles: audience.roles },
  }
}

/** One moved, changed or cancelled session. `people` are those who currently say yes (or said yes, for a cancellation). */
export function buildUpdateCard(row: OutboxRow, tz: string, people: string[]): Record<string, unknown> {
  const { kind, payload } = row
  const after = payload.after
  const before = payload.before
  const audience = forPeople(people)
  const chips = audience.line
  let heading: string
  let line: string
  let accent = GATHER_GREEN
  const blocks: Record<string, unknown>[] = []

  if (kind === 'new' && after) {
    // A lone new session, drawn through the group builder so the two never drift apart.
    return buildNewSessionsCard([row], tz, silent)
  } else if (kind === 'changed' && after && before) {
    const moved = !sameTime(before, after)
    heading = `## ${moved ? 'Moved' : 'Changed'} · ${title(after)}`
    line = moved ? `~~${when(before, tz)}~~ → ${when(after, tz)}` : `${when(after, tz)}${title(before) !== title(after) ? `\n-# was ${title(before)}` : ''}`
    if (chips) line += `\n${chips}`
    accent = ACCENT[after.color] ?? GATHER_GREEN
    blocks.push({ type: 10, content: `${heading}\n${line}\n${WIDTH}` }, buttons(row, 'Still in'))
  } else if (kind === 'cancelled' && before) {
    heading = `## Cancelled · ${title(before)}`
    line = `~~${when(before, tz)}~~`
    if (chips) line += `\n${chips}`
    accent = ACCENT[before.color] ?? GATHER_GREEN
    blocks.push({ type: 10, content: `${heading}\n${line}\n${WIDTH}` })
  } else {
    blocks.push({ type: 10, content: `## Update\n${WIDTH}` })
  }
  return wrap(accent, blocks, audience)
}

/**
 * One card for one or more new sessions, pinging the team once. Five sessions
 * added in a burst are one card, not five pings. Capped at five per card;
 * the sender splits anything longer.
 */
export function buildNewSessionsCard(rows: OutboxRow[], tz: string, audience: Audience, people: string[][] = []): Record<string, unknown> {
  const items = rows.filter((r) => r.payload.after).slice(0, 5)
  const first = items[0]?.payload.after
  const accent = first ? (ACCENT[first.color] ?? GATHER_GREEN) : GATHER_GREEN
  const heading = items.length === 1 && first ? `## New · ${title(first)}` : `## ${items.length} new sessions`
  // Who has said yes so far, per session. Empty when the card first goes out; filled in as people press Join.
  const who = (i: number) => (people[i]?.length ? `\n${people[i].map((id) => `<@${id}>`).join(' ')}` : '')
  const blocks: Record<string, unknown>[] = []
  const top = [heading]
  if (audience.line) top.push(audience.line)
  if (items.length === 1 && first) top.push(when(first, tz) + who(0))
  blocks.push({ type: 10, content: `${top.join('\n')}\n${WIDTH}` })
  if (items.length === 1) {
    blocks.push(buttons(items[0], 'Join'))
  } else {
    items.forEach((r, i) => {
      const s = r.payload.after!
      blocks.push({ type: 14, divider: true, spacing: 1 })
      blocks.push({ type: 10, content: `**${title(s)}**\n${when(s, tz)}${who(i)}` }, buttons(r, 'Join'))
    })
  }
  return wrap(accent, blocks, audience)
}

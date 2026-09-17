// The change cards themselves: pure, no network, no environment, so they can
// be tested on their own. Sending lives in updates.ts.
//
// Who a card pings is the whole design:
//   * new session(s): the team, because nobody has said yes yet. This is the
//     captain's "I added something" message, done by the bot.
//   * moved / changed: the people who had said yes.
//   * cancelled: the people who had said yes. Nobody had? Then nobody planned
//     for it, and nobody is pinged.

import { dayName, isoWeek, localToInstant, unix, weekRangeLabel } from './time'
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

/**
 * A card in someone's DMs is written to that one person. No mention chips
 * (a role is "@unknown-role" there, and a list of @names in a private message
 * reads oddly), the team's name for context since the bot serves several
 * teams, and "you're in" instead of a roster.
 */
export interface DmView {
  team: string
  me: string
}

export const title = (s: Snapshot) => (s.opponent ? `${s.title} vs ${s.opponent}` : s.title)

/** The one-line status for a DM: where the reader stands, and how many others are in. */
function standing(people: string[], me: string, tone: 'new' | 'changed'): string {
  const others = people.filter((id) => id !== me).length
  const rest = others === 0 ? '' : ` · ${others} other${others === 1 ? '' : 's'} in`
  if (people.includes(me)) return `✓ **You're in**${rest}`
  if (tone === 'changed') return `**You're out**${others ? ` · ${others} in` : ''}`
  return others ? `${others} in so far` : 'Nobody has answered yet'
}

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

/**
 * One moved, changed or cancelled session. `people` are those who currently
 * say yes (or said yes, for a cancellation). With `dm`, the card is the private
 * version for that one reader.
 */
export function buildUpdateCard(row: OutboxRow, tz: string, people: string[], dm?: DmView): Record<string, unknown> {
  const { kind, payload } = row
  const after = payload.after
  const before = payload.before
  const audience = dm ? silent : forPeople(people)
  const chips = dm ? null : audience.line
  const team = dm ? `-# ${dm.team}\n` : ''
  let heading: string
  let line: string
  let accent = GATHER_GREEN
  const blocks: Record<string, unknown>[] = []

  if (kind === 'new' && after) {
    // A lone new session, drawn through the group builder so the two never drift apart.
    return buildNewSessionsCard([row], tz, silent, [people], dm)
  } else if (kind === 'changed' && after && before) {
    const moved = !sameTime(before, after)
    heading = `## ${moved ? 'Moved' : 'Changed'} · ${title(after)}`
    line = moved ? `~~${when(before, tz)}~~ → ${when(after, tz)}` : `${when(after, tz)}${title(before) !== title(after) ? `\n-# was ${title(before)}` : ''}`
    if (chips) line += `\n${chips}`
    if (dm) line += `\n${standing(people, dm.me, 'changed')}`
    accent = ACCENT[after.color] ?? GATHER_GREEN
    blocks.push({ type: 10, content: `${heading}\n${team}${line}\n${WIDTH}` }, buttons(row, 'Still in'))
  } else if (kind === 'cancelled' && before) {
    heading = `## Cancelled · ${title(before)}`
    line = `~~${when(before, tz)}~~`
    if (chips) line += `\n${chips}`
    if (dm) line += `\nYou had said yes to this one.`
    accent = ACCENT[before.color] ?? GATHER_GREEN
    blocks.push({ type: 10, content: `${heading}\n${team}${line}\n${WIDTH}` })
  } else {
    blocks.push({ type: 10, content: `## Update\n${WIDTH}` })
  }
  return wrap(accent, blocks, audience)
}

export interface Missing {
  name: string
  discord_id: string | null
}

/**
 * The nudge: next week is open and some of the team have not marked a single
 * hour. Names the ones missing (a ping where we have a Discord account, plain
 * text where we do not) and links into the app. In a DM it is written to the
 * one person, with no mentions at all.
 */
export function buildNudgeCard(o: { weekStart: string; missing: Missing[]; total: number; appUrl: string; team: string }, dm?: boolean): Record<string, unknown> {
  const ids = o.missing.map((m) => m.discord_id).filter((x): x is string => Boolean(x))
  const audience: Audience = dm ? silent : forPeople(ids)
  const answered = o.total - o.missing.length
  const week = `Week ${isoWeek(o.weekStart).week} · ${weekRangeLabel(o.weekStart)}`
  const lines = dm
    ? [`## Your times for next week`, `-# ${o.team}`, week, 'You have not marked any hours yet. Tap the blocks you can make, and the team can plan around you.']
    : [`## Next week needs your times`, week]
  if (!dm) {
    // A ping for those we can reach; the rest by name, so the list is complete.
    const named = o.missing.filter((m) => !m.discord_id).map((m) => m.name)
    const who = [...ids.map((id) => `<@${id}>`), ...named].join(' ')
    if (who) lines.push(who)
    lines.push(`-# ${answered} of ${o.total} have marked their week`)
  }
  const blocks: Record<string, unknown>[] = [
    { type: 10, content: `${lines.join('\n')}\n${WIDTH}` },
    { type: 1, components: [{ type: 2, style: 5, label: 'Mark your week', url: o.appUrl }] },
  ]
  return wrap(GATHER_GREEN, blocks, audience)
}

/**
 * The reminder before a session, to the people who said yes. "Today" or the
 * day name, the time, who is in, and Still in / Can't so a change of plans is
 * one press. Buttons carry `r` so the click redraws this card, not the week.
 */
export function buildReminderCard(s: Snapshot, tz: string, people: string[], today: string, dm?: DmView): Record<string, unknown> {
  const audience = dm ? silent : forPeople(people)
  const start = unix(localToInstant(s.date, s.start_hour, 0, tz))
  const heading = `## Reminder · ${title(s)}`
  const dayWord = s.date === today ? 'Today' : `**${dayName(s.date)}**`
  let line = `${dayWord} <t:${start}:t> · starts <t:${start}:R>`
  if (dm) line = `-# ${dm.team}\n${line}\n${standing(people, dm.me, 'changed')}`
  else if (audience.line) line += `\n${audience.line}`
  const blocks: Record<string, unknown>[] = [
    { type: 10, content: `${heading}\n${line}\n${WIDTH}` },
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Still in', custom_id: `rj:${s.id}` },
        { type: 2, style: 2, label: "Can't", custom_id: `rc:${s.id}` },
      ],
    },
  ]
  return wrap(ACCENT[s.color] ?? GATHER_GREEN, blocks, audience)
}

/**
 * One card for one or more new sessions, pinging the team once. Five sessions
 * added in a burst are one card, not five pings. Capped at five per card;
 * the sender splits anything longer.
 */
export function buildNewSessionsCard(rows: OutboxRow[], tz: string, audience: Audience, people: string[][] = [], dm?: DmView): Record<string, unknown> {
  const items = rows.filter((r) => r.payload.after).slice(0, 5)
  const first = items[0]?.payload.after
  const accent = first ? (ACCENT[first.color] ?? GATHER_GREEN) : GATHER_GREEN
  const heading = items.length === 1 && first ? `## New · ${title(first)}` : `## ${items.length} new sessions`
  // Who has said yes so far, per session. Empty when the card first goes out;
  // filled in as people press Join. In a DM it is where the reader stands.
  const who = (i: number) => (dm ? `\n${standing(people[i] ?? [], dm.me, 'new')}` : people[i]?.length ? `\n${people[i].map((id) => `<@${id}>`).join(' ')}` : '')
  if (dm) audience = silent
  const blocks: Record<string, unknown>[] = []
  const top = [heading]
  if (dm) top.push(`-# ${dm.team}`)
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

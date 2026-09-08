// share-image build: 3 (større, mer kompakt kort — uke stort, aktivitetene som store rader)
// Draws the week as a 1200×720 PNG for Discord's link preview:
//   /functions/v1/share-image/<slug>.png?week=2026-W37
// Discord viser bildet rundt halv størrelse, så alt må være stort: ukenummeret i toppen og
// én bred rad per booket aktivitet. Ledige blokker teller vi bare opp nederst.

import satori from 'npm:satori@0.10.13'
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2'
import { DAYS, dayNumber, fetchShareWeek, formatRange, mondayFromWeekId, palette, range, weekId, type ShareDay, type ShareEvent } from '../_shared/week.ts'

// ---------- one-time setup: resvg wasm + fonts ----------

let ready: Promise<{ fonts: { name: string; data: ArrayBuffer; weight: 500 | 600 | 700 | 800; style: 'normal' }[] }> | null = null

async function setup() {
  // Både wasm-en og fontene ligger ved siden av denne fila og lastes fra disk.
  // Ingen CDN, ingen npm-cache: det som virker lokalt er det samme som kjører på Supabase.
  // Krever `static_files` i supabase/config.toml (se README-en i functions-mappa).
  const read = async (name: string) => {
    try {
      return await Deno.readFile(new URL(`./${name}`, import.meta.url))
    } catch (err) {
      throw new Error(`Fant ikke ${name} ved siden av funksjonen. Mangler static_files i supabase/config.toml? (${err})`)
    }
  }

  await initWasm(await read('resvg.wasm'))

  const weights = [500, 600, 700, 800] as const
  const fonts = await Promise.all(
    weights.map(async (w) => ({
      name: 'Manrope',
      data: (await read(`fonts/manrope-latin-${w}-normal.woff`)).buffer as ArrayBuffer,
      weight: w,
      style: 'normal' as const,
    })),
  )
  return { fonts }
}

// ---------- tiny element helper (satori takes React-shaped objects) ----------

type El = { type: string; props: Record<string, unknown> }
type Child = El | string | number | null | false | undefined | Child[]
// Satori wants display:flex on every box with more than one child, so divs default to flex.
const h = (type: string, props: Record<string, unknown>, ...children: Child[]): El => {
  const style = { ...(type === 'div' ? { display: 'flex' } : {}), ...((props.style as Record<string, unknown>) ?? {}) }
  return {
    type,
    props: { ...props, style, children: children.flat().filter((c) => c !== null && c !== false && c !== undefined) },
  }
}

const BG = '#F6F5F2'
const INK = '#1C1B19'
const MUTED = '#6F6C66'
const FAINT = '#B5B1AA'
const CARD_SHADOW = '0 1px 2px rgba(0,0,0,0.04), 0 10px 28px rgba(28,27,25,0.06)'

const tints = [
  ['#D9E7F5', '#2C4F73'],
  ['#DCEFE0', '#2F6B45'],
  ['#FBE3D6', '#8A3F1C'],
  ['#E8E1F5', '#4E3A7A'],
  ['#FFF1C7', '#6B4E00'],
  ['#DDF1EE', '#1F5F58'],
]

function initials(name: string): string {
  return (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

function avatar(name: string, url: string | null, ring: string, first: boolean, size = 22): El {
  const tint = tints[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % tints.length]
  const base = { width: size, height: size, borderRadius: 999, marginLeft: first ? 0 : -Math.round(size / 3), boxShadow: `0 0 0 2px ${ring}` }
  if (url) {
    return h('img', { src: url, width: size, height: size, style: { ...base, objectFit: 'cover' } })
  }
  return h(
    'div',
    {
      style: {
        ...base,
        background: tint[0],
        color: tint[1],
        fontSize: Math.round(size * 0.4),
        fontWeight: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    initials(name),
  )
}

const W = 1200
const H = 720
const ROWS = 4

type Row = { day: number; date: string; event: ShareEvent }

/** Alle bookede aktiviteter i uka, i rekkefølge, med hvilken dag de hører til. */
function activityRows(days: ShareDay[]): Row[] {
  const out: Row[] = []
  days.forEach((d, i) => d.events.forEach((event) => out.push({ day: i, date: d.date, event })))
  return out
}

function activityRow(r: Row): El {
  const p = palette[r.event.color] ?? palette.grey
  const people = r.event.people.slice(0, 5)
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        height: 92,
        background: '#FFFFFF',
        borderRadius: 20,
        boxShadow: CARD_SHADOW,
        overflow: 'hidden',
      },
    },
    // Fargen på aktiviteten som en stripe, ikke en flate: teksten skal være svart og stor.
    h('div', { style: { width: 14, height: 92, background: p.ink } }),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 128 } },
      h('div', { style: { fontSize: 20, fontWeight: 700, letterSpacing: 1.4, color: MUTED } }, DAYS[r.day].toUpperCase()),
      h('div', { style: { fontSize: 42, fontWeight: 800, lineHeight: 1, color: INK } }, String(dayNumber(r.date))),
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, paddingRight: 16 } },
      h('div', { style: { fontSize: 38, fontWeight: 800, color: INK, lineHeight: 1.15 } }, r.event.title),
      r.event.opponent ? h('div', { style: { fontSize: 24, fontWeight: 700, color: p.sub } }, `vs ${r.event.opponent}`) : null,
    ),
    people.length > 0
      ? h(
          'div',
          { style: { display: 'flex', alignItems: 'center', paddingRight: 24 } },
          ...people.map((person, i) => avatar(person.name, person.avatar, '#FFFFFF', i === 0, 40)),
          r.event.people.length > people.length
            ? h('div', { style: { fontSize: 20, fontWeight: 700, color: MUTED, marginLeft: 10 } }, `+${r.event.people.length - people.length}`)
            : null,
        )
      : null,
    h('div', { style: { fontSize: 32, fontWeight: 800, color: INK, paddingRight: 28 } }, range(r.event.start_hour, r.event.end_hour)),
  )
}

function emptyRow(text: string, sub: string): El {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        flex: 1,
        background: '#FFFFFF',
        borderRadius: 20,
        boxShadow: CARD_SHADOW,
        padding: '0 40px',
      },
    },
    h('div', { style: { fontSize: 40, fontWeight: 800, color: INK } }, text),
    h('div', { style: { fontSize: 26, fontWeight: 600, color: MUTED, paddingTop: 6 } }, sub),
  )
}

function render(data: Awaited<ReturnType<typeof fetchShareWeek>> & object, monday: string, footer: string): El {
  const id = weekId(monday)
  const number = Number(id.slice(-2))
  const all = activityRows(data.days)
  const shown = all.slice(0, ROWS)
  const freeCount = data.days.reduce((n, d) => n + d.free.length, 0)
  const free = freeCount === 0 ? 'No block where everyone is free' : `${freeCount} block${freeCount === 1 ? '' : 's'} where everyone is free`

  return h(
    'div',
    {
      style: {
        width: W,
        height: H,
        background: BG,
        padding: '44px 56px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        fontFamily: 'Manrope',
        color: INK,
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' } },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('div', { style: { fontSize: 24, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: MUTED } }, data.team.name),
        h('div', { style: { fontSize: 100, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05 } }, `Week ${number}`),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', paddingBottom: 10 } },
        h('div', { style: { fontSize: 34, fontWeight: 800 } }, formatRange(monday)),
        h(
          'div',
          { style: { fontSize: 24, fontWeight: 600, color: MUTED, paddingTop: 4 } },
          all.length === 0 ? 'Nothing booked yet' : `${all.length} activit${all.length === 1 ? 'y' : 'ies'}`,
        ),
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 14, flex: 1, paddingTop: 26, paddingBottom: 34 } },
      shown.length > 0 ? shown.map(activityRow) : emptyRow('Nothing booked yet', free),
    ),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end' } },
      h('div', { style: { fontSize: 22, fontWeight: 700, color: FAINT } }, footer),
    ),
  )
}

// ---------- handler ----------

/** A week of made-up data, so the drawing can be checked without a team or a database. */
function sampleWeek() {
  const monday = mondayFromWeekId(null)
  const day = (i: number) => {
    const d = new Date(monday + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  }
  const people = ['Ada', 'Bo', 'Cato', 'Dina', 'Eli', 'Finn'].map((name) => ({ name, avatar: null }))
  return {
    team: { name: 'Self test', timezone: 'Europe/Oslo' },
    week_start: monday,
    members: 5,
    days: [
      { date: day(0), events: [{ title: 'Match', opponent: 'Nordic Wolves', color: 'blue', start_hour: 18, end_hour: 21, people }], free: [] },
      { date: day(1), events: [], free: [{ start_hour: 19, end_hour: 22 }] },
      { date: day(2), events: [{ title: 'Scrim', opponent: null, color: 'green', start_hour: 19, end_hour: 23, people }], free: [] },
      { date: day(3), events: [{ title: 'VOD review', opponent: null, color: 'purple', start_hour: 16, end_hour: 18, people: people.slice(0, 2) }], free: [] },
      { date: day(4), events: [], free: [{ start_hour: 18, end_hour: 22 }] },
      { date: day(5), events: [{ title: 'Scrim', opponent: 'Ionized Esports', color: 'yellow', start_hour: 18, end_hour: 21, people }], free: [] },
      { date: day(6), events: [{ title: 'Flex night', opponent: null, color: 'orange', start_hour: 20, end_hour: 23, people: people.slice(0, 3) }], free: [] },
    ],
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const last = url.pathname.split('/').filter(Boolean).pop() ?? ''
  const slug = last.replace(/\.png$/i, '')

  // /functions/v1/share-image/_selftest.png draws a sample week. No database, no slug.
  // Use it right after deploying: image/png means wasm and fonts are both in place.
  const selfTest = slug === '_selftest'
  if (!selfTest && (!/^[A-Z0-9]{6,20}$/i.test(slug) || slug === 'share-image')) {
    return new Response('Not found', { status: 404 })
  }

  const monday = mondayFromWeekId(url.searchParams.get('week'))
  const data = selfTest ? sampleWeek() : await fetchShareWeek(slug, monday)
  if (!data) return new Response('Not found', { status: 404 })

  const footer = (Deno.env.get('APP_URL') ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')

  try {
    ready ??= setup()
    const { fonts } = await ready
    const svg = await satori(render(data, selfTest ? data.week_start : monday, footer) as never, { width: W, height: H, fonts })
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng()
    return new Response(png, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': selfTest ? 'no-store' : 'public, max-age=300' },
    })
  } catch (err) {
    // A failed setup must not be cached, or every later request fails too.
    ready = null
    console.error('share-image failed', err)
    return new Response(`share-image failed: ${err instanceof Error ? err.message : String(err)}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
})

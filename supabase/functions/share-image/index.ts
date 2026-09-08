// Draws the week as a 1200×630 PNG for Discord's link preview:
//   /functions/v1/share-image/<slug>.png?week=2026-W37
// Same layout as the "Discord share image" mockup: one card per day, booked activities in
// their colour with the avatars of everyone who joined, and dashed "Everyone free" blocks.

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

function avatar(name: string, url: string | null, ring: string, first: boolean): El {
  const tint = tints[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % tints.length]
  const base = { width: 22, height: 22, borderRadius: 999, marginLeft: first ? 0 : -7, boxShadow: `0 0 0 2px ${ring}` }
  if (url) {
    return h('img', { src: url, width: 22, height: 22, style: { ...base, objectFit: 'cover' } })
  }
  return h(
    'div',
    { style: { ...base, background: tint[0], color: tint[1], fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
    initials(name),
  )
}

function eventCard(e: ShareEvent): El {
  const p = palette[e.color] ?? palette.grey
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 12, background: p.soft, padding: '10px 12px' } },
    h('div', { style: { fontSize: 13, fontWeight: 800, color: p.ink } }, e.title),
    e.opponent ? h('div', { style: { fontSize: 12, fontWeight: 600, color: p.sub } }, e.opponent) : null,
    h('div', { style: { fontSize: 13, fontWeight: 600, color: p.sub } }, range(e.start_hour, e.end_hour)),
    e.people.length > 0
      ? h(
          'div',
          { style: { display: 'flex', alignItems: 'center', paddingTop: 4 } },
          ...e.people.slice(0, 6).map((person, i) => avatar(person.name, person.avatar, p.soft, i === 0)),
          e.people.length > 6
            ? h('div', { style: { fontSize: 10, fontWeight: 700, color: p.sub, marginLeft: 6 } }, `+${e.people.length - 6}`)
            : null,
        )
      : null,
  )
}

function freeCard(f: { start_hour: number; end_hour: number }): El {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 12, background: 'rgba(220,239,224,0.35)', border: '1.5px dashed #9CCBAC', padding: '8.5px 10.5px', opacity: 0.85 } },
    h('div', { style: { fontSize: 13, fontWeight: 700, color: '#5E8F70' } }, 'Everyone free'),
    h('div', { style: { fontSize: 13, fontWeight: 600, color: '#7FA88F' } }, range(f.start_hour, f.end_hour)),
    h('div', { style: { fontSize: 11, fontWeight: 600, color: '#9CB8A5' } }, 'not booked'),
  )
}

function dayCard(d: ShareDay, i: number): El {
  const items: Child[] = [...d.events.map(eventCard), ...d.free.map(freeCard)]
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 12, background: '#FFFFFF', borderRadius: 18, padding: '16px 14px', height: 300, boxShadow: CARD_SHADOW, flex: 1, minWidth: 0 } },
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
      h('div', { style: { fontSize: 15, fontWeight: 700, color: MUTED } }, DAYS[i]),
      h('div', { style: { fontSize: 24, fontWeight: 800, color: INK } }, String(dayNumber(d.date))),
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' } },
      items.length > 0 ? items.slice(0, 3) : h('div', { style: { fontSize: 13, fontWeight: 600, color: FAINT, padding: '4px 2px' } }, 'Free'),
    ),
  )
}

function render(data: Awaited<ReturnType<typeof fetchShareWeek>> & object, monday: string, footer: string): El {
  const id = weekId(monday)
  const number = Number(id.slice(-2))
  const activities = data.days.reduce((n, d) => n + d.events.length, 0)
  const now = new Date()
  const updated = `Updated ${DAYS[(now.getUTCDay() + 6) % 7]} ${now.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getUTCMonth()]}`

  return h(
    'div',
    { style: { width: 1200, height: 630, background: BG, padding: '48px 56px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'Manrope', color: INK } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' } },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: { fontSize: 16, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: MUTED } }, data.team.name),
        h('div', { style: { fontSize: 48, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 } }, `Week ${number}`),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 } },
        h('div', { style: { fontSize: 20, fontWeight: 700 } }, formatRange(monday)),
        h('div', { style: { fontSize: 15, color: MUTED } }, activities === 0 ? 'Nothing booked yet' : `${activities} activit${activities === 1 ? 'y' : 'ies'} this week`),
      ),
    ),
    h('div', { style: { display: 'flex', gap: 12 } }, ...data.days.map(dayCard)),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, h('div', { style: { fontSize: 14, fontWeight: 600, color: '#9A9690' } }, `${updated}${footer ? ' · ' + footer : ''}`)),
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
  const people = ['Ada', 'Bo', 'Cato', 'Dina'].map((name) => ({ name, avatar: null }))
  return {
    team: { name: 'Self test', timezone: 'Europe/Oslo' },
    week_start: monday,
    members: 5,
    days: [
      { date: day(0), events: [{ title: 'Flex 5v5 night', opponent: null, color: 'blue', start_hour: 19, end_hour: 22, people }], free: [] },
      { date: day(1), events: [], free: [] },
      { date: day(2), events: [], free: [] },
      { date: day(3), events: [{ title: 'Scrim', opponent: 'Nordic Wolves', color: 'yellow', start_hour: 19, end_hour: 22, people }], free: [] },
      { date: day(4), events: [], free: [{ start_hour: 18, end_hour: 22 }] },
      { date: day(5), events: [{ title: 'VOD review', opponent: null, color: 'purple', start_hour: 16, end_hour: 18, people: [] }], free: [] },
      { date: day(6), events: [], free: [] },
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
    const svg = await satori(render(data, selfTest ? data.week_start : monday, footer) as never, { width: 1200, height: 630, fonts })
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()
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

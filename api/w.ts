// The page Discord reads, served from the app's own domain.
//
// It cannot live on Supabase: their gateway serves HTML from *.supabase.co as text/plain
// with a sandbox CSP to stop phishing, so a crawler finds no tags and shows no preview.
// Here it is plain HTML from our own host, which is what Discord expects.

export const config = { runtime: 'edge' }

interface SharePerson {
  name: string
  avatar: string | null
}
interface ShareEvent {
  title: string
  opponent: string | null
  color: string
  start_hour: number
  end_hour: number
  people: SharePerson[]
}
interface ShareDay {
  date: string
  events: ShareEvent[]
  free: { start_hour: number; end_hour: number }[]
}
interface ShareWeek {
  team: { name: string; timezone: string }
  week_start: string
  members: number
  days: ShareDay[]
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const hour = (h: number) => `${String(h).padStart(2, '0')}:00`
const range = (a: number, b: number) => `${hour(a)} - ${hour(b)}`

function mondayFromWeekId(id: string | null): string {
  const m = id?.match(/^(\d{4})-W(\d{2})$/)
  let d: Date
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 53) {
    const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4))
    const dow = jan4.getUTCDay() || 7
    d = new Date(jan4.getTime() - (dow - 1) * 86_400_000 + (Number(m[2]) - 1) * 7 * 86_400_000)
  } else {
    const now = new Date()
    const dow = now.getUTCDay() || 7
    d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dow - 1)))
  }
  return d.toISOString().slice(0, 10)
}

function weekId(mondayKey: string): string {
  const d = new Date(mondayKey + 'T00:00:00Z')
  const thursday = new Date(d.getTime() + 3 * 86_400_000)
  const year = thursday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const week1Monday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86_400_000)
  const week = Math.round((d.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

function formatRange(mondayKey: string): string {
  const a = new Date(mondayKey + 'T00:00:00Z')
  const b = new Date(a.getTime() + 6 * 86_400_000)
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
    : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const slug = url.searchParams.get('s') ?? ''
  if (!/^[A-Z0-9]{6,20}$/i.test(slug)) return new Response('Not found', { status: 404 })

  const monday = mondayFromWeekId(url.searchParams.get('week'))
  const id = weekId(monday)

  const base = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
  if (!base || !key) {
    return new Response('share is not configured: SUPABASE_URL / SUPABASE_ANON_KEY missing', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  let data: ShareWeek | null = null
  try {
    const res = await fetch(`${base}/rest/v1/rpc/share_week`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ slug, week_start: monday }),
    })
    if (res.ok) data = await res.json()
  } catch {
    data = null
  }

  const origin = url.origin
  if (!data) {
    return new Response(page('This link is not active', 'The team has turned sharing off, or the link has changed.', null, null, null), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const image = `${origin}/w/${slug}.png?week=${id}`
  const canonical = `${origin}/w/${slug}?week=${id}`
  const target = `${origin}/share/${slug}?week=${id}`
  const title = `${data.team.name} · Week ${Number(id.slice(-2))}`

  const lines: string[] = []
  for (const d of data.days) {
    for (const e of d.events) {
      const day = DAYS[(new Date(d.date + 'T00:00:00Z').getUTCDay() + 6) % 7]
      lines.push(
        `${day} ${Number(d.date.slice(8, 10))} · ${e.title}${e.opponent ? ' vs ' + e.opponent : ''} · ${range(e.start_hour, e.end_hour)}`,
      )
    }
  }
  const freeCount = data.days.reduce((n, d) => n + d.free.length, 0)
  // Datoane står på si eiga linje, så listan under startar reint.
  const description =
    `${formatRange(monday)}\n` +
    (lines.length ? lines.join('\n') : 'Nothing booked yet.') +
    (freeCount ? `\n${freeCount} block${freeCount === 1 ? '' : 's'} where everyone is free.` : '')

  return new Response(page(title, description, image, target, canonical), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  })
}

function page(title: string, description: string, image: string | null, target: string | null, canonical: string | null): string {
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  const dAttr = d.replace(/\n/g, '&#10;')
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${dAttr}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Gather">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${dAttr}">
${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : ''}
${
  image
    ? `<meta property="og:image" content="${image}">
<meta property="og:image:secure_url" content="${image}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="720">
<meta property="og:image:alt" content="${t}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${dAttr}">
<meta name="twitter:image" content="${image}">`
    : ''
}
<meta name="theme-color" content="#f6f5f2">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f5f2; color: #1c1b19; font: 15px/1.5 Manrope, "Segoe UI", system-ui, sans-serif; }
  main { max-width: 640px; padding: 32px; text-align: center; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  p { color: #6f6c66; white-space: pre-line; margin: 0 0 16px; }
  img { max-width: 100%; border-radius: 16px; box-shadow: 0 8px 24px rgba(28,27,25,.08); }
  a { color: #2f6b45; font-weight: 700; }
</style>
</head><body><main>
<h1>${t}</h1>
<p>${d}</p>
${image ? `<img src="${image}" alt="">` : ''}
${target ? `<p><a href="${escapeHtml(target)}">Open the week</a></p>` : ''}
</main>
${target ? `<script>location.replace(${JSON.stringify(target)})</script>` : ''}
</body></html>`
}

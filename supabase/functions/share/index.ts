// The link you paste on Discord: https://<project>.supabase.co/functions/v1/share/<slug>?week=2026-W37
//
// Discord's crawler reads the Open Graph tags here and shows the picture from `share-image`.
// A person clicking the link is sent on to the app's read-only week page.
// No login: the data comes from share_week(), which only answers for teams with sharing on.

import { DAYS, dayNumber, escapeHtml, fetchShareWeek, formatRange, mondayFromWeekId, range, weekId } from '../_shared/week.ts'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const slug = url.pathname.split('/').filter(Boolean).pop() ?? ''
  if (!/^[A-Z0-9]{6,20}$/i.test(slug) || slug === 'share') {
    return new Response('Not found', { status: 404 })
  }
  const monday = mondayFromWeekId(url.searchParams.get('week'))
  const id = weekId(monday)
  const data = await fetchShareWeek(slug, monday)
  if (!data) {
    return new Response(page('This link is not active', 'The team has turned sharing off, or the link has changed.', null, null), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Everything Discord sees must be on the app's own domain, or the preview would give
  // the Supabase URL away. APP_URL is the app; the /w/ paths are rewritten by Vercel.
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
  const target = appUrl ? `${appUrl}/share/${slug}?week=${id}` : null
  const image = appUrl
    ? `${appUrl}/w/${slug}.png?week=${id}`
    : `${url.origin}/functions/v1/share-image/${slug}.png?week=${id}`
  const number = Number(id.slice(-2))
  const title = `${data.team.name} · Week ${number}`

  // A short text version for the embed: one line per booked activity.
  const lines: string[] = []
  for (const d of data.days) {
    for (const e of d.events) {
      lines.push(`${DAYS[(new Date(d.date + 'T00:00:00Z').getUTCDay() + 6) % 7]} ${dayNumber(d.date)} · ${e.title}${e.opponent ? ' vs ' + e.opponent : ''} · ${range(e.start_hour, e.end_hour)}`)
    }
  }
  const freeCount = data.days.reduce((n, d) => n + d.free.length, 0)
  const description =
    (lines.length ? lines.join('\n') : 'Nothing booked yet.') + (freeCount ? `\n${freeCount} block${freeCount === 1 ? '' : 's'} where everyone is free.` : '')

  return new Response(page(title, `${formatRange(monday)} · ${description}`, image, target), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  })
})

function page(title: string, description: string, image: string | null, target: string | null): string {
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
${image ? `<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${image}">` : ''}
<meta name="theme-color" content="#f6f5f2">
${target ? `<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">` : ''}
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
</main></body></html>`
}

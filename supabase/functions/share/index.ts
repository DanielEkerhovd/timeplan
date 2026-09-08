// share build: 2 (script-redirect i stedet for meta refresh, fulle og:-tagger)
// The link you paste on Discord: https://<app>/w/<slug>?week=2026-W37 (Vercel rewrites it here).
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
    return new Response(page('This link is not active', 'The team has turned sharing off, or the link has changed.', null, null, null), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Everything Discord sees must be on the app's own domain, or the preview would give
  // the Supabase URL away. APP_URL is the app; the /w/ paths are rewritten by Vercel.
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
  const target = appUrl ? `${appUrl}/share/${slug}?week=${id}` : null
  const canonical = appUrl ? `${appUrl}/w/${slug}?week=${id}` : null
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

  return new Response(page(title, `${formatRange(monday)} · ${description}`, image, target, canonical), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  })
})

function page(title: string, description: string, image: string | null, target: string | null, canonical: string | null): string {
  const t = escapeHtml(title)
  // Newlines are fine in the visible text but must be encoded inside the meta attribute.
  const d = escapeHtml(description)
  const dAttr = d.replace(/\n/g, '&#10;')
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${dAttr}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Team schedule">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${dAttr}">
${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : ''}
${image ? `<meta property="og:image" content="${image}">
<meta property="og:image:secure_url" content="${image}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${t}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${dAttr}">
<meta name="twitter:image" content="${image}">` : ''}
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
${
  // A script, not a meta refresh: Discord and other crawlers follow a refresh and end up on
  // the app, which has no tags of its own, so the preview would come out empty.
  target ? `<script>location.replace(${JSON.stringify(target)})</script>` : ''
}
</body></html>`
}

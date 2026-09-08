// The picture Discord shows, served from the app's own domain.
//
// It is drawn by the Supabase function `share-image`, but we fetch it from here instead of
// letting Discord go there directly. Two reasons: the Supabase URL never leaves our server,
// and Supabase's gateway treats crawler user agents differently — this way the bytes are
// always fetched by us, with our own headers, and handed on as a plain PNG.

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const slug = url.searchParams.get('s') ?? ''
  if (!/^[A-Z0-9_]{6,20}$/i.test(slug)) return new Response('Not found', { status: 404 })

  const base = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
  if (!base) {
    return new Response('share image is not configured: SUPABASE_URL missing', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const week = url.searchParams.get('week')
  const target = `${base}/functions/v1/share-image/${slug}.png${week ? `?week=${encodeURIComponent(week)}` : ''}`

  let res: Response
  try {
    res = await fetch(target, {
      headers: key ? { apikey: key, Authorization: `Bearer ${key}` } : {},
    })
  } catch {
    return new Response('Could not draw the picture', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  if (!res.ok) {
    return new Response('Not found', {
      status: res.status === 404 ? 404 : 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  // Only the headers we want. Nothing from Supabase is passed straight through.
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  })
}

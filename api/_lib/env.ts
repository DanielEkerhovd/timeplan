// Everything the Discord endpoints read from the environment, in one place.
// Files under api/_lib are not deployed as functions (Vercel skips the underscore).

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

export const env = {
  supabaseUrl: () => (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, ''),
  anonKey: () => {
    const v = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
    if (!v) throw new Error('SUPABASE_ANON_KEY is not set')
    return v
  },
  serviceKey: () => need('SUPABASE_SERVICE_ROLE_KEY'),
  appId: () => need('DISCORD_APP_ID'),
  publicKey: () => need('DISCORD_PUBLIC_KEY'),
  botToken: () => need('DISCORD_BOT_TOKEN'),
  clientSecret: () => need('DISCORD_CLIENT_SECRET'),
  stateSecret: () => need('DISCORD_STATE_SECRET'),
  cronSecret: () => need('DISCORD_CRON_SECRET'),
  /** Where the app lives, for links in messages and the OAuth return. No trailing slash. */
  appUrl: () => (process.env.APP_URL ?? process.env.VITE_SHARE_BASE ?? 'https://www.gatherapp.gg').replace(/\/$/, ''),
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })

export const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

/** Error with a status the endpoint can hand straight back. */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Runs an endpoint and turns thrown HttpErrors into JSON. Anything else is a 500 with a short message. */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error(err)
    return json({ error: message }, 500)
  }
}

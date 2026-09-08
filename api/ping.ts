// Small check that the app's own functions are reachable. Returns "pong" and nothing else.
export const config = { runtime: 'edge' }

export default function handler(): Response {
  return new Response('pong', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

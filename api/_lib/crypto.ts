// Signature checks and the signed state for the install flow. Web Crypto only,
// so it runs the same on Vercel's edge runtime and in Node.

const enc = new TextEncoder()

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

function fromHex(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(s.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Discord signs every interaction with Ed25519 over `timestamp + raw body`.
 * The check has to run on the bytes as they arrived, never on parsed JSON.
 */
export async function verifyDiscordSignature(publicKeyHex: string, signatureHex: string, timestamp: string, rawBody: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex) || !timestamp) return false
  try {
    const key = await crypto.subtle.importKey('raw', fromHex(publicKeyHex), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, fromHex(signatureHex), enc.encode(timestamp + rawBody))
  } catch {
    return false
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** `payload.signature`, good for `ttlSeconds`. What Discord hands back to us as `state`. */
export async function signState(secret: string, payload: Record<string, string>, ttlSeconds: number): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  return `${body}.${b64url(new Uint8Array(sig))}`
}

export async function readState(secret: string, state: string): Promise<Record<string, string> | null> {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body))
    if (!ok) return null
    const data = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Record<string, string> & { exp?: number }
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null
    return data
  } catch {
    return null
  }
}

export async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

/** Constant-time compare, by hashing both sides first so the lengths never matter. */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)])
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = 'qe_session'
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

interface SessionPayload {
  /** Username. */
  u: string
  /** Issued-at, seconds since epoch. */
  iat: number
  /** Expires-at, seconds since epoch. */
  exp: number
}

function getSecret(): string {
  const explicit = process.env.AUTH_COOKIE_SECRET
  if (explicit && explicit.length >= 32) return explicit

  // Fallback: derive a stable 256-bit secret from AUTH_PASSWORD so the user
  // only manages one secret. Rotating the password invalidates all sessions
  // (intentional). Cookie-forgery resistance is bounded by password entropy.
  const password = process.env.AUTH_PASSWORD
  if (password && password.length > 0) {
    return createHash('sha256').update('qe-cookie-v1:' + password).digest('hex')
  }

  throw new Error(
    'Set AUTH_PASSWORD (preferred) or AUTH_COOKIE_SECRET (32+ chars) in the environment.',
  )
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function sign(payloadB64: string): string {
  return b64urlEncode(createHmac('sha256', getSecret()).update(payloadB64).digest())
}

export function createSessionToken(username: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = { u: username, iat: now, exp: now + ttlSeconds }
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${sign(payloadB64)}`
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null
  const idx = token.indexOf('.')
  if (idx <= 0) return null
  const payloadB64 = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  const expected = sign(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload: SessionPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload.exp !== 'number') return null
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null
  return payload
}

/**
 * Parse a Cookie header into a map. Returns the value for `qe_session`,
 * or undefined.
 */
export function readSessionCookie(cookieHeader: string | undefined | null): string | undefined {
  if (!cookieHeader) return undefined
  const parts = cookieHeader.split(';')
  for (const raw of parts) {
    const eq = raw.indexOf('=')
    if (eq < 0) continue
    const k = raw.slice(0, eq).trim()
    if (k === COOKIE_NAME) {
      return decodeURIComponent(raw.slice(eq + 1).trim())
    }
  }
  return undefined
}

export function buildSetCookie(token: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ttlSeconds}`,
  ]
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure')
  }
  return parts.join('; ')
}

export function buildClearCookie(): string {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure')
  }
  return parts.join('; ')
}

export function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/**
 * Verify the request has a valid session cookie. Returns the parsed payload
 * if authenticated; otherwise writes a 401 to `res` and returns `null`.
 *
 * Usage in a Vercel handler:
 *   const session = requireSession(req, res)
 *   if (!session) return  // 401 already sent
 */
export function requireSession(
  req: { headers: { cookie?: string | undefined } },
  res: {
    status: (n: number) => { json: (body: unknown) => void }
  },
): ReturnType<typeof verifySessionToken> {
  const token = readSessionCookie(req.headers.cookie ?? null)
  const session = verifySessionToken(token ?? null)
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return session
}

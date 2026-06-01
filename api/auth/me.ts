import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readSessionCookie, verifySessionToken } from '../_lib/session.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Always no-cache so the client always gets a fresh auth state.
  res.setHeader('Cache-Control', 'no-store')

  let payload: ReturnType<typeof verifySessionToken> = null
  try {
    const token = readSessionCookie(req.headers.cookie)
    payload = verifySessionToken(token)
  } catch {
    // If the secret is missing or malformed, treat as not authed (don't 500
    // on every page load — the /login route will surface the config error).
    payload = null
  }

  if (!payload) {
    return res.status(200).json({ authenticated: false })
  }
  return res.status(200).json({
    authenticated: true,
    user: payload.u,
    expiresAt: payload.exp,
  })
}

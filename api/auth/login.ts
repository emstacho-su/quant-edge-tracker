import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  buildSetCookie,
  constantTimeEquals,
  createSessionToken,
} from '../_lib/session.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const expectedUser = process.env.AUTH_USERNAME
  const expectedPass = process.env.AUTH_PASSWORD
  if (!expectedUser || !expectedPass) {
    return res.status(500).json({
      error: 'Server misconfigured: AUTH_USERNAME and AUTH_PASSWORD must be set.',
    })
  }

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
    username?: unknown
    password?: unknown
  }
  const username = typeof body.username === 'string' ? body.username : ''
  const password = typeof body.password === 'string' ? body.password : ''

  // Constant-time compare on both fields. Compute both regardless of mismatch
  // so the response time doesn't leak which field was wrong.
  const userOk = constantTimeEquals(username, expectedUser)
  const passOk = constantTimeEquals(password, expectedPass)
  if (!userOk || !passOk) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  let token: string
  try {
    token = createSessionToken(expectedUser)
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to create session',
    })
  }

  res.setHeader('Set-Cookie', buildSetCookie(token))
  return res.status(200).json({ ok: true, user: expectedUser })
}

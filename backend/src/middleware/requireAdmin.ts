import { MiddlewareHandler } from 'hono'
import { verify } from 'hono/jwt'
import type { JwtPayload } from '../types'

const ADMIN_ROLES = new Set(['admin', 'master_admin'])

// Verifies the JWT and rejects any caller whose role is not admin/master_admin.
// Use on routes that must never be invoked by doctor/patient sessions —
// repertory upload/import/validate/job endpoints, etc.
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  // Prefer Authorization header. Fall back to ?token= query param so that
  // EventSource/SSE clients (which cannot set custom headers) can still
  // authenticate the admin upload progress stream.
  const auth = c.req.header('Authorization')
  let token: string | undefined
  if (auth?.startsWith('Bearer ')) {
    token = auth.slice(7)
  } else {
    const q = c.req.query('token')
    if (q) token = q
  }
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  let payload: JwtPayload
  try {
    payload = (await verify(
      token,
      process.env.JWT_SECRET || 'dev-secret-change-in-prod',
      'HS256',
    )) as unknown as JwtPayload
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
  if (!ADMIN_ROLES.has(payload.role)) {
    return c.json({ error: 'Admin access required' }, 403)
  }
  c.set('user', payload)
  await next()
}

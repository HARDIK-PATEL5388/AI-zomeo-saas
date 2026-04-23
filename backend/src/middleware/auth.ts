import { MiddlewareHandler } from 'hono'
import { verify } from 'hono/jwt'
import type { JwtPayload } from '../types'

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = auth.slice(7)
  try {
    const payload = await verify(token, process.env.JWT_SECRET || 'dev-secret-change-in-prod', 'HS256')
    c.set('user', payload as unknown as JwtPayload)
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}

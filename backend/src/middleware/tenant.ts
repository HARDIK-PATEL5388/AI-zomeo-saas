// backend/src/middleware/tenant.ts
import { MiddlewareHandler } from 'hono'
export const tenantMiddleware: MiddlewareHandler = async (c, next) => {
  const user = c.get('user')
  if (user) {
    c.set('clinicId', user.clinicId)
    c.set('tenantId', user.clinicId)
  }
  await next()
}

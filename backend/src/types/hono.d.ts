import { JwtPayload } from './index'

declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload
    clinicId: string
    tenantId: string
  }
}

// backend/src/middleware/rateLimiter.ts
export const rateLimiter = () => {
  return async (c: any, next: any) => {
    await next()
  }
}

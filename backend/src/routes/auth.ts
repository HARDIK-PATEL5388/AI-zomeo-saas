import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sign } from 'hono/jwt'
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'
import { db } from '../db/client'

const app = new Hono()

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod'
const TOKEN_TTL = 60 * 60 * 24 * 7 // 7 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  const hashBuffer = Buffer.from(hash, 'hex')
  const supplied = scryptSync(password, salt, 64)
  return timingSafeEqual(hashBuffer, supplied)
}

// POST /api/auth/login
// identifier = email address OR mobile number (digits only)
app.post('/login', zValidator('json', z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
})), async (c) => {
  const { identifier, password } = c.req.valid('json')

  const isEmail = identifier.includes('@')

  let query = db
    .selectFrom('users')
    .select(['id', 'clinic_id', 'email', 'role', 'password_hash', 'is_active',
      'first_name', 'last_name', 'mobile_code', 'mobile_number'])

  const user = isEmail
    ? await query.where('email', '=', identifier.toLowerCase()).executeTakeFirst()
    : await query.where('mobile_number', '=', identifier.trim()).executeTakeFirst()

  if (!user || !user.is_active) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const valid = verifyPassword(password, user.password_hash)
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const payload = {
    userId: user.id,
    clinicId: user.clinic_id,
    role: user.role,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL,
  }
  const token = await sign(payload, JWT_SECRET)

  // Update last_login_at
  await db.updateTable('users')
    .set({ last_login_at: new Date().toISOString() } as any)
    .where('id', '=', user.id)
    .execute()
    .catch(() => {}) // non-critical

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
      mobile_code: user.mobile_code,
      mobile_number: user.mobile_number,
    },
  })
})

// POST /api/auth/register
app.post('/register', zValidator('json', z.object({
  clinic_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
})), async (c) => {
  const { clinic_name, email, password, first_name, last_name } = c.req.valid('json')

  const existing = await db
    .selectFrom('users')
    .select(['id'])
    .where('email', '=', email.toLowerCase())
    .executeTakeFirst()

  if (existing) {
    return c.json({ error: 'Email already registered' }, 409)
  }

  const clinic = await db
    .insertInto('clinics')
    .values({
      name: clinic_name,
      email: email.toLowerCase(),
      subscription_plan: 'trial',
      subscription_status: 'active',
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  const user = await db
    .insertInto('users')
    .values({
      clinic_id: clinic.id,
      email: email.toLowerCase(),
      role: 'admin',
      first_name,
      last_name,
      password_hash: hashPassword(password),
      is_active: true,
    })
    .returning(['id', 'email', 'role', 'first_name', 'last_name'])
    .executeTakeFirstOrThrow()

  const payload = {
    userId: user.id,
    clinicId: clinic.id,
    role: user.role,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL,
  }
  const token = await sign(payload, JWT_SECRET)

  return c.json({
    token,
    user: { id: user.id, email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name },
  }, 201)
})

// POST /api/auth/refresh - stub for future implementation
app.post('/refresh', (c) => c.json({ error: 'Use /login to get a new token' }, 400))

export { app as authRoutes }

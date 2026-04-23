// Zomeo.ai — Appointments Route
// Calendar scheduler with availability logic + SMS reminders

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import { tenantMiddleware } from '../middleware/tenant'
import { createClient } from '@supabase/supabase-js'

export const appointmentsRoutes = new Hono()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

appointmentsRoutes.use('*', authMiddleware, tenantMiddleware)

// GET /api/appointments
appointmentsRoutes.get('/', async (c) => {
  const tenantId = c.get('tenantId')
  const { from, to, patientId } = c.req.query()

  let query = supabase
    .from('appointments')
    .select('*, patients(name, contact_json)')
    .eq('tenant_id', tenantId)
    .order('datetime')

  if (from) query = query.gte('datetime', from)
  if (to) query = query.lte('datetime', to)
  if (patientId) query = query.eq('patient_id', patientId)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// GET /api/appointments/calendar — appointments grouped by date
appointmentsRoutes.get('/calendar', async (c) => {
  const tenantId = c.get('tenantId')
  const { month, year } = c.req.query()
  const now = new Date()
  const y = Number(year) || now.getFullYear()
  const m = Number(month) || now.getMonth() + 1
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const to = `${y}-${String(m).padStart(2, '0')}-31`

  const { data, error } = await supabase
    .from('appointments')
    .select('*, patients(name)')
    .eq('tenant_id', tenantId)
    .gte('datetime', from)
    .lte('datetime', to)
    .order('datetime')

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// GET /api/appointments/:id
appointmentsRoutes.get('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const { data, error } = await supabase
    .from('appointments')
    .select('*, patients(name, contact_json)')
    .eq('id', c.req.param('id'))
    .eq('tenant_id', tenantId)
    .single()

  if (error) return c.json({ error: error.message }, 404)
  return c.json(data)
})

// POST /api/appointments
appointmentsRoutes.post(
  '/',
  zValidator('json', z.object({
    patientId: z.string().uuid(),
    datetime: z.string(),
    notes: z.string().optional(),
    sendReminder: z.boolean().default(true),
  })),
  async (c) => {
    const tenantId = c.get('tenantId')
    const { patientId, datetime, notes, sendReminder } = c.req.valid('json')

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        patient_id: patientId,
        tenant_id: tenantId,
        datetime,
        notes,
        status: 'scheduled',
      })
      .select('*, patients(name, contact_json)')
      .single()

    if (error) return c.json({ error: error.message }, 400)

    // Queue SMS reminder if patient has phone number
    if (sendReminder && data.patients?.contact_json?.phone) {
      // Dynamic import to avoid circular deps
      const { Queue } = await import('bullmq')
      const Redis = (await import('ioredis')).default
      const connection = new Redis(process.env.UPSTASH_REDIS_URL!, { maxRetriesPerRequest: null })
      const smsQueue = new Queue('sms-queue', { connection: connection as any })

      const apptDate = new Date(datetime).toLocaleString('en-IN', {
        weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      })
      await smsQueue.add('appointment-reminder', {
        to: data.patients.contact_json.phone,
        body: `Appointment reminder: ${data.patients.name} on ${apptDate}. Reply CONFIRM or CANCEL.`,
      }, {
        delay: Math.max(0, new Date(datetime).getTime() - Date.now() - 24 * 60 * 60 * 1000),
      })
    }

    return c.json(data, 201)
  }
)

// PATCH /api/appointments/:id — update status
appointmentsRoutes.patch(
  '/:id',
  zValidator('json', z.object({
    status: z.enum(['scheduled', 'completed', 'cancelled', 'no-show']).optional(),
    notes: z.string().optional(),
    datetime: z.string().optional(),
  })),
  async (c) => {
    const tenantId = c.get('tenantId')
    const body = c.req.valid('json')

    const { data, error } = await supabase
      .from('appointments')
      .update(body)
      .eq('id', c.req.param('id'))
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 400)
    return c.json(data)
  }
)

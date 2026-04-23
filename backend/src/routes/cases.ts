import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client'

const app = new Hono()

// GET /api/cases
app.get('/', async (c) => {
  const user = c.get('user')
  const { patient_id, status, limit = '20' } = c.req.query()

  let query = db
    .selectFrom('cases as ca')
    .innerJoin('patients as p', 'p.id', 'ca.patient_id')
    .select([
      'ca.id', 'ca.patient_id', 'ca.chief_complaint',
      'ca.status', 'ca.created_at', 'ca.updated_at',
      'p.first_name', 'p.last_name',
    ])
    .where('ca.clinic_id', '=', user.clinicId)
    .orderBy('ca.created_at', 'desc')
    .limit(parseInt(limit))

  if (patient_id) query = query.where('ca.patient_id', '=', patient_id)
  if (status) query = query.where('ca.status', '=', status as 'active' | 'closed' | 'archived')

  const rows = await query.execute()
  const data = rows.map(r => ({
    ...r,
    patient_name: `${r.first_name} ${r.last_name}`,
  }))

  return c.json({ data })
})

// GET /api/cases/:id
app.get('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')

  const row = await db
    .selectFrom('cases as ca')
    .innerJoin('patients as p', 'p.id', 'ca.patient_id')
    .select([
      'ca.id', 'ca.patient_id', 'ca.chief_complaint', 'ca.history',
      'ca.status', 'ca.created_at', 'ca.updated_at', 'ca.doctor_id',
      'p.first_name', 'p.last_name', 'p.gender', 'p.age', 'p.date_of_birth',
    ])
    .where('ca.id', '=', id)
    .where('ca.clinic_id', '=', user.clinicId)
    .executeTakeFirst()

  if (!row) return c.json({ error: 'Case not found' }, 404)
  return c.json({ data: { ...row, patient_name: `${row.first_name} ${row.last_name}` } })
})

// POST /api/cases
app.post('/', zValidator('json', z.object({
  patient_id: z.string().uuid(),
  chief_complaint: z.string().min(3),
  history: z.string().optional(),
})), async (c) => {
  const body = c.req.valid('json')
  const user = c.get('user')

  // Verify patient belongs to clinic
  const patient = await db
    .selectFrom('patients')
    .select(['id'])
    .where('id', '=', body.patient_id)
    .where('clinic_id', '=', user.clinicId)
    .executeTakeFirst()

  if (!patient) return c.json({ error: 'Patient not found' }, 404)

  const record = await db
    .insertInto('cases')
    .values({
      ...body,
      clinic_id: user.clinicId,
      doctor_id: user.userId,
      status: 'active',
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return c.json({ data: record }, 201)
})

// PATCH /api/cases/:id
app.patch('/:id', zValidator('json', z.object({
  chief_complaint: z.string().min(3).optional(),
  history: z.string().optional(),
  status: z.enum(['active', 'closed', 'archived']).optional(),
})), async (c) => {
  const { id } = c.req.param()
  const body = c.req.valid('json')
  const user = c.get('user')

  const record = await db
    .updateTable('cases')
    .set(body)
    .where('id', '=', id)
    .where('clinic_id', '=', user.clinicId)
    .returningAll()
    .executeTakeFirst()

  if (!record) return c.json({ error: 'Case not found' }, 404)
  return c.json({ data: record })
})

export { app as casesRoutes }

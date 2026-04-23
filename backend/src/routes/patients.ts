import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client'

const app = new Hono()

const patientSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  gender: z.enum(['male', 'female', 'other']),
  date_of_birth: z.string().optional(),
  age: z.number().int().min(0).max(150).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
})

// GET /api/patients
app.get('/', async (c) => {
  const user = c.get('user')
  const { search, page = '1', per_page = '20' } = c.req.query()
  const pageNum = Math.max(1, parseInt(page))
  const perPage = Math.min(100, Math.max(1, parseInt(per_page)))
  const offset = (pageNum - 1) * perPage

  let query = db
    .selectFrom('patients')
    .selectAll()
    .where('clinic_id', '=', user.clinicId)
    .where('is_active', '=', true)
    .orderBy('created_at', 'desc')
    .limit(perPage)
    .offset(offset)

  if (search) {
    query = query.where((eb) =>
      eb.or([
        eb('first_name', 'ilike', `%${search}%`),
        eb('last_name', 'ilike', `%${search}%`),
        eb('phone', 'ilike', `%${search}%`),
      ])
    )
  }

  const patients = await query.execute()

  const countResult = await db
    .selectFrom('patients')
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .where('clinic_id', '=', user.clinicId)
    .where('is_active', '=', true)
    .executeTakeFirst()

  return c.json({
    data: patients,
    meta: { total: Number(countResult?.count ?? 0), page: pageNum, per_page: perPage },
  })
})

// GET /api/patients/:id
app.get('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')

  const patient = await db
    .selectFrom('patients')
    .selectAll()
    .where('id', '=', id)
    .where('clinic_id', '=', user.clinicId)
    .executeTakeFirst()

  if (!patient) return c.json({ error: 'Patient not found' }, 404)
  return c.json({ data: patient })
})

// POST /api/patients
app.post('/', zValidator('json', patientSchema), async (c) => {
  const body = c.req.valid('json')
  const user = c.get('user')

  const patient = await db
    .insertInto('patients')
    .values({ ...body, clinic_id: user.clinicId, is_active: true })
    .returningAll()
    .executeTakeFirstOrThrow()

  return c.json({ data: patient }, 201)
})

// PATCH /api/patients/:id
app.patch('/:id', zValidator('json', patientSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body = c.req.valid('json')
  const user = c.get('user')

  const patient = await db
    .updateTable('patients')
    .set(body)
    .where('id', '=', id)
    .where('clinic_id', '=', user.clinicId)
    .returningAll()
    .executeTakeFirst()

  if (!patient) return c.json({ error: 'Patient not found' }, 404)
  return c.json({ data: patient })
})

// DELETE /api/patients/:id (soft delete)
app.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')

  await db
    .updateTable('patients')
    .set({ is_active: false })
    .where('id', '=', id)
    .where('clinic_id', '=', user.clinicId)
    .execute()

  return c.json({ message: 'Patient deleted' })
})

export { app as patientsRoutes }

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client'

const app = new Hono()

// GET /api/prescriptions?case_id=xxx
app.get('/', async (c) => {
  const user = c.get('user')
  const { case_id } = c.req.query()

  let query = db
    .selectFrom('prescriptions as pr')
    .innerJoin('cases as ca', 'ca.id', 'pr.case_id')
    .innerJoin('remedies as r', 'r.id', 'pr.remedy_id')
    .innerJoin('patients as p', 'p.id', 'ca.patient_id')
    .select([
      'pr.id', 'pr.case_id', 'pr.remedy_id', 'pr.potency',
      'pr.dose', 'pr.frequency', 'pr.duration', 'pr.instructions',
      'pr.follow_up_date', 'pr.created_at',
      'r.name as remedy_name', 'r.abbreviation',
      'p.first_name', 'p.last_name', 'ca.chief_complaint',
    ])
    .where('ca.clinic_id', '=', user.clinicId)
    .orderBy('pr.created_at', 'desc')

  if (case_id) query = query.where('pr.case_id', '=', case_id)

  const rows = await query.execute()
  const data = rows.map(r => ({ ...r, patient_name: `${r.first_name} ${r.last_name}` }))
  return c.json({ data })
})

// POST /api/prescriptions
app.post('/', zValidator('json', z.object({
  case_id: z.string().uuid(),
  remedy_id: z.string().uuid(),
  potency: z.string().min(1),
  dose: z.string().optional(),
  frequency: z.string().optional(),
  duration: z.string().optional(),
  instructions: z.string().optional(),
  follow_up_date: z.string().optional(),
})), async (c) => {
  const body = c.req.valid('json')
  const user = c.get('user')

  const caseRecord = await db
    .selectFrom('cases')
    .select(['id', 'patient_id'])
    .where('id', '=', body.case_id)
    .where('clinic_id', '=', user.clinicId)
    .executeTakeFirst()

  if (!caseRecord) return c.json({ error: 'Case not found' }, 404)

  const prescription = await db
    .insertInto('prescriptions')
    .values({
      ...body,
      clinic_id: user.clinicId,
      patient_id: caseRecord.patient_id,
      doctor_id: user.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return c.json({ data: prescription }, 201)
})

// DELETE /api/prescriptions/:id
app.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')

  await db
    .deleteFrom('prescriptions')
    .where('id', '=', id)
    .where('case_id', 'in',
      db.selectFrom('cases').select('id').where('clinic_id', '=', user.clinicId)
    )
    .execute()

  return c.json({ message: 'Prescription deleted' })
})

export { app as prescriptionsRoutes }

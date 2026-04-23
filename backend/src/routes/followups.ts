import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client'

const app = new Hono()

// GET /api/followups?case_id=xxx&upcoming=true
app.get('/', async (c) => {
  const user = c.get('user')
  const { case_id, upcoming, limit = '20' } = c.req.query()

  let query = db
    .selectFrom('followups as fu')
    .innerJoin('cases as ca', 'ca.id', 'fu.case_id')
    .innerJoin('patients as p', 'p.id', 'ca.patient_id')
    .select([
      'fu.id', 'fu.case_id', 'fu.followup_date', 'fu.overall_improvement',
      'fu.symptom_changes', 'fu.doctor_notes', 'fu.action_taken',
      'fu.next_followup_date', 'fu.created_at',
      'p.first_name', 'p.last_name', 'ca.chief_complaint',
    ])
    .where('ca.clinic_id', '=', user.clinicId)
    .orderBy('fu.next_followup_date', 'asc')
    .limit(parseInt(limit))

  if (case_id) query = query.where('fu.case_id', '=', case_id)
  if (upcoming === 'true') {
    const today = new Date().toISOString().split('T')[0]
    query = query.where('fu.next_followup_date', '>=', today)
  }

  const rows = await query.execute()
  const data = rows.map(r => ({ ...r, patient_name: `${r.first_name} ${r.last_name}` }))
  return c.json({ data })
})

// POST /api/followups
app.post('/', zValidator('json', z.object({
  case_id: z.string().uuid(),
  followup_date: z.string(),
  overall_improvement: z.number().int().min(0).max(10),
  symptom_changes: z.string().optional(),
  doctor_notes: z.string().optional(),
  action_taken: z.string(),
  next_followup_date: z.string().optional(),
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

  const followup = await db
    .insertInto('followups')
    .values({
      ...body,
      clinic_id: user.clinicId,
      patient_id: caseRecord.patient_id,
      doctor_id: user.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return c.json({ data: followup }, 201)
})

export { app as followupsRoutes }

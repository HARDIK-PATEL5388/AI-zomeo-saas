import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db, sql } from '../db/client'

const app = new Hono()

// Optional + nullable + accepts empty string. Mirrors the patients route
// convention so the frontend can echo a full row back on PUT without Zod
// rejecting null fields.
const optStr = z.string().nullish().or(z.literal(''))
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .nullish()
  .or(z.literal(''))

const followupCoreSchema = z.object({
  case_id: z.string().uuid(),
  patient_id: z.string().uuid().optional(),  // resolved from case_id if absent
  analysis_id: z.string().uuid().nullish(),
  prescription_id: z.string().uuid().nullish(),

  visit_date: dateString,
  complaints: optStr,
  remedy_name: optStr,
  remedy_code: z.coerce.number().int().nullish(),
  potency: optStr,
  dosage: optStr,
  repetition: optStr,
  days: optStr,
  prescription_type: optStr,
  remedy_response: optStr,
  diagnosis: optStr,
  preferences: optStr,
  investigations: optStr,
  examination: optStr,
  improvement_score: z.coerce.number().int().min(0).max(10).nullish(),
  next_visit_date: dateString,
  notes: optStr,

  // Legacy fields the analysis page may still send while we transition
  followup_date: dateString,
  overall_improvement: z.coerce.number().int().min(0).max(10).nullish(),
  symptom_changes: optStr,
  doctor_notes: optStr,
  action_taken: optStr,
  next_followup_date: dateString,
}).passthrough()

// Whitelist: only these columns get written on insert/update.
const ALLOWED_COLS = new Set<string>([
  'case_id', 'patient_id', 'analysis_id', 'prescription_id',
  'visit_date', 'complaints', 'remedy_name', 'remedy_code',
  'potency', 'dosage', 'repetition', 'days', 'prescription_type',
  'remedy_response', 'diagnosis', 'preferences', 'investigations',
  'examination', 'improvement_score', 'next_visit_date', 'notes',
  'followup_date', 'overall_improvement', 'symptom_changes',
  'doctor_notes', 'action_taken', 'next_followup_date',
])

function toRow(body: Record<string, unknown>) {
  const empty = (v: unknown) => (v === '' ? null : v)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_COLS.has(k)) continue
    if (v === undefined) continue
    out[k] = empty(v)
  }
  // Mirror legacy <-> new columns so either reader sees a value
  if (out.visit_date && !out.followup_date) out.followup_date = out.visit_date
  if (out.followup_date && !out.visit_date) out.visit_date = out.followup_date
  if (out.improvement_score != null && out.overall_improvement == null) out.overall_improvement = out.improvement_score
  if (out.overall_improvement != null && out.improvement_score == null) out.improvement_score = out.overall_improvement
  if (out.notes && !out.doctor_notes) out.doctor_notes = out.notes
  if (out.doctor_notes && !out.notes) out.notes = out.doctor_notes
  if (out.next_visit_date && !out.next_followup_date) out.next_followup_date = out.next_visit_date
  if (out.next_followup_date && !out.next_visit_date) out.next_visit_date = out.next_followup_date
  return out
}

const SELECT_FIELDS = [
  'fu.id', 'fu.case_id', 'fu.patient_id', 'fu.clinic_id', 'fu.doctor_id',
  'fu.analysis_id', 'fu.prescription_id',
  'fu.visit_date', 'fu.complaints', 'fu.remedy_name', 'fu.remedy_code',
  'fu.potency', 'fu.dosage', 'fu.repetition', 'fu.days',
  'fu.prescription_type', 'fu.remedy_response',
  'fu.diagnosis', 'fu.preferences', 'fu.investigations', 'fu.examination',
  'fu.improvement_score', 'fu.next_visit_date', 'fu.notes',
  'fu.followup_date', 'fu.overall_improvement', 'fu.symptom_changes',
  'fu.doctor_notes', 'fu.action_taken', 'fu.next_followup_date',
  'fu.created_by', 'fu.created_at', 'fu.updated_at',
] as const

// ----------------------------------------------------------------------------
// LIST — supports search (q), patient_id, remedy_code, from/to date, case_id
// ----------------------------------------------------------------------------
app.get('/', async (c) => {
  const user = c.get('user')
  const {
    case_id, patient_id, remedy_code, from, to, q,
    upcoming, limit = '100',
  } = c.req.query()

  let query = db
    .selectFrom('followups as fu')
    .innerJoin('cases as ca', 'ca.id', 'fu.case_id')
    .innerJoin('patients as p', 'p.id', 'fu.patient_id')
    .select([
      ...(SELECT_FIELDS as unknown as string[]),
      'p.first_name as patient_first_name',
      'p.last_name as patient_last_name',
      'ca.chief_complaint as case_chief_complaint',
    ] as any)
    .where('fu.clinic_id', '=', user.clinicId)
    .orderBy('fu.visit_date', 'desc')
    .orderBy('fu.created_at', 'desc')
    .limit(Math.min(500, parseInt(limit) || 100))

  if (case_id) query = query.where('fu.case_id', '=', case_id)
  if (patient_id) query = query.where('fu.patient_id', '=', patient_id)
  if (remedy_code) query = query.where('fu.remedy_code', '=', parseInt(remedy_code))
  if (from) query = query.where('fu.visit_date', '>=', from)
  if (to) query = query.where('fu.visit_date', '<=', to)
  if (upcoming === 'true') {
    const today = new Date().toISOString().slice(0, 10)
    query = query.where('fu.next_visit_date', '>=', today)
  }
  if (q) {
    query = query.where((eb) =>
      eb.or([
        eb('p.first_name', 'ilike', `%${q}%`),
        eb('p.last_name', 'ilike', `%${q}%`),
        eb('fu.complaints', 'ilike', `%${q}%`),
        eb('fu.remedy_name', 'ilike', `%${q}%`),
        eb('fu.diagnosis', 'ilike', `%${q}%`),
        eb('ca.chief_complaint', 'ilike', `%${q}%`),
      ])
    )
  }

  const rows = await query.execute()
  const data = rows.map((r: any) => ({
    ...r,
    patient_name: `${r.patient_first_name ?? ''} ${r.patient_last_name ?? ''}`.trim(),
  }))
  return c.json({ data })
})

// ----------------------------------------------------------------------------
// READ ONE
// ----------------------------------------------------------------------------
app.get('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()

  const row = await db
    .selectFrom('followups as fu')
    .innerJoin('cases as ca', 'ca.id', 'fu.case_id')
    .innerJoin('patients as p', 'p.id', 'fu.patient_id')
    .leftJoin('users as u', 'u.id', 'fu.doctor_id')
    .select([
      ...(SELECT_FIELDS as unknown as string[]),
      'p.first_name as patient_first_name',
      'p.last_name as patient_last_name',
      'p.phone as patient_phone',
      'p.email as patient_email',
      'p.age as patient_age',
      'p.gender as patient_gender',
      'ca.chief_complaint as case_chief_complaint',
      'ca.history as case_history',
      'ca.status as case_status',
      'u.first_name as doctor_first_name',
      'u.last_name as doctor_last_name',
    ] as any)
    .where('fu.id', '=', id)
    .where('fu.clinic_id', '=', user.clinicId)
    .executeTakeFirst()

  if (!row) return c.json({ error: 'Follow-up not found' }, 404)

  const data: any = {
    ...row,
    patient_name: `${(row as any).patient_first_name ?? ''} ${(row as any).patient_last_name ?? ''}`.trim(),
    doctor_name: `${(row as any).doctor_first_name ?? ''} ${(row as any).doctor_last_name ?? ''}`.trim(),
  }
  return c.json({ data })
})

// ----------------------------------------------------------------------------
// CREATE
// ----------------------------------------------------------------------------
app.post('/', zValidator('json', followupCoreSchema), async (c) => {
  const body = c.req.valid('json')
  const user = c.get('user')

  const caseRecord = await db
    .selectFrom('cases')
    .select(['id', 'patient_id'])
    .where('id', '=', body.case_id)
    .where('clinic_id', '=', user.clinicId)
    .executeTakeFirst()

  if (!caseRecord) return c.json({ error: 'Case not found' }, 404)

  const row = toRow(body as Record<string, unknown>)
  // Default visit_date / followup_date to today if both omitted (legacy NOT NULL safety)
  if (!row.visit_date && !row.followup_date) {
    const today = new Date().toISOString().slice(0, 10)
    row.visit_date = today
    row.followup_date = today
  }
  if (!row.patient_id) row.patient_id = caseRecord.patient_id

  try {
    const inserted = await db
      .insertInto('followups')
      .values({
        ...(row as any),
        clinic_id: user.clinicId,
        doctor_id: user.userId,
        created_by: user.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    return c.json({ data: inserted }, 201)
  } catch (err) {
    console.error('[followups] POST insert failed:', err)
    return c.json({ error: 'Insert failed', message: (err as Error).message }, 500)
  }
})

// ----------------------------------------------------------------------------
// UPDATE
// ----------------------------------------------------------------------------
app.put('/:id', zValidator('json', followupCoreSchema.partial()), async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const body = c.req.valid('json')

  const row = toRow(body as Record<string, unknown>)
  if (Object.keys(row).length === 0) {
    return c.json({ error: 'No updatable fields supplied' }, 400)
  }

  try {
    const updated = await db
      .updateTable('followups')
      .set(row as any)
      .where('id', '=', id)
      .where('clinic_id', '=', user.clinicId)
      .returningAll()
      .executeTakeFirst()

    if (!updated) return c.json({ error: 'Follow-up not found' }, 404)
    return c.json({ data: updated })
  } catch (err) {
    console.error('[followups] PUT update failed:', err)
    return c.json({ error: 'Update failed', message: (err as Error).message }, 500)
  }
})

// ----------------------------------------------------------------------------
// DELETE (hard delete; clinical history audit lives in the case timeline)
// ----------------------------------------------------------------------------
app.delete('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()

  const result = await db
    .deleteFrom('followups')
    .where('id', '=', id)
    .where('clinic_id', '=', user.clinicId)
    .executeTakeFirst()

  if (Number(result.numDeletedRows) === 0) {
    return c.json({ error: 'Follow-up not found' }, 404)
  }
  return c.json({ message: 'Follow-up deleted' })
})

// ----------------------------------------------------------------------------
// PATIENT HISTORY — used by /api/patients/:id/followups (also exposed here)
// ----------------------------------------------------------------------------
app.get('/by-patient/:patientId', async (c) => {
  const user = c.get('user')
  const { patientId } = c.req.param()

  const rows = await db
    .selectFrom('followups as fu')
    .innerJoin('cases as ca', 'ca.id', 'fu.case_id')
    .select([
      ...(SELECT_FIELDS as unknown as string[]),
      'ca.chief_complaint as case_chief_complaint',
    ] as any)
    .where('fu.clinic_id', '=', user.clinicId)
    .where('fu.patient_id', '=', patientId)
    .orderBy('fu.visit_date', 'desc')
    .orderBy('fu.created_at', 'desc')
    .execute()

  return c.json({ data: rows })
})

export { app as followupsRoutes }
void sql

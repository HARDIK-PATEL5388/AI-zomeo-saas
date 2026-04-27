import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db, sql } from '../db/client'

const app = new Hono()

// ----------------------------------------------------------------------------
// DTO — mirrors the Electron 4-tab patient registration form
// ----------------------------------------------------------------------------
const addressSchema = z
  .object({
    address: z.string().optional(),
    street: z.string().optional(),
    country: z.string().optional(),
    state: z.string().optional(),
    city: z.string().optional(),
    zip_code: z.string().optional(),
  })
  .partial()

const permanentAddressSchema = addressSchema.extend({
  same_as_current: z.boolean().optional(),
})

const contactDetailsSchema = z
  .object({
    home_number: z.string().optional(),
    office_number: z.string().optional(),
    website: z.string().optional(),
    emergency_number: z.string().optional(),
    fax_number: z.string().optional(),
  })
  .partial()

// Optional + nullable + accepts empty string. Keeps server tolerant when the
// frontend sends a full record back on PATCH (every unset column comes through
// as null from Postgres).
const optStr = z.string().nullish().or(z.literal(''))

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .nullish()
  .or(z.literal(''))

const patientSchema = z.object({
  // Tab 1 — Registration Information
  registration_date: dateString,
  registration_number: optStr,
  diagnosis: optStr,
  title: optStr,
  first_name: z.string().min(1, 'First name is required'),
  middle_name: optStr,
  last_name: optStr,
  phone: optStr,
  email: z.string().email().nullish().or(z.literal('')),
  date_of_birth: dateString,
  age: z.coerce.number().int().min(0).max(150).nullish(),
  blood_group: optStr,
  gender: z.enum(['male', 'female', 'other']).nullish().or(z.literal('')),
  referred_by: optStr,
  currency: optStr,
  consultation_charges: z.coerce.number().min(0).nullish(),
  follow_up_charges: z.coerce.number().min(0).nullish(),
  bill_to: optStr,
  opd_number: optStr,
  opd_date: dateString,
  ipd_number: optStr,
  ipd_date: dateString,
  remarks: optStr,
  photo_url: optStr,

  // Tab 2 — Preliminary Information
  occupation: optStr,
  organization: optStr,
  marital_status: optStr,
  religion: optStr,
  diet: optStr,
  prognosis: optStr,
  preliminary_remarks: optStr,

  // Tab 3 — Contact Details (nested)
  current_address: addressSchema.nullish(),
  permanent_address: permanentAddressSchema.nullish(),
  contact_details: contactDetailsSchema.nullish(),

  // Legacy single-line address (kept for back-compat)
  address: optStr,
}).passthrough()  // ignore extra DB columns the frontend may echo back (created_at, allergies, etc.)

// Whitelist of patient columns we will touch on insert/update. Anything else
// echoed back from the client (created_at, allergies, last_login_at, …) is
// silently dropped instead of being shoved into the SQL statement.
const ALLOWED_COLS = new Set([
  'registration_date','registration_number','diagnosis','title','first_name','middle_name','last_name',
  'phone','email','date_of_birth','age','blood_group','gender','referred_by','currency',
  'consultation_charges','follow_up_charges','bill_to','opd_number','opd_date','ipd_number','ipd_date',
  'remarks','photo_url',
  'occupation','organization','marital_status','religion','diet','prognosis','preliminary_remarks',
  'current_address','permanent_address','contact_details','address',
])

function toRow(body: Record<string, unknown>) {
  const empty = (v: unknown) => (v === '' ? null : v)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_COLS.has(k)) continue
    if (v === undefined) continue
    if (k === 'current_address' || k === 'permanent_address' || k === 'contact_details') {
      out[k] = JSON.stringify(v ?? {})
    } else {
      out[k] = empty(v)
    }
  }
  return out
}

// Auto-derive age from DOB when DOB present and age missing.
function deriveAge(body: z.infer<typeof patientSchema>) {
  if (body.age != null) return body.age
  if (!body.date_of_birth) return undefined
  const dob = new Date(body.date_of_birth)
  if (isNaN(dob.getTime())) return undefined
  const diff = Date.now() - dob.getTime()
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000))
}

// ----------------------------------------------------------------------------
// LIST
// ----------------------------------------------------------------------------
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
        eb('registration_number', 'ilike', `%${search}%`),
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

// ----------------------------------------------------------------------------
// READ
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// CREATE — saves all 4-tab fields
// ----------------------------------------------------------------------------
app.post('/', zValidator('json', patientSchema), async (c) => {
  const body = c.req.valid('json')
  const user = c.get('user')

  console.info('[patients] POST clinic=%s payload=%j', user.clinicId, body)

  // Resolve "same as current" address copy on the server too
  if (body.permanent_address?.same_as_current && body.current_address) {
    body.permanent_address = { ...body.current_address, same_as_current: true }
  }
  body.age = deriveAge(body)

  const row = toRow(body)

  try {
    const patient = await db
      .insertInto('patients')
      .values({ ...(row as any), clinic_id: user.clinicId, is_active: true })
      .returningAll()
      .executeTakeFirstOrThrow()
    console.info('[patients] POST inserted id=%s reg_no=%s',
      patient.id, (patient as any).registration_number)
    return c.json({ data: patient }, 201)
  } catch (err) {
    console.error('[patients] POST insert failed:', err)
    return c.json({ error: 'Insert failed', message: (err as Error).message }, 500)
  }
})

// ----------------------------------------------------------------------------
// UPDATE — saves all 4-tab fields
// ----------------------------------------------------------------------------
app.patch('/:id', zValidator('json', patientSchema.partial()), async (c) => {
  const { id } = c.req.param()
  const body = c.req.valid('json')
  const user = c.get('user')

  console.info('[patients] PATCH id=%s clinic=%s payload=%j', id, user.clinicId, body)

  if (body.permanent_address?.same_as_current && body.current_address) {
    body.permanent_address = { ...body.current_address, same_as_current: true }
  }
  if (body.date_of_birth && body.age == null) {
    body.age = deriveAge(body as any)
  }

  const row = toRow(body as any)

  try {
    const patient = await db
      .updateTable('patients')
      .set(row as any)
      .where('id', '=', id)
      .where('clinic_id', '=', user.clinicId)
      .returningAll()
      .executeTakeFirst()

    if (!patient) {
      console.warn('[patients] PATCH not found id=%s', id)
      return c.json({ error: 'Patient not found' }, 404)
    }
    console.info('[patients] PATCH updated id=%s', patient.id)
    return c.json({ data: patient })
  } catch (err) {
    console.error('[patients] PATCH update failed:', err)
    return c.json({ error: 'Update failed', message: (err as Error).message }, 500)
  }
})

// ----------------------------------------------------------------------------
// DELETE (soft)
// ----------------------------------------------------------------------------
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
// silence unused import warning for `sql` re-export consumers
void sql

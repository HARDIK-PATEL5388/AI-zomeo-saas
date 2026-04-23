import { Hono } from 'hono'
import { db } from '../db/client'

const app = new Hono()

app.get('/stats', async (c) => {
  const user = c.get('user')
  const clinicId = user.clinicId
  const today = new Date().toISOString().split('T')[0]

  const [patients, activeCases, prescriptions, followupsDue] = await Promise.all([
    db.selectFrom('patients')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('clinic_id', '=', clinicId)
      .where('is_active', '=', true)
      .executeTakeFirst(),
    db.selectFrom('cases')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('clinic_id', '=', clinicId)
      .where('status', '=', 'active')
      .executeTakeFirst(),
    db.selectFrom('prescriptions as pr')
      .innerJoin('cases as ca', 'ca.id', 'pr.case_id')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('ca.clinic_id', '=', clinicId)
      .executeTakeFirst(),
    db.selectFrom('followups as fu')
      .innerJoin('cases as ca', 'ca.id', 'fu.case_id')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('ca.clinic_id', '=', clinicId)
      .where('fu.next_followup_date', '>=', today)
      .executeTakeFirst(),
  ])

  return c.json({
    data: {
      patients: Number(patients?.count ?? 0),
      active_cases: Number(activeCases?.count ?? 0),
      prescriptions: Number(prescriptions?.count ?? 0),
      followups_due: Number(followupsDue?.count ?? 0),
    }
  })
})

export { app as adminRoutes }

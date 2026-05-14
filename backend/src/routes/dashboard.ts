import { Hono } from 'hono'
import { db } from '../db/client'

const app = new Hono()

// GET /api/dashboard/summary
// One-shot aggregate for the dashboard landing page:
//   - 4 stat counters
//   - 5 most recent cases
//   - 5 soonest upcoming follow-ups
// All clinic-scoped via the authenticated user's clinicId.
app.get('/summary', async (c) => {
  const user = c.get('user')
  const today = new Date().toISOString().slice(0, 10)

  const [
    patientsCount,
    activeCasesCount,
    prescriptionsCount,
    followupsDueCount,
    recentCasesRows,
    upcomingFollowupsRows,
  ] = await Promise.all([
    db
      .selectFrom('patients')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('clinic_id', '=', user.clinicId)
      .where('is_active', '=', true)
      .executeTakeFirst(),

    db
      .selectFrom('cases')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('clinic_id', '=', user.clinicId)
      .where('status', '=', 'active')
      .executeTakeFirst(),

    db
      .selectFrom('prescriptions')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('clinic_id', '=', user.clinicId)
      .executeTakeFirst(),

    db
      .selectFrom('followups')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('clinic_id', '=', user.clinicId)
      .where('next_visit_date', '>=', today)
      .executeTakeFirst(),

    db
      .selectFrom('cases as ca')
      .innerJoin('patients as p', 'p.id', 'ca.patient_id')
      .select([
        'ca.id', 'ca.patient_id', 'ca.chief_complaint',
        'ca.status', 'ca.created_at',
        'p.first_name', 'p.last_name',
      ])
      .where('ca.clinic_id', '=', user.clinicId)
      .orderBy('ca.created_at', 'desc')
      .limit(5)
      .execute(),

    db
      .selectFrom('followups as fu')
      .innerJoin('cases as ca', 'ca.id', 'fu.case_id')
      .innerJoin('patients as p', 'p.id', 'fu.patient_id')
      .select([
        'fu.id', 'fu.case_id', 'fu.patient_id',
        'fu.next_visit_date', 'fu.improvement_score', 'fu.action_taken',
        'p.first_name', 'p.last_name',
        'ca.chief_complaint as case_chief_complaint',
      ])
      .where('fu.clinic_id', '=', user.clinicId)
      .where('fu.next_visit_date', '>=', today)
      .orderBy('fu.next_visit_date', 'asc')
      .orderBy('fu.created_at', 'asc')
      .limit(5)
      .execute(),
  ])

  const recent_cases = recentCasesRows.map((r) => ({
    id: r.id,
    patient_id: r.patient_id,
    patient_name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
    chief_complaint: r.chief_complaint,
    status: r.status,
    created_at: r.created_at,
  }))

  const upcoming_followups = upcomingFollowupsRows.map((r: any) => ({
    id: r.id,
    case_id: r.case_id,
    patient_id: r.patient_id,
    patient_name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
    chief_complaint: r.case_chief_complaint,
    next_followup_date: r.next_visit_date,
    overall_improvement: r.improvement_score,
    action_taken: r.action_taken,
  }))

  return c.json({
    data: {
      stats: {
        patients: Number(patientsCount?.count ?? 0),
        active_cases: Number(activeCasesCount?.count ?? 0),
        prescriptions: Number(prescriptionsCount?.count ?? 0),
        followups_due: Number(followupsDueCount?.count ?? 0),
      },
      recent_cases,
      upcoming_followups,
    },
  })
})

export { app as dashboardRoutes }

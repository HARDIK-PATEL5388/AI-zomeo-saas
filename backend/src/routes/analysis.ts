// backend/src/routes/analysis.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { repertorizationEngine } from '../services/analysisEngine'
import { db } from '../db/client'

const app = new Hono()

// POST /api/analysis/run/:caseId - Run repertorization
app.post('/run/:caseId', async (c) => {
  const { caseId } = c.req.param()
  const { sourceId, saveResults = true } = await c.req.json()
  const user = c.get('user')

  // Verify doctor owns this case
  const caseRecord = await db
    .selectFrom('cases')
    .select(['id', 'clinic_id', 'patient_id'])
    .where('id', '=', caseId)
    .where('clinic_id', '=', user.clinicId)
    .executeTakeFirst()

  if (!caseRecord) {
    return c.json({ error: 'Case not found' }, 404)
  }

  const results = await repertorizationEngine.analyze(caseId, { sourceId })

  if (saveResults) {
    await repertorizationEngine.saveResults(caseId, results, sourceId)
  }

  return c.json({
    data: results,
    meta: {
      total: results.length,
      case_id: caseId,
      analyzed_at: new Date().toISOString(),
    }
  })
})

// POST /api/analysis/rubrics/:caseId - Add rubric to case
app.post('/rubrics/:caseId', zValidator('json', z.object({
  rubric_id: z.string().uuid(),
  source_id: z.string().uuid(),
  weight: z.number().int().min(1).max(4).default(1),
  notes: z.string().optional(),
})), async (c) => {
  const { caseId } = c.req.param()
  const body = c.req.valid('json')
  const user = c.get('user')

  const result = await db
    .insertInto('case_rubrics')
    .values({
      case_id: caseId,
      rubric_id: body.rubric_id,
      source_id: body.source_id,
      weight: body.weight,
      notes: body.notes,
      added_by: user.userId,
    })
    .onConflict((oc) => oc
      .columns(['case_id', 'rubric_id', 'source_id'])
      .doUpdateSet({ weight: body.weight, notes: body.notes })
    )
    .returningAll()
    .executeTakeFirst()

  return c.json({ data: result }, 201)
})

// DELETE /api/analysis/rubrics/:caseId/:rubricId
app.delete('/rubrics/:caseId/:rubricId', async (c) => {
  const { caseId, rubricId } = c.req.param()

  await db
    .deleteFrom('case_rubrics')
    .where('case_id', '=', caseId)
    .where('rubric_id', '=', rubricId)
    .execute()

  return c.json({ message: 'Rubric removed' })
})

// GET /api/analysis/:caseId - Get saved analysis results
app.get('/:caseId', async (c) => {
  const { caseId } = c.req.param()
  const user = c.get('user')

  const results = await db
    .selectFrom('analysis_results as ar')
    .innerJoin('remedies as r', 'r.id', 'ar.remedy_id')
    .innerJoin('cases as ca', 'ca.id', 'ar.case_id')
    .select([
      'ar.remedy_id',
      'r.name as remedy_name',
      'r.abbreviation',
      'ar.score',
      'ar.rank',
      'ar.rubric_coverage',
      'ar.total_rubrics',
      'ar.coverage_percent',
      'ar.grade_breakdown',
      'ar.analyzed_at',
    ])
    .where('ar.case_id', '=', caseId)
    .where('ca.clinic_id', '=', user.clinicId)
    .orderBy('ar.rank', 'asc')
    .execute()

  return c.json({ data: results })
})

// GET /api/analysis/rubrics/:caseId - Get case rubrics
app.get('/rubrics/:caseId', async (c) => {
  const { caseId } = c.req.param()

  const rubrics = await db
    .selectFrom('case_rubrics as cr')
    .innerJoin('rubrics as r', 'r.id', 'cr.rubric_id')
    .innerJoin('chapters as ch', 'ch.id', 'r.chapter_id')
    .select([
      'cr.id',
      'cr.rubric_id',
      'cr.weight',
      'cr.notes',
      'r.name as rubric_name',
      'r.full_path',
      'r.remedy_count',
      'ch.name as chapter_name',
    ])
    .where('cr.case_id', '=', caseId)
    .orderBy('cr.sort_order', 'asc')
    .execute()

  return c.json({ data: rubrics })
})

export { app as analysisRoutes }

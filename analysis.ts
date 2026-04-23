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

// GET /api/analysis/:caseId - Get saved analysis results
app.get('/:caseId', async (c) => {
  const { caseId } = c.req.param()
  const user = c.get('user')

  const results = await db
    .selectFrom('analysis_results as ar')
    .innerJoin('remedies as r', 'r.id', 'ar.remedy_id')
    .innerJoin('cases as c', 'c.id', 'ar.case_id')
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
    .where('c.clinic_id', '=', user.clinicId)
    .orderBy('ar.rank', 'asc')
    .execute()

  return c.json({ data: results })
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

// ============================================================
// backend/src/routes/ai.ts
// ============================================================
import { Hono as HonoAI } from 'hono'
import { aiService } from '../services/aiService'

const aiApp = new HonoAI()

// POST /api/ai/search - AI-powered rubric search
aiApp.post('/search', async (c) => {
  const { query, source_id, limit = 20 } = await c.req.json()

  if (!query || query.trim().length < 3) {
    return c.json({ error: 'Query must be at least 3 characters' }, 400)
  }

  const startTime = Date.now()
  const suggestions = await aiService.searchRubrics(query, source_id, limit)
  const responseTime = Date.now() - startTime

  // Log search for analytics
  const user = c.get('user')
  await db.insertInto('ai_search_logs').values({
    user_id: user.userId,
    clinic_id: user.clinicId,
    query,
    suggested_rubrics: JSON.stringify(suggestions.slice(0, 5)),
    response_time_ms: responseTime,
  }).execute()

  return c.json({
    data: suggestions,
    meta: { query, response_time_ms: responseTime, total: suggestions.length }
  })
})

// POST /api/ai/extract - Extract symptoms from text
aiApp.post('/extract', async (c) => {
  const { text } = await c.req.json()

  if (!text || text.trim().length < 10) {
    return c.json({ error: 'Text must be at least 10 characters' }, 400)
  }

  const symptoms = await aiService.extractSymptoms(text)
  return c.json({ data: symptoms })
})

// POST /api/ai/insights - Get prescription insights
aiApp.post('/insights', async (c) => {
  const { remedy_name, symptoms, score } = await c.req.json()
  const insights = await aiService.generatePrescriptionInsights(remedy_name, symptoms, score)
  return c.json({ data: { insights } })
})

export { aiApp as aiRoutes }

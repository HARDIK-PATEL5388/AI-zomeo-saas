// backend/src/routes/ai.ts
import { Hono } from 'hono'
import { aiService } from '../services/aiService'
import { db } from '../db/client'

const app = new Hono()

// POST /api/ai/search - AI-powered rubric search
app.post('/search', async (c) => {
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
app.post('/extract', async (c) => {
  const { text } = await c.req.json()

  if (!text || text.trim().length < 10) {
    return c.json({ error: 'Text must be at least 10 characters' }, 400)
  }

  const symptoms = await aiService.extractSymptoms(text)
  return c.json({ data: symptoms })
})

// POST /api/ai/insights - Get prescription insights
app.post('/insights', async (c) => {
  const { remedy_name, symptoms, score } = await c.req.json()
  const insights = await aiService.generatePrescriptionInsights(remedy_name, symptoms, score)
  return c.json({ data: { insights } })
})

export { app as aiRoutes }

// backend/src/routes/repertory.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db, sql } from '../db/client'

const app = new Hono()

// GET /api/repertory/sources - List all repertory sources
app.get('/sources', async (c) => {
  const sources = await db
    .selectFrom('repertory_sources')
    .selectAll()
    .where('is_active', '=', true)
    .orderBy('name', 'asc')
    .execute()

  return c.json({ data: sources })
})

// GET /api/repertory/chapters - Get chapters for a source
app.get('/chapters', async (c) => {
  const sourceId = c.req.query('source_id')

  let query = db
    .selectFrom('chapters as ch')
    .innerJoin('repertory_sources as rs', 'rs.id', 'ch.source_id')
    .select([
      'ch.id', 'ch.code', 'ch.slug', 'ch.name', 'ch.sort_order',
      'rs.name as source_name', 'rs.slug as source_slug'
    ])

  if (sourceId) {
    query = query.where('ch.source_id', '=', sourceId)
  }

  const chapters = await query.orderBy('ch.sort_order', 'asc').execute()
  return c.json({ data: chapters })
})

// GET /api/repertory/rubrics - Browse rubric tree
app.get('/rubrics', async (c) => {
  const { chapter_id, parent_id, source_id, level } = c.req.query()

  let query = db
    .selectFrom('rubrics as r')
    .leftJoin('chapters as ch', 'ch.id', 'r.chapter_id')
    .select([
      'r.id', 'r.name', 'r.full_path', 'r.level',
      'r.remedy_count', 'r.parent_id',
      'ch.name as chapter_name', 'ch.code as chapter_code'
    ])

  if (chapter_id) query = query.where('r.chapter_id', '=', chapter_id)
  if (source_id) query = query.where('r.source_id', '=', source_id)
  if (level) query = query.where('r.level', '=', parseInt(level))

  if (parent_id === 'null' || parent_id === '') {
    query = query.where('r.parent_id', 'is', null)
  } else if (parent_id) {
    query = query.where('r.parent_id', '=', parent_id)
  }

  const rubrics = await query
    .orderBy('r.name', 'asc')
    .limit(100)
    .execute()

  return c.json({ data: rubrics })
})

// GET /api/repertory/rubrics/:id - Get rubric with remedies
app.get('/rubrics/:id', async (c) => {
  const { id } = c.req.param()
  const { source_id } = c.req.query()

  const rubric = await db
    .selectFrom('rubrics as r')
    .leftJoin('chapters as ch', 'ch.id', 'r.chapter_id')
    .select([
      'r.id', 'r.name', 'r.full_path', 'r.level',
      'r.remedy_count', 'r.parent_id',
      'ch.name as chapter_name'
    ])
    .where('r.id', '=', id)
    .executeTakeFirst()

  if (!rubric) return c.json({ error: 'Rubric not found' }, 404)

  // Get remedies for this rubric
  let remediesQuery = db
    .selectFrom('rubric_remedies as rr')
    .innerJoin('remedies as rem', 'rem.id', 'rr.remedy_id')
    .select([
      'rem.id', 'rem.name', 'rem.abbreviation',
      'rr.grade',
    ])
    .where('rr.rubric_id', '=', id)

  if (source_id) {
    remediesQuery = remediesQuery.where('rr.source_id', '=', source_id)
  }

  const remedies = await remediesQuery.orderBy('rr.grade', 'desc').execute()

  // Get child rubrics
  const children = await db
    .selectFrom('rubrics')
    .select(['id', 'name', 'full_path', 'level', 'remedy_count'])
    .where('parent_id', '=', id)
    .orderBy('name', 'asc')
    .execute()

  return c.json({
    data: {
      ...rubric,
      remedies,
      children,
      remedy_by_grade: {
        grade_4: remedies.filter(r => r.grade === 4),
        grade_3: remedies.filter(r => r.grade === 3),
        grade_2: remedies.filter(r => r.grade === 2),
        grade_1: remedies.filter(r => r.grade === 1),
      }
    }
  })
})

// GET /api/repertory/search - Full-text search
app.get('/search', zValidator('query', z.object({
  q: z.string().min(2),
  source_id: z.string().uuid().optional(),
  chapter_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().max(50).default(20),
})), async (c) => {
  const { q, source_id, chapter_id, limit } = c.req.valid('query')

  const results = await sql<any>`
      SELECT 
        r.id,
        r.name,
        r.full_path,
        r.remedy_count,
        r.level,
        c.name as chapter_name,
        c.code as chapter_code,
        ts_rank(r.search_vector, plainto_tsquery('english', ${q})) as rank
      FROM rubrics r
      JOIN chapters c ON c.id = r.chapter_id
      WHERE r.search_vector @@ plainto_tsquery('english', ${q})
        ${source_id ? sql`AND r.source_id = ${source_id}` : sql``}
        ${chapter_id ? sql`AND r.chapter_id = ${chapter_id}` : sql``}
      ORDER BY rank DESC, r.remedy_count DESC
      LIMIT ${limit}
  `.execute(db)

  return c.json({
    data: results.rows,
    meta: { query: q, total: results.rows.length }
  })
})

// GET /api/repertory/remedies/:id/rubrics - Get all rubrics for a remedy
app.get('/remedies/:id/rubrics', async (c) => {
  const { id } = c.req.param()
  const { source_id } = c.req.query()

  let query = db
    .selectFrom('rubric_remedies as rr')
    .innerJoin('rubrics as r', 'r.id', 'rr.rubric_id')
    .innerJoin('chapters as ch', 'ch.id', 'r.chapter_id')
    .select([
      'r.id', 'r.name', 'r.full_path',
      'ch.name as chapter_name',
      'rr.grade'
    ])
    .where('rr.remedy_id', '=', id)

  if (source_id) query = query.where('rr.source_id', '=', source_id)

  const rubrics = await query.orderBy('rr.grade', 'desc').execute()
  return c.json({ data: rubrics })
})

// GET /api/repertory/remedies - List all remedies
app.get('/remedies', async (c) => {
  const { search } = c.req.query()

  let query = db
    .selectFrom('remedies')
    .select(['id', 'name', 'abbreviation', 'latin_name', 'category'])
    .where('is_active', '=', true)

  if (search) {
    query = query.where((eb) =>
      eb.or([
        eb('name', 'ilike', `%${search}%`),
        eb('abbreviation', 'ilike', `%${search}%`),
      ])
    )
  }

  const remedies = await query.orderBy('name', 'asc').execute()
  return c.json({ data: remedies })
})

export { app as repertoryRoutes }

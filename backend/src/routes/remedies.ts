// Zomeo.ai — Remedies Route
// GET /remedies, GET /remedies/:id, POST /remedies/compare

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth'
import { createClient } from '@supabase/supabase-js'

export const remediesRoutes = new Hono()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

remediesRoutes.use('*', authMiddleware)

// GET /api/remedies
remediesRoutes.get('/', async (c) => {
  const { q, kingdom, miasm, limit = '100' } = c.req.query()

  let query = supabase
    .from('remedies')
    .select('id, code, full_name, family, kingdom, miasm')
    .order('full_name')
    .limit(Number(limit))

  if (q) query = query.ilike('full_name', `%${q}%`)
  if (kingdom) query = query.eq('kingdom', kingdom)
  if (miasm) query = query.eq('miasm', miasm)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// GET /api/remedies/:id
remediesRoutes.get('/:id', async (c) => {
  const { data, error } = await supabase
    .from('remedies')
    .select('*, remedy_keynotes(*)')
    .eq('id', c.req.param('id'))
    .single()

  if (error) return c.json({ error: error.message }, 404)
  return c.json(data)
})

// POST /api/remedies/compare
remediesRoutes.post(
  '/compare',
  zValidator('json', z.object({ remedyIds: z.array(z.string()).min(2).max(5) })),
  async (c) => {
    const { remedyIds } = c.req.valid('json')

    const { data, error } = await supabase
      .from('remedies')
      .select('*, remedy_keynotes(*)')
      .in('id', remedyIds)

    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  }
)

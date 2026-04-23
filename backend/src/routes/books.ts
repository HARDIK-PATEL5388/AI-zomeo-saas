// Zomeo.ai — Books Route
// Reference book library + RAG-powered semantic search

import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { tenantMiddleware } from '../middleware/tenant'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

export const booksRoutes = new Hono()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

booksRoutes.use('*', authMiddleware, tenantMiddleware)

// GET /api/books — list all licensed books
booksRoutes.get('/', async (c) => {
  const tenantId = c.get('tenantId')

  const { data, error } = await supabase
    .from('books')
    .select('id, title, author, year, category')
    .eq('is_active', true)
    .order('title')

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// GET /api/books/search?q=... — semantic book search (RAG)
booksRoutes.get('/search', async (c) => {
  const { q } = c.req.query()
  if (!q || q.length < 3) return c.json({ error: 'Query must be at least 3 characters' }, 400)

  // Generate embedding for search query
  const embeddingRes = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: q,
    dimensions: 1536,
  })
  const embedding = embeddingRes.data[0].embedding

  // Vector search over book passages
  const { data, error } = await supabase.rpc('search_book_passages', {
    query_embedding: embedding,
    match_count: 10,
    match_threshold: 0.6,
  })

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// GET /api/books/:id — book detail with passage list
booksRoutes.get('/:id', async (c) => {
  const { data, error } = await supabase
    .from('books')
    .select('*, book_passages(id, heading, subheading)')
    .eq('id', c.req.param('id'))
    .eq('is_active', true)
    .single()

  if (error) return c.json({ error: error.message }, 404)
  return c.json(data)
})

// GET /api/books/:id/passages — full passage content
booksRoutes.get('/:id/passages', async (c) => {
  const { heading } = c.req.query()
  let query = supabase
    .from('book_passages')
    .select('id, heading, subheading, content_text')
    .eq('book_id', c.req.param('id'))
    .order('id')

  if (heading) query = query.ilike('heading', `%${heading}%`)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

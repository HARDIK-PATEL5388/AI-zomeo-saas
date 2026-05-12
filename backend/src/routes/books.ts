// Zomeo.ai — Books Route
// Reference book library + RAG-powered semantic search

import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { tenantMiddleware } from '../middleware/tenant'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { db, sql } from '../db/client'
import { getReader } from '../services/library/contentReaders'

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

// ============================================================
// Library reader (Materia Medica prototype)
// Legacy four-table chain: book_types → books → authors → chapters
// ============================================================

// GET /api/books/library/categories — sidebar categories with book counts
booksRoutes.get('/library/categories', async (c) => {
  const result = await sql<{
    id: number
    name: string
    sort_order: number
    book_count: string // pg returns COUNT(*) as text
  }>`
    SELECT bt.id, bt.name, bt.sort_order,
           COUNT(b.id) FILTER (WHERE b.is_active) AS book_count
      FROM lib_book_types bt
      LEFT JOIN lib_books b ON b.book_type_id = bt.id
     GROUP BY bt.id
     ORDER BY bt.sort_order
  `.execute(db)

  return c.json(
    result.rows.map(r => ({
      id: r.id,
      name: r.name,
      sort_order: r.sort_order,
      book_count: Number(r.book_count),
    }))
  )
})

// GET /api/books/library/categories/:typeId/books — books in a category
booksRoutes.get('/library/categories/:typeId/books', async (c) => {
  const typeId = Number(c.req.param('typeId'))
  if (!Number.isInteger(typeId)) return c.json({ error: 'Invalid typeId' }, 400)

  const result = await sql<{
    id: number
    title: string
    author: string | null
  }>`
    SELECT b.id, b.title, a.name AS author
      FROM lib_books b
      LEFT JOIN lib_authors a ON a.id = b.author_id
     WHERE b.book_type_id = ${typeId}
       AND b.is_active = TRUE
     ORDER BY b.title
  `.execute(db)

  return c.json(result.rows)
})

// GET /api/books/library/books/:bookId/chapters
// Returns book metadata + chapter list (no content yet — content fetched per chapter)
booksRoutes.get('/library/books/:bookId/chapters', async (c) => {
  const bookId = Number(c.req.param('bookId'))
  if (!Number.isInteger(bookId)) return c.json({ error: 'Invalid bookId' }, 400)

  const bookResult = await sql<{
    id: number
    title: string
    author: string | null
    category: string | null
  }>`
    SELECT b.id, b.title, a.name AS author, bt.name AS category
      FROM lib_books b
      LEFT JOIN lib_authors    a  ON a.id  = b.author_id
      LEFT JOIN lib_book_types bt ON bt.id = b.book_type_id
     WHERE b.id = ${bookId}
       AND b.is_active = TRUE
     LIMIT 1
  `.execute(db)

  if (bookResult.rows.length === 0) return c.json({ error: 'Book not found' }, 404)

  const chaptersResult = await sql<{
    id: number
    name: string
    sort_order: number
  }>`
    SELECT id, name, sort_order
      FROM lib_book_chapters
     WHERE book_id = ${bookId}
     ORDER BY sort_order
  `.execute(db)

  return c.json({
    book: bookResult.rows[0],
    chapters: chaptersResult.rows,
  })
})

// GET /api/books/library/chapters/:chapterId — chapter content (the body)
//
// Resolution order:
//   1. Seeded DB content (lib_book_chapters.content) wins. Lets us ship hand-
//      transcribed text for sample books before the file decoder exists.
//   2. Filesystem reader, dispatched by book format. Today only `mat` is
//      registered (placeholder). When the cipher is solved, swap that reader.
booksRoutes.get('/library/chapters/:chapterId', async (c) => {
  const chapterId = Number(c.req.param('chapterId'))
  if (!Number.isInteger(chapterId)) return c.json({ error: 'Invalid chapterId' }, 400)

  // Pull the chapter along with the parent book's fs_code + the NEXT chapter's
  // offset (for byte-range slicing). LEAD() returns NULL for the last chapter
  // of a book → reader interprets as "to EOF".
  const result = await sql<{
    id: number
    name: string
    content: string | null
    file_offset: number | null
    fs_code: string | null
    next_offset: number | null
  }>`
    SELECT c.id, c.name, c.content, c.file_offset,
           b.fs_code,
           LEAD(c.file_offset) OVER (PARTITION BY c.book_id ORDER BY c.sort_order) AS next_offset
      FROM lib_book_chapters c
      LEFT JOIN lib_books b ON b.id = c.book_id
     WHERE c.book_id = (SELECT book_id FROM lib_book_chapters WHERE id = ${chapterId})
     ORDER BY c.sort_order
  `.execute(db)

  const row = result.rows.find(r => r.id === chapterId)
  if (!row) return c.json({ error: 'Chapter not found' }, 404)

  // 1. Seeded DB content wins.
  if (row.content && row.content.length > 0) {
    return c.json({ id: row.id, name: row.name, content: row.content })
  }

  // 2. Fall back to file-based reader. Only .mat today.
  if (row.fs_code && row.file_offset !== null) {
    const reader = getReader('mat')
    if (reader) {
      const content = await reader.read({
        fsCode: row.fs_code,
        fileOffset: row.file_offset,
        nextFileOffset: row.next_offset ?? Number.POSITIVE_INFINITY,
        chapterName: row.name,
      })
      return c.json({ id: row.id, name: row.name, content })
    }
  }

  // 3. No content, no file. Return empty so the UI can show its own
  //    "Select a chapter" / "no content" state.
  return c.json({ id: row.id, name: row.name, content: '' })
})

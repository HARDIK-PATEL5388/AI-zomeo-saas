// Local Postgres TAB upload route — Hono
// Endpoints:
//   GET  /api/repertory-upload/required          → list of required files
//   POST /api/repertory-upload/validate          → validate uploaded files (no DB writes)
//   POST /api/repertory-upload/import            → validate + create job + import (sync wait)
//   POST /api/repertory-upload/import-async      → same, but returns jobId immediately
//   GET  /api/repertory-upload/jobs              → list recent jobs
//   GET  /api/repertory-upload/jobs/:id          → job detail (poll for status)
//   GET  /api/repertory-upload/jobs/:id/stream   → SSE progress stream

import { Hono } from 'hono'
import {
  REQUIRED_FILES,
  IMPORT_ORDER,
  DEFAULT_PARSER_ID,
  validateFiles,
  createJob,
  runImport,
  getJob,
  listJobs,
  previewFiles,
  resetData,
  localPool,
  listAvailableParsers,
  getParserSpec,
  type FileSummary,
  type JobMetadata,
} from '../services/repertoryUploadService'
import { getParser } from '../services/parsers/parserRegistry'

export const repertoryUploadRoutes = new Hono()

// FIX B6 — limits to prevent resource exhaustion
const MAX_FILE_BYTES  = 300 * 1024 * 1024  // 300 MB per file (Remlist is ~125 MB)
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024 // 1 GB total payload
// basename only, .tab/.csv/.txt extension, no path chars — broadened from
// .tab-only so non-TAB parsers (Jeremy/QRep CSVs etc.) can be uploaded too.
const VALID_NAME_RE   = /^[A-Za-z0-9_.-]+\.(tab|csv|txt)$/i

// In-memory progress logs (cleared on server restart)
const jobProgress = new Map<number, Array<{ file: string; message: string; time: string }>>()

// GET /api/repertory-upload/required[?parser=jeremy_qrep]
// Returns the file contract for the requested parser (defaults to complete_tab).
repertoryUploadRoutes.get('/required', (c) => {
  const parserId = (c.req.query('parser') || DEFAULT_PARSER_ID).trim()
  const spec = getParserSpec(parserId)
  if (!spec) return c.json({ error: `Unknown parser: ${parserId}` }, 400)
  return c.json({
    parser: { id: spec.id, name: spec.name, description: spec.description },
    files: spec.fileSpec.filter(f => f.required).map(f => f.name),
    optionalFiles: spec.fileSpec.filter(f => !f.required).map(f => f.name),
    fileSpec: spec.fileSpec,
    importOrder: spec.importOrder,
  })
})

// GET /api/repertory-upload/parsers — list every registered parser.
// Used by the wizard's "Create new book" → Parser type dropdown.
repertoryUploadRoutes.get('/parsers', (c) => {
  return c.json({
    data: listAvailableParsers().map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      fileCount: p.fileSpec.length,
      requiredCount: p.fileSpec.filter(f => f.required).length,
    })),
    default: DEFAULT_PARSER_ID,
  })
})

// ─── Books CRUD (used by the upload wizard) ────────────────────────────
function normalizeBookCode(raw: string): string {
  // First token only, lowercase, slug-safe — so "Kent Repertory" → "kent".
  const first = raw.toLowerCase().trim().split(/\s+/)[0] ?? ''
  return first
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

repertoryUploadRoutes.get('/books', async (c) => {
  const r = await localPool.query(
    `SELECT
       b.id, b.code, b.name, b.description, b.parser_type, b.sort_order, b.is_active, b.created_at,
       (SELECT COUNT(*) FROM rep_book_chapters bc WHERE bc.book_id = b.id)::int AS chapter_count,
       (SELECT COUNT(*) FROM rep_rubrics       r  WHERE r.book_id  = b.id)::int AS rubric_count
     FROM rep_books b
     WHERE b.is_active
     ORDER BY b.sort_order, b.name`,
  )
  return c.json({ data: r.rows })
})

repertoryUploadRoutes.post('/books', async (c) => {
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const rawCode = String(body?.code ?? '').trim()
  const name    = String(body?.name ?? '').trim()
  const description = body?.description ? String(body.description).slice(0, 500) : null
  const rawParser = String(body?.parserType ?? body?.parser_type ?? DEFAULT_PARSER_ID).trim()

  if (!name)    return c.json({ error: 'name is required' }, 400)
  if (!rawCode) return c.json({ error: 'code is required' }, 400)

  const code = normalizeBookCode(rawCode)
  if (!code || code.length < 2) {
    return c.json({ error: `Code "${rawCode}" normalizes to "${code}" — too short` }, 400)
  }

  // Reject unknown parser ids up front — protects rep_books from rows the
  // import pipeline can't dispatch later.
  if (!getParser(rawParser)) {
    return c.json({ error: `Unknown parser: "${rawParser}"` }, 400)
  }

  const existing = await localPool.query(`SELECT id, code, name FROM rep_books WHERE code=$1`, [code])
  if ((existing.rowCount ?? 0) > 0) {
    return c.json(
      { error: `Book code "${code}" already exists (${existing.rows[0].name})`, existing: existing.rows[0] },
      409,
    )
  }

  const sortRes = await localPool.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM rep_books`)
  const sortOrder = sortRes.rows[0].next as number

  const ins = await localPool.query(
    `INSERT INTO rep_books (code, name, description, parser_type, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, code, name, description, parser_type, sort_order, is_active, created_at`,
    [code, name, description, rawParser, sortOrder],
  )
  return c.json({ data: { ...ins.rows[0], chapter_count: 0, rubric_count: 0 } }, 201)
})

// Upload history grouped by book → used by the wizard summary panel.
repertoryUploadRoutes.get('/jobs/by-book', async (c) => {
  const limit = Math.min(500, parseInt(c.req.query('limit') ?? '200'))
  const r = await localPool.query(
    `SELECT
        COALESCE(b.code, fv.book_code, 'unknown') AS book_code,
        COALESCE(b.name, INITCAP(COALESCE(fv.book_code, 'Unknown'))) AS book_name,
        b.sort_order,
        fv.id, fv.job_id, fv.file_name, fv.status, fv.error_msg,
        fv.rows_added, fv.rows_updated, fv.rows_skipped,
        fv.imported_at, fv.md5_hash
       FROM rep_file_versions fv
       LEFT JOIN rep_books b ON b.code = fv.book_code
      ORDER BY b.sort_order NULLS LAST, fv.imported_at DESC
      LIMIT $1`,
    [limit],
  )

  const grouped = new Map<string, { code: string; name: string; entries: any[] }>()
  for (const row of r.rows) {
    const key = row.book_code
    if (!grouped.has(key)) grouped.set(key, { code: key, name: row.book_name, entries: [] })
    grouped.get(key)!.entries.push({
      id: row.id,
      job_id: row.job_id,
      file_name: row.file_name,
      status: row.status,
      error_msg: row.error_msg,
      rows_added: row.rows_added,
      rows_updated: row.rows_updated,
      rows_skipped: row.rows_skipped,
      imported_at: row.imported_at,
      md5_hash: row.md5_hash,
    })
  }
  return c.json({ data: Array.from(grouped.values()) })
})

type ReadResult =
  | { ok: true;  files: Map<string, Buffer>; metadata: JobMetadata }
  | { ok: false; status: 400 | 413; error: string }

async function readFormPayload(c: any): Promise<ReadResult> {
  // FIX B6 — early-reject oversized requests via Content-Length header
  const lenHdr = c.req.header('content-length')
  if (lenHdr && parseInt(lenHdr) > MAX_TOTAL_BYTES) {
    return { ok: false, status: 413, error: `Payload exceeds ${MAX_TOTAL_BYTES} bytes` }
  }

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch (err: any) {
    return { ok: false, status: 400, error: `Bad form-data: ${err.message}` }
  }

  const files = new Map<string, Buffer>()
  const metadata: JobMetadata = {}
  let totalBytes = 0

  for (const [key, value] of formData.entries()) {
    const v: any = value
    if (v && typeof v === 'object' && typeof v.arrayBuffer === 'function' && typeof v.name === 'string') {
      const name = String(v.name)

      // Validate filename — only basename, .tab ext, no path traversal chars
      if (!VALID_NAME_RE.test(name)) {
        return { ok: false, status: 400, error: `Invalid filename: ${name}` }
      }
      // Per-file size limit
      if (typeof v.size === 'number' && v.size > MAX_FILE_BYTES) {
        return { ok: false, status: 413, error: `${name} exceeds ${MAX_FILE_BYTES} bytes` }
      }
      const ab = await v.arrayBuffer()
      totalBytes += ab.byteLength
      if (totalBytes > MAX_TOTAL_BYTES) {
        return { ok: false, status: 413, error: `Total payload exceeds ${MAX_TOTAL_BYTES} bytes` }
      }
      files.set(name, Buffer.from(ab))
    } else if (typeof value === 'string') {
      if (key === 'source') metadata.source = value.slice(0, 100)
      else if (key === 'year') metadata.year = parseInt(value) || undefined
      else if (key === 'version') metadata.version = value.slice(0, 50)
      else if (key === 'bookCode') {
        metadata.bookCode = value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || undefined
      }
      else if (key === 'bookName') metadata.bookName = value.slice(0, 100)
      else if (key === 'parserType' || key === 'parser_type' || key === 'parserId') {
        metadata.parserId = value.slice(0, 60)
      }
    }
  }
  return { ok: true, files, metadata }
}

// Resolve the parser id for a request: explicit form field wins, else look it
// up from the book row, else fall back to the default. Returns null if the
// requested parser isn't registered.
async function resolveParserId(metadata: JobMetadata): Promise<string | null> {
  if (metadata.parserId) {
    return getParser(metadata.parserId) ? metadata.parserId : null
  }
  if (metadata.bookCode) {
    const r = await localPool.query(
      `SELECT parser_type FROM rep_books WHERE code = $1`,
      [metadata.bookCode],
    )
    const fromBook = r.rows[0]?.parser_type
    if (fromBook && getParser(fromBook)) return fromBook
  }
  return DEFAULT_PARSER_ID
}

function badPayload(c: any, r: { ok: false; status: number; error: string }) {
  return c.json({ error: r.error }, r.status as any)
}

repertoryUploadRoutes.post('/validate', async (c) => {
  const r = await readFormPayload(c)
  if (!r.ok) return badPayload(c, r)
  if (r.files.size === 0) return c.json({ error: 'No files uploaded' }, 400)
  const parserId = await resolveParserId(r.metadata)
  if (!parserId) return c.json({ error: `Unknown parser: ${r.metadata.parserId}` }, 400)
  const result = validateFiles(r.files, parserId)
  return c.json({
    valid: result.ok,
    received: Array.from(r.files.keys()),
    parser: parserId,
    issues: result.issues,
  })
})

// Preview — counts new vs existing PKs per file (no DB writes)
repertoryUploadRoutes.post('/preview', async (c) => {
  const r = await readFormPayload(c)
  if (!r.ok) return badPayload(c, r)
  if (r.files.size === 0) return c.json({ error: 'No files uploaded' }, 400)
  const parserId = await resolveParserId(r.metadata)
  if (!parserId) return c.json({ error: `Unknown parser: ${r.metadata.parserId}` }, 400)
  const validation = validateFiles(r.files, parserId)
  if (!validation.ok) {
    return c.json({ error: 'Validation failed', issues: validation.issues }, 422)
  }
  const preview = await previewFiles(r.files, r.metadata.bookCode || 'complete', parserId)
  const totals = preview.reduce(
    (a, p) => ({
      totalRows:    a.totalRows    + p.totalRows,
      parsedRows:   a.parsedRows   + p.parsedRows,
      newRows:      a.newRows      + p.newRows,
      existingRows: a.existingRows + p.existingRows,
      toUpdateRows: a.toUpdateRows + p.toUpdateRows,
      skippedRows:  a.skippedRows  + p.skippedRows,
    }),
    { totalRows: 0, parsedRows: 0, newRows: 0, existingRows: 0, toUpdateRows: 0, skippedRows: 0 },
  )
  return c.json({ preview, totals })
})

// Synchronous import — waits and returns full summary. Good for CLI/manual.
repertoryUploadRoutes.post('/import', async (c) => {
  const r = await readFormPayload(c)
  if (!r.ok) return badPayload(c, r)
  if (r.files.size === 0) return c.json({ error: 'No files uploaded' }, 400)

  const parserId = await resolveParserId(r.metadata)
  if (!parserId) return c.json({ error: `Unknown parser: ${r.metadata.parserId}` }, 400)
  r.metadata.parserId = parserId
  const validation = validateFiles(r.files, parserId)
  if (!validation.ok) {
    return c.json({ error: 'Validation failed', issues: validation.issues }, 422)
  }

  const jobId = await createJob(r.files, validation, r.metadata)
  jobProgress.set(jobId, [])
  try {
    const summary = await runImport(jobId, r.files, (file, message) => {
      const logs = jobProgress.get(jobId)!
      logs.push({ file, message, time: new Date().toISOString() })
    })
    return c.json({ jobId, status: summary.some(s => s.status === 'FAILED') ? 'failed' : 'done', summary })
  } catch (err: any) {
    return c.json({ jobId, status: 'failed', error: err.message }, 500)
  }
})

// Async import — returns jobId immediately, runs in background. Good for UI.
repertoryUploadRoutes.post('/import-async', async (c) => {
  const r = await readFormPayload(c)
  if (!r.ok) return badPayload(c, r)
  if (r.files.size === 0) return c.json({ error: 'No files uploaded' }, 400)

  const parserId = await resolveParserId(r.metadata)
  if (!parserId) return c.json({ error: `Unknown parser: ${r.metadata.parserId}` }, 400)
  r.metadata.parserId = parserId
  const validation = validateFiles(r.files, parserId)
  if (!validation.ok) {
    return c.json({ error: 'Validation failed', issues: validation.issues }, 422)
  }

  const jobId = await createJob(r.files, validation, r.metadata)
  jobProgress.set(jobId, [])

  setImmediate(async () => {
    try {
      await runImport(jobId, r.files, (file, message) => {
        const logs = jobProgress.get(jobId)!
        logs.push({ file, message, time: new Date().toISOString() })
      })
    } catch (err) {
      console.error(`[rep-upload ${jobId}]`, err)
    }
  })

  return c.json({ jobId, accepted: true }, 202)
})

// DELETE /api/repertory-upload/data — truncate all rep_* data tables
// (keeps job history; pass ?withHistory=1 to also wipe jobs)
repertoryUploadRoutes.delete('/data', async (c) => {
  const withHistory = c.req.query('withHistory') === '1'
  const tables = [
    'rep_xrefs', 'rep_rubric_remedies', 'rep_papasub', 'rep_library_index',
    'rep_page_refs', 'rep_polar_pairs', 'rep_rubrics', 'rep_book_chapters',
    'rep_remedies',
  ]
  await localPool.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY`)
  if (withHistory) {
    await localPool.query(`TRUNCATE rep_file_versions, rep_upload_jobs RESTART IDENTITY CASCADE`)
  } else {
    // Without history wipe, just clear file_versions so re-imports aren't deduped away
    await localPool.query(`TRUNCATE rep_file_versions RESTART IDENTITY`)
  }
  return c.json({ ok: true, truncated: tables, historyCleared: withHistory })
})

repertoryUploadRoutes.get('/jobs', async (c) => {
  return c.json(await listJobs(50))
})

repertoryUploadRoutes.get('/jobs/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const job = await getJob(id)
  if (!job) return c.json({ error: 'Job not found' }, 404)
  return c.json({ ...job, logs: jobProgress.get(id) ?? [] })
})

// GET /api/repertory-upload/status?jobId=123 → simple status poll
// (alias of /jobs/:id for the spec-required GET /upload/status endpoint)
repertoryUploadRoutes.get('/status', async (c) => {
  const idParam = c.req.query('jobId')
  if (!idParam) {
    // No jobId → return latest job
    const recent = await listJobs(1)
    if (recent.length === 0) return c.json({ status: 'no-jobs' })
    return c.json({ ...recent[0], logs: jobProgress.get(recent[0].id) ?? [] })
  }
  const id = Number(idParam)
  const job = await getJob(id)
  if (!job) return c.json({ error: 'Job not found' }, 404)
  return c.json({ ...job, logs: jobProgress.get(id) ?? [] })
})

// ─── Browse endpoints — book-scoped repertory data ─────────────────────
// Identifier convention:
//   • `book` query param accepts the book CODE (e.g. 'complete', 'kent').
//   • `rubric_id` is the global surrogate id from rep_rubrics.
//   • `ext_id` is meaningful only WITHIN a book.

// Resolve a book code → row. Returns null if not found.
async function getBookByCode(code: string) {
  const r = await localPool.query(
    `SELECT id, code, name, sort_order FROM rep_books WHERE code=$1 AND is_active`,
    [code],
  )
  return r.rows[0] ?? null
}

// GET /api/repertory-upload/browse/books → list books with chapter / rubric counts
repertoryUploadRoutes.get('/browse/books', async (c) => {
  const r = await localPool.query(
    `SELECT
       b.id, b.code, b.name, b.description, b.sort_order, b.is_active,
       (SELECT COUNT(*) FROM rep_book_chapters bc WHERE bc.book_id = b.id)::int AS chapter_count,
       (SELECT COUNT(*) FROM rep_rubrics       r  WHERE r.book_id  = b.id)::int AS rubric_count
     FROM rep_books b
     WHERE b.is_active
     ORDER BY b.sort_order, b.name`,
  )
  return c.json({ data: r.rows })
})

// GET /api/repertory-upload/browse/chapters?book=complete
repertoryUploadRoutes.get('/browse/chapters', async (c) => {
  const code = c.req.query('book') || 'complete'
  const book = await getBookByCode(code)
  if (!book) return c.json({ data: [] })

  const r = await localPool.query(
    `SELECT
        bc.id   AS chapter_id,
        bc.name AS chapter,
        bc.code,
        bc.sort_order,
        (SELECT COUNT(*) FROM rep_rubrics r
          WHERE r.book_id = bc.book_id AND r.chapter_id = bc.id)::int AS rubric_count
       FROM rep_book_chapters bc
      WHERE bc.book_id = $1
      ORDER BY bc.sort_order, bc.name`,
    [book.id],
  )
  return c.json({
    data: r.rows,
    book: { id: book.id, code: book.code, name: book.name },
  })
})

// GET /api/repertory-upload/browse/rubrics?book=complete&chapter=Mind&parent=root|<ext_id>&q=...
repertoryUploadRoutes.get('/browse/rubrics', async (c) => {
  const code      = c.req.query('book') || 'complete'
  const chapter   = c.req.query('chapter')           // chapter NAME (legacy) or numeric chapter_id
  const parent    = c.req.query('parent')            // ext_id of parent, or 'root'
  const limit     = Math.min(500, parseInt(c.req.query('limit') ?? '200'))
  const q         = c.req.query('q')

  const book = await getBookByCode(code)
  if (!book) return c.json({ data: [] })

  const where: string[] = ['r.book_id = $1']
  const params: any[] = [book.id]
  let p = 2

  if (chapter) {
    if (/^\d+$/.test(chapter)) {
      where.push(`r.chapter_id = $${p++}`); params.push(parseInt(chapter))
    } else {
      where.push(`r.chapter = $${p++}`); params.push(chapter)
    }
  }
  if (parent === 'root' || parent === 'null' || parent === '') {
    if (chapter) {
      // top-level for the chapter = rubrics at the minimum depth in that chapter
      const depthFilter = /^\d+$/.test(chapter)
        ? `(SELECT MIN(depth) FROM rep_rubrics WHERE book_id = $1 AND chapter_id = $${p++})`
        : `(SELECT MIN(depth) FROM rep_rubrics WHERE book_id = $1 AND chapter   = $${p++})`
      where.push(`r.depth = ${depthFilter}`)
      params.push(/^\d+$/.test(chapter) ? parseInt(chapter) : chapter)
    } else {
      where.push(`r.parent_ext_id IS NULL`)
    }
  } else if (parent) {
    where.push(`r.parent_ext_id = $${p++}`); params.push(parseInt(parent))
  }
  if (q) {
    where.push(`r.rubric_text ILIKE $${p++}`); params.push(`%${q}%`)
  }

  const sql = `
    SELECT
      r.rubric_id, r.book_id, r.ext_id, r.parent_ext_id, r.depth,
      r.chapter_id, r.chapter, r.full_path,
      COALESCE(
        NULLIF(regexp_replace(split_part(regexp_replace(r.full_path, '( > \\$)+$', ''), ' > ', -1), '^\\$$', ''), ''),
        NULLIF(r.rubric_text, '$'),
        r.rubric_text
      ) AS rubric_text,
      b.code AS book_code, b.name AS book_name,
      (SELECT COUNT(*) FROM rep_rubric_remedies rr
        WHERE rr.book_id = r.book_id AND rr.rubric_ext_id = r.ext_id)::int AS remedy_count,
      (SELECT COUNT(*) FROM rep_rubrics c
        WHERE c.book_id = r.book_id AND c.parent_ext_id = r.ext_id)::int AS child_count
    FROM rep_rubrics r
    JOIN rep_books   b ON b.id = r.book_id
    WHERE ${where.join(' AND ')}
    ORDER BY rubric_text
    LIMIT ${limit}
  `
  const r = await localPool.query(sql, params)
  return c.json({
    data: r.rows,
    book: { id: book.id, code: book.code, name: book.name },
  })
})

// GET /api/repertory-upload/browse/rubrics/:rubric_id → rubric + remedies (book-aware)
repertoryUploadRoutes.get('/browse/rubrics/:rubric_id', async (c) => {
  const rubricId = parseInt(c.req.param('rubric_id'))
  if (!Number.isFinite(rubricId)) return c.json({ error: 'Invalid rubric_id' }, 400)

  const rRes = await localPool.query(
    `SELECT
       r.rubric_id, r.book_id, r.ext_id, r.parent_ext_id, r.depth,
       r.chapter_id, r.chapter, r.full_path,
       COALESCE(
         NULLIF(regexp_replace(split_part(regexp_replace(r.full_path, '( > \\$)+$', ''), ' > ', -1), '^\\$$', ''), ''),
         NULLIF(r.rubric_text, '$'),
         r.rubric_text
       ) AS rubric_text,
       b.code AS book_code, b.name AS book_name
     FROM rep_rubrics r
     JOIN rep_books   b ON b.id = r.book_id
     WHERE r.rubric_id = $1`,
    [rubricId],
  )
  if (rRes.rowCount === 0) return c.json({ error: 'Rubric not found' }, 404)
  const rubric = rRes.rows[0]

  const remRes = await localPool.query(
    `SELECT rr.rem_code, rr.grade, rm.abbreviation, rm.full_name, rm.common_name
       FROM rep_rubric_remedies rr
       LEFT JOIN rep_remedies rm ON rm.rem_code = rr.rem_code
      WHERE rr.book_id = $1 AND rr.rubric_ext_id = $2
      ORDER BY rr.grade DESC, rm.abbreviation`,
    [rubric.book_id, rubric.ext_id],
  )
  const grouped: Record<string, any[]> = { grade_4: [], grade_3: [], grade_2: [], grade_1: [] }
  for (const row of remRes.rows) {
    const k = `grade_${row.grade}`
    if (grouped[k]) grouped[k].push({
      id: row.rem_code,
      rem_code: row.rem_code,
      abbreviation: row.abbreviation || `#${row.rem_code}`,
      full_name: row.full_name,
      common_name: row.common_name,
    })
  }

  return c.json({
    data: {
      ...rubric,
      remedy_count: remRes.rowCount,
      remedy_by_grade: grouped,
    },
  })
})

// GET /api/repertory-upload/browse/search?q=anxiety[&book=complete]
// When `book` is omitted, searches across all active books.
repertoryUploadRoutes.get('/browse/search', async (c) => {
  const q     = (c.req.query('q') || '').trim()
  const code  = c.req.query('book')
  const limit = Math.min(500, parseInt(c.req.query('limit') ?? '100'))
  if (q.length < 2) return c.json({ data: [] })

  const where: string[] = ['r.rubric_text ILIKE $1']
  const params: any[] = [`%${q}%`]
  let p = 2

  if (code) {
    const book = await getBookByCode(code)
    if (!book) return c.json({ data: [] })
    where.push(`r.book_id = $${p++}`); params.push(book.id)
  }

  const sql = `
    SELECT
      r.rubric_id, r.book_id, r.ext_id, r.parent_ext_id, r.depth,
      r.chapter_id, r.chapter, r.full_path,
      COALESCE(
        NULLIF(regexp_replace(split_part(regexp_replace(r.full_path, '( > \\$)+$', ''), ' > ', -1), '^\\$$', ''), ''),
        NULLIF(r.rubric_text, '$'),
        r.rubric_text
      ) AS rubric_text,
      b.code AS book_code, b.name AS book_name,
      (SELECT COUNT(*) FROM rep_rubric_remedies rr
        WHERE rr.book_id = r.book_id AND rr.rubric_ext_id = r.ext_id)::int AS remedy_count
    FROM rep_rubrics r
    JOIN rep_books   b ON b.id = r.book_id AND b.is_active
    WHERE ${where.join(' AND ')}
    ORDER BY b.sort_order, b.name, rubric_text
    LIMIT ${limit}
  `
  const r = await localPool.query(sql, params)
  return c.json({ data: r.rows, meta: { query: q, scope: code || 'all' } })
})

repertoryUploadRoutes.get('/jobs/:id/stream', async (c) => {
  const id = Number(c.req.param('id'))
  return new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder()
        let lastSent = 0
        const tick = setInterval(async () => {
          const logs = jobProgress.get(id) ?? []
          for (let i = lastSent; i < logs.length; i++) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(logs[i])}\n\n`))
          }
          lastSent = logs.length
          const job = await getJob(id)
          if (job && (job.status === 'done' || job.status === 'failed')) {
            controller.enqueue(
              enc.encode(`data: ${JSON.stringify({ type: 'complete', status: job.status, summary: job.summary })}\n\n`),
            )
            clearInterval(tick)
            controller.close()
          }
        }, 800)
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    },
  )
})

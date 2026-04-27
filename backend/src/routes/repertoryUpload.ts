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
  validateFiles,
  createJob,
  runImport,
  getJob,
  listJobs,
  previewFiles,
  resetData,
  localPool,
  type FileSummary,
  type JobMetadata,
} from '../services/repertoryUploadService'

export const repertoryUploadRoutes = new Hono()

// FIX B6 — limits to prevent resource exhaustion
const MAX_FILE_BYTES  = 300 * 1024 * 1024  // 300 MB per file (Remlist is ~125 MB)
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024 // 1 GB total payload
const VALID_NAME_RE   = /^[A-Za-z0-9_.-]+\.tab$/   // basename only, .tab ext, no path chars

// In-memory progress logs (cleared on server restart)
const jobProgress = new Map<number, Array<{ file: string; message: string; time: string }>>()

repertoryUploadRoutes.get('/required', (c) =>
  c.json({ files: REQUIRED_FILES, importOrder: IMPORT_ORDER }),
)

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
    }
  }
  return { ok: true, files, metadata }
}

function badPayload(c: any, r: { ok: false; status: number; error: string }) {
  return c.json({ error: r.error }, r.status as any)
}

repertoryUploadRoutes.post('/validate', async (c) => {
  const r = await readFormPayload(c)
  if (!r.ok) return badPayload(c, r)
  if (r.files.size === 0) return c.json({ error: 'No .tab files uploaded' }, 400)
  const result = validateFiles(r.files)
  return c.json({
    valid: result.ok,
    received: Array.from(r.files.keys()),
    issues: result.issues,
  })
})

// Preview — counts new vs existing PKs per file (no DB writes)
repertoryUploadRoutes.post('/preview', async (c) => {
  const r = await readFormPayload(c)
  if (!r.ok) return badPayload(c, r)
  if (r.files.size === 0) return c.json({ error: 'No .tab files uploaded' }, 400)
  const validation = validateFiles(r.files)
  if (!validation.ok) {
    return c.json({ error: 'Validation failed', issues: validation.issues }, 422)
  }
  const preview = await previewFiles(r.files)
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
  if (r.files.size === 0) return c.json({ error: 'No .tab files uploaded' }, 400)

  const validation = validateFiles(r.files)
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
  if (r.files.size === 0) return c.json({ error: 'No .tab files uploaded' }, 400)

  const validation = validateFiles(r.files)
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
    'rep_xrefs', 'rep_remlist', 'rep_papasub', 'rep_library_index',
    'rep_page_refs', 'rep_polar_pairs', 'rep_rubrics', 'rep_remedies',
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

// ─── Browse endpoints — read imported rep_* data ──────────────────────────
// GET /api/repertory-upload/browse/chapters → distinct chapters + rubric counts
repertoryUploadRoutes.get('/browse/chapters', async (c) => {
  const r = await localPool.query(
    `SELECT chapter, COUNT(*)::int AS rubric_count
     FROM rep_rubrics
     WHERE chapter IS NOT NULL AND chapter <> ''
     GROUP BY chapter
     ORDER BY chapter`,
  )
  return c.json({ data: r.rows })
})

// GET /api/repertory-upload/browse/rubrics?chapter=X[&parent=N][&limit=N][&q=text]
repertoryUploadRoutes.get('/browse/rubrics', async (c) => {
  const chapter   = c.req.query('chapter')
  const parent    = c.req.query('parent')           // ext_id of parent, or 'root'
  const limit     = Math.min(500, parseInt(c.req.query('limit') ?? '200'))
  const q         = c.req.query('q')

  const where: string[] = []
  const params: any[] = []
  let p = 1

  if (chapter) { where.push(`chapter = $${p++}`); params.push(chapter) }
  if (parent === 'root' || parent === 'null' || parent === '') {
    // "root" = top-level for the chapter = rubrics at the minimum depth in that chapter.
    // Fallback to NULL parent if no chapter is provided.
    if (chapter) {
      where.push(`depth = (SELECT MIN(depth) FROM rep_rubrics WHERE chapter = $${p++})`)
      params.push(chapter)
    } else {
      where.push(`parent_ext_id IS NULL`)
    }
  } else if (parent) {
    where.push(`parent_ext_id = $${p++}`); params.push(parseInt(parent))
  }
  if (q) {
    where.push(`rubric_text ILIKE $${p++}`); params.push(`%${q}%`)
  }

  // Derive a clean display name: full_path with trailing " > $" markers stripped,
  // then take the last segment. Falls back to rubric_text.
  const sql = `
    SELECT
      r.ext_id, r.parent_ext_id, r.depth, r.chapter, r.full_path,
      COALESCE(
        NULLIF(regexp_replace(split_part(regexp_replace(r.full_path, '( > \\$)+$', ''), ' > ', -1), '^\\$$', ''), ''),
        NULLIF(r.rubric_text, '$'),
        r.rubric_text
      ) AS rubric_text,
      (SELECT COUNT(*) FROM rep_remlist rl WHERE rl.rubric_ext_id = r.ext_id)::int AS remedy_count,
      (SELECT COUNT(*) FROM rep_rubrics c  WHERE c.parent_ext_id = r.ext_id)::int AS child_count
    FROM rep_rubrics r
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY rubric_text
    LIMIT ${limit}
  `
  const r = await localPool.query(sql, params)
  return c.json({ data: r.rows })
})

// GET /api/repertory-upload/browse/rubrics/:ext_id → rubric + remedies grouped by grade
repertoryUploadRoutes.get('/browse/rubrics/:ext_id', async (c) => {
  const extId = parseInt(c.req.param('ext_id'))
  if (!Number.isFinite(extId)) return c.json({ error: 'Invalid ext_id' }, 400)

  const rRes = await localPool.query(
    `SELECT
       ext_id, parent_ext_id, depth, chapter, full_path,
       COALESCE(
         NULLIF(regexp_replace(split_part(regexp_replace(full_path, '( > \\$)+$', ''), ' > ', -1), '^\\$$', ''), ''),
         NULLIF(rubric_text, '$'),
         rubric_text
       ) AS rubric_text
     FROM rep_rubrics WHERE ext_id = $1`,
    [extId],
  )
  if (rRes.rowCount === 0) return c.json({ error: 'Rubric not found' }, 404)
  const rubric = rRes.rows[0]

  const remRes = await localPool.query(
    `SELECT rl.rem_code, rl.grade, rm.abbreviation, rm.full_name, rm.common_name
     FROM rep_remlist rl
     LEFT JOIN rep_remedies rm ON rm.rem_code = rl.rem_code
     WHERE rl.rubric_ext_id = $1
     ORDER BY rl.grade DESC, rm.abbreviation`,
    [extId],
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

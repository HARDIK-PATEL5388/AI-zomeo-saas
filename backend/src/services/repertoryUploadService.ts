// Local Postgres (mydb) — Repertory Data Upload service
// Stack: pg Pool (NOT Supabase). Parser-agnostic orchestrator: it owns the
// pg pool, the rep_upload_jobs / rep_file_versions lifecycle, MD5 dedup, and
// per-file transactions, then delegates the actual file shape (validate /
// preview / per-file upsert) to a RepertoryParser pulled from the registry.
//
// Adding a new repertory format = adding a new parser file, NOT editing this.

import { Pool, PoolClient } from 'pg'
import crypto from 'crypto'
import { getParser, getParserOrThrow, listParsers } from './parsers/parserRegistry'
import type {
  FileStatus, FileSummary, ValidationIssue, ValidationResult, FilePreview, RepertoryParser,
} from './parsers/parser.types'

// Re-export parser types so route code keeps a single import surface.
export type { FileStatus, FileSummary, ValidationIssue, ValidationResult, FilePreview }

// ---------------------------------------------------------------------------
// Pool — uses LOCAL_DATABASE_URL if set, else DATABASE_URL.
// IMPORTANT: if your password contains '@' it MUST be URL-encoded as %40,
// e.g. postgres://postgres:StrongPassword%40123@localhost:5432/mydb
// ---------------------------------------------------------------------------
export const localPool = new Pool({
  connectionString: process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL,
  max: 10,
})

// ---------------------------------------------------------------------------
// Default parser — preserves single-book behavior for callers that haven't
// been parser-aware yet (CLI scripts, the old admin page, smoke tests).
// ---------------------------------------------------------------------------
export const DEFAULT_PARSER_ID = 'complete_tab'

// Back-compat shims: prior versions of this module exported REQUIRED_FILES /
// IMPORT_ORDER as constants. Routes still import them in places, so we expose
// the default parser's lists here. Once routes are parser-aware these can
// disappear.
export const REQUIRED_FILES = getParserOrThrow(DEFAULT_PARSER_ID)
  .fileSpec.filter(f => f.required).map(f => f.name)
export const IMPORT_ORDER = getParserOrThrow(DEFAULT_PARSER_ID).importOrder

// ---------------------------------------------------------------------------
// Validation / preview — both delegate to the parser; the orchestrator only
// owns the pool and book lookup.
// ---------------------------------------------------------------------------
export function validateFiles(
  files: Map<string, Buffer>,
  parserId: string = DEFAULT_PARSER_ID,
): ValidationResult {
  return getParserOrThrow(parserId).validate(files)
}

async function resolveBookId(bookCode: string): Promise<number | null> {
  const r = await localPool.query(`SELECT id FROM rep_books WHERE code = $1`, [bookCode])
  return (r.rowCount ?? 0) > 0 ? (r.rows[0].id as number) : null
}

export async function previewFiles(
  files: Map<string, Buffer>,
  bookCode: string = 'complete',
  parserId: string = DEFAULT_PARSER_ID,
): Promise<FilePreview[]> {
  const bookId = await resolveBookId(bookCode)
  return getParserOrThrow(parserId).preview(files, bookId, localPool)
}

// ---------------------------------------------------------------------------
// MD5 hash — for dedup of already-imported file versions
// ---------------------------------------------------------------------------
function md5(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex')
}

async function isAlreadyImported(client: PoolClient, bookCode: string, fileName: string, hash: string) {
  const r = await client.query(
    `SELECT 1 FROM rep_file_versions
      WHERE book_code=$1 AND file_name=$2 AND md5_hash=$3 AND status='done'
      LIMIT 1`,
    [bookCode, fileName, hash],
  )
  return r.rowCount! > 0
}

// ---------------------------------------------------------------------------
// Book lookup / creation. Each import job is scoped to one repertory book.
// 'complete' is the default and pre-seeded by migration 009.
// ---------------------------------------------------------------------------
async function ensureBook(
  client: PoolClient,
  code: string,
  name?: string,
  parserId?: string,
): Promise<number> {
  const found = await client.query(
    `SELECT id FROM rep_books WHERE code = $1`,
    [code],
  )
  if ((found.rowCount ?? 0) > 0) return found.rows[0].id as number
  // Pass parser_type at create-time. Without this, the column default
  // ('complete_tab', migration 010) silently masks the orchestrator's
  // resolved parser id, so a Murphy book ends up tagged complete_tab.
  const created = await client.query(
    `INSERT INTO rep_books (code, name, parser_type)
       VALUES ($1, $2, COALESCE($3, 'complete_tab'))
     RETURNING id`,
    [code, name ?? code.charAt(0).toUpperCase() + code.slice(1), parserId ?? null],
  )
  return created.rows[0].id as number
}

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------
export interface JobMetadata {
  source?: string
  year?: number
  version?: string
  /** Repertory book identifier — defaults to 'complete' for back-compat. */
  bookCode?: string
  /** Display name for a brand-new book; ignored if the book already exists. */
  bookName?: string
  /** Parser id (rep_books.parser_type). Defaults to DEFAULT_PARSER_ID. */
  parserId?: string
}

export async function createJob(
  files: Map<string, Buffer>,
  validation: ValidationResult,
  metadata: JobMetadata = {},
) {
  const r = await localPool.query(
    `INSERT INTO rep_upload_jobs (status, files, validation, metadata)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb)
     RETURNING id`,
    [
      validation.ok ? 'validated' : 'failed',
      JSON.stringify(Array.from(files.keys())),
      JSON.stringify(validation),
      JSON.stringify(metadata),
    ],
  )
  return r.rows[0].id as number
}

export async function getJob(id: number) {
  const r = await localPool.query(`SELECT * FROM rep_upload_jobs WHERE id=$1`, [id])
  return r.rows[0] ?? null
}

export async function listJobs(limit = 50) {
  const r = await localPool.query(
    `SELECT id, status, files, summary, error_msg, created_at, updated_at
     FROM rep_upload_jobs
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  )
  return r.rows
}

// ---------------------------------------------------------------------------
// Listing parsers (used by routes to advertise file specs to the wizard)
// ---------------------------------------------------------------------------
export function listAvailableParsers() {
  return listParsers().map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    fileSpec: p.fileSpec,
    importOrder: p.importOrder,
  }))
}

export function getParserSpec(id: string) {
  const p = getParser(id)
  return p ? { id: p.id, name: p.name, description: p.description, fileSpec: p.fileSpec, importOrder: p.importOrder } : null
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
export async function resetData(withHistory = false) {
  const dataTables = [
    'rep_xrefs', 'rep_rubric_remedies', 'rep_papasub', 'rep_library_index',
    'rep_page_refs', 'rep_polar_pairs', 'rep_rubrics', 'rep_book_chapters',
    'rep_remedies',
  ]
  await localPool.query(`TRUNCATE ${dataTables.join(', ')} RESTART IDENTITY`)
  if (withHistory) {
    await localPool.query(`TRUNCATE rep_file_versions, rep_upload_jobs RESTART IDENTITY CASCADE`)
  } else {
    await localPool.query(`TRUNCATE rep_file_versions RESTART IDENTITY`)
  }
}

// ---------------------------------------------------------------------------
// Run import — orchestrates: resolve parser → resolve/create book → for each
// file in parser.importOrder open a per-file transaction, dedup by MD5,
// delegate the actual UPSERT to parser.importFile, persist file_versions row.
// Failure on any one file rolls back ONLY that file's transaction.
// ---------------------------------------------------------------------------
export async function runImport(
  jobId: number,
  files: Map<string, Buffer>,
  onProgress?: (file: string, msg: string) => void,
): Promise<FileSummary[]> {
  await localPool.query(`UPDATE rep_upload_jobs SET status='importing', updated_at=NOW() WHERE id=$1`, [jobId])

  const jobMetaRes = await localPool.query(
    `SELECT metadata FROM rep_upload_jobs WHERE id=$1`,
    [jobId],
  )
  const meta: JobMetadata = jobMetaRes.rows[0]?.metadata ?? {}
  const bookCode = (meta.bookCode || 'complete').toLowerCase().trim()
  const bookName = meta.bookName

  // Parser resolution: explicit job metadata wins, else read from rep_books
  // for an existing book, else fall back to the default.
  let parserId = meta.parserId
  if (!parserId) {
    const rowRes = await localPool.query(
      `SELECT parser_type FROM rep_books WHERE code = $1`, [bookCode],
    )
    parserId = rowRes.rows[0]?.parser_type ?? DEFAULT_PARSER_ID
  }
  const parser: RepertoryParser = getParserOrThrow(parserId!)

  // Ensure the book exists. New book inherits parser_type from the chosen parser.
  let bookId: number
  {
    const setupClient = await localPool.connect()
    try {
      bookId = await ensureBook(setupClient, bookCode, bookName, parserId)
      // For pre-existing rows that were created before the parser_type column
      // (or saved with the default), align the column to the explicit parser
      // when the caller passed one in metadata. Don't overwrite an explicit
      // mismatch — that's the user's choice — only fix up unset/default values.
      if (meta.parserId) {
        await setupClient.query(
          `UPDATE rep_books
              SET parser_type = $1
            WHERE id = $2 AND (parser_type IS NULL OR parser_type = '' OR parser_type = 'complete_tab')
              AND $1 <> 'complete_tab'`,
          [parserId, bookId],
        )
      }
    } finally {
      setupClient.release()
    }
  }

  const summary: FileSummary[] = []

  for (const fileName of parser.importOrder) {
    const buf = files.get(fileName)
    if (!buf) {
      summary.push({ file: fileName, status: 'MISSING' })
      continue
    }

    const hash = md5(buf)
    const startedAt = Date.now()

    const client = await localPool.connect()
    let released = false
    try {
      if (await isAlreadyImported(client, bookCode, fileName, hash)) {
        summary.push({ file: fileName, status: 'UNCHANGED', hash, durationMs: Date.now() - startedAt })
        onProgress?.(fileName, 'Skipped (unchanged)')
        continue
      }

      await client.query('BEGIN')
      onProgress?.(fileName, `Importing into ${bookCode}...`)

      const v = await client.query(
        `INSERT INTO rep_file_versions (job_id, book_code, file_name, md5_hash, status, error_msg, rows_added, rows_updated, rows_skipped)
         VALUES ($1, $2, $3, $4, 'processing', NULL, 0, 0, 0)
         ON CONFLICT (book_code, file_name, md5_hash) DO UPDATE
           SET job_id     = EXCLUDED.job_id,
               status     = 'processing',
               error_msg  = NULL,
               rows_added = 0, rows_updated = 0, rows_skipped = 0,
               imported_at = NOW()
         RETURNING id`,
        [jobId, bookCode, fileName, hash],
      )
      const versionId = v.rows[0].id

      const result = await parser.importFile(client, fileName, buf, {
        bookId, bookCode, files, onProgress,
      })

      await client.query(
        `UPDATE rep_file_versions
         SET status='done', rows_added=$1, rows_updated=$2, rows_skipped=$3
         WHERE id=$4`,
        [result.added, result.updated, result.skipped, versionId],
      )
      await client.query('COMMIT')

      summary.push({
        file: fileName,
        status: 'SYNCED',
        hash,
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        durationMs: Date.now() - startedAt,
      })
      onProgress?.(fileName, `Done: +${result.added} ~${result.updated} -${result.skipped}`)
    } catch (err: any) {
      try { await client.query('ROLLBACK') } catch {}
      await localPool.query(
        `INSERT INTO rep_file_versions (job_id, book_code, file_name, md5_hash, status, error_msg)
         VALUES ($1,$2,$3,$4,'failed',$5)
         ON CONFLICT (book_code, file_name, md5_hash) DO UPDATE
           SET status='failed', error_msg=EXCLUDED.error_msg`,
        [jobId, bookCode, fileName, hash, err.message],
      )
      summary.push({ file: fileName, status: 'FAILED', error: err.message, durationMs: Date.now() - startedAt })
      onProgress?.(fileName, `FAILED: ${err.message}`)
    } finally {
      if (!released) {
        client.release()
        released = true
      }
    }

    await localPool.query(
      `UPDATE rep_upload_jobs SET summary=$1::jsonb, updated_at=NOW() WHERE id=$2`,
      [JSON.stringify(summary), jobId],
    )
  }

  const hasFailed = summary.some(s => s.status === 'FAILED')
  await localPool.query(
    `UPDATE rep_upload_jobs SET status=$1, summary=$2::jsonb, updated_at=NOW() WHERE id=$3`,
    [hasFailed ? 'failed' : 'done', JSON.stringify(summary), jobId],
  )
  return summary
}

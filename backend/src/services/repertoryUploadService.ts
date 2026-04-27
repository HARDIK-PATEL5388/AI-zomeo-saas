// Local Postgres (mydb) — Repertory Data Upload service
// Stack: pg Pool (NOT Supabase). Reads TAB buffers, validates, bulk-upserts.

import { Pool, PoolClient } from 'pg'
import crypto from 'crypto'
import { parseTabBuffer, col, colInt, chunk } from './tabParser'

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
// File contract — required files & expected min column counts
// ---------------------------------------------------------------------------
export const REQUIRED_FILES = [
  'RemID.tab',
  'REPolar.tab',
  'Complete.tab',
  'Pagerefs.tab',
  'LibraryIndex.tab',
  'PapaSub.tab',
  'Remlist.tab',
  'Xrefs.tab',
] as const

export const IMPORT_ORDER = REQUIRED_FILES // FK-safe order

const MIN_COLS: Record<string, number> = {
  'RemID.tab':        3,
  'REPolar.tab':      2,
  'Complete.tab':     8,
  'Pagerefs.tab':     2,
  'LibraryIndex.tab': 4,
  'PapaSub.tab':      2,
  'Remlist.tab':      3,
  'Xrefs.tab':        4,
}

export type FileStatus = 'SYNCED' | 'UNCHANGED' | 'MISSING' | 'FAILED'
export interface FileSummary {
  file: string
  status: FileStatus
  hash?: string
  added?: number
  updated?: number
  skipped?: number
  error?: string
  durationMs?: number
}

export interface ValidationIssue { file: string; problem: string }
export interface ValidationResult { ok: boolean; issues: ValidationIssue[] }

// ---------------------------------------------------------------------------
// Validation — checks: required files present, non-empty, min columns
// ---------------------------------------------------------------------------
export function validateFiles(files: Map<string, Buffer>): ValidationResult {
  const issues: ValidationIssue[] = []

  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) {
      issues.push({ file: required, problem: 'File missing' })
      continue
    }
    const buf = files.get(required)!
    if (buf.length === 0) {
      issues.push({ file: required, problem: 'File is empty' })
      continue
    }
    // Check first non-empty row has the minimum expected columns
    const rows = parseTabBuffer(buf)
    if (rows.length === 0) {
      issues.push({ file: required, problem: 'No parseable rows' })
      continue
    }
    const firstRow = rows.find(r => r.some(c => c.trim().length > 0))
    if (!firstRow || firstRow.length < (MIN_COLS[required] ?? 1)) {
      issues.push({
        file: required,
        problem: `Expected at least ${MIN_COLS[required]} columns, got ${firstRow?.length ?? 0}`,
      })
    }
  }

  return { ok: issues.length === 0, issues }
}

// ---------------------------------------------------------------------------
// MD5 hash — for dedup of already-imported file versions
// ---------------------------------------------------------------------------
function md5(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex')
}

async function isAlreadyImported(client: PoolClient, fileName: string, hash: string) {
  const r = await client.query(
    `SELECT 1 FROM rep_file_versions WHERE file_name=$1 AND md5_hash=$2 AND status='done' LIMIT 1`,
    [fileName, hash],
  )
  return r.rowCount! > 0
}

// ---------------------------------------------------------------------------
// Generic batched UPSERT helper.
// Builds a single INSERT ... VALUES ($1,$2),($3,$4) ... ON CONFLICT DO UPDATE
// ---------------------------------------------------------------------------
async function batchUpsert(
  client: PoolClient,
  table: string,
  columns: string[],
  conflictCols: string[],
  updateCols: string[],
  rows: any[][],
  batchSize = 500,
): Promise<number> {
  if (rows.length === 0) return 0
  let total = 0
  const colSql = columns.join(', ')
  const conflictSql = conflictCols.join(', ')
  const updateSql = updateCols.length
    ? updateCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')
    : ''
  const onConflict = updateCols.length
    ? `ON CONFLICT (${conflictSql}) DO UPDATE SET ${updateSql}`
    : `ON CONFLICT (${conflictSql}) DO NOTHING`

  for (const batch of chunk(rows, batchSize)) {
    const params: any[] = []
    const placeholders: string[] = []
    let idx = 1
    for (const row of batch) {
      const slots: string[] = []
      for (const v of row) {
        params.push(v)
        slots.push(`$${idx++}`)
      }
      placeholders.push(`(${slots.join(',')})`)
    }
    const sql = `INSERT INTO ${table} (${colSql}) VALUES ${placeholders.join(',')} ${onConflict}`
    const r = await client.query(sql, params)
    total += r.rowCount ?? batch.length
  }
  return total
}

// ---------------------------------------------------------------------------
// Per-file importers (each runs inside a single transaction)
// ---------------------------------------------------------------------------

async function importRemID(client: PoolClient, buf: Buffer) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const code = colInt(row, 0)
    if (!code) { skipped++; continue }
    records.push([code, col(row, 1), col(row, 2) || col(row, 1), col(row, 3) || null])
  }
  // updated_at is refreshed on conflict via EXCLUDED.updated_at (default = NOW())
  const added = await batchUpsert(
    client,
    'rep_remedies',
    ['rem_code', 'abbreviation', 'full_name', 'common_name'],
    ['rem_code'],
    ['abbreviation', 'full_name', 'common_name', 'updated_at'],
    records,
    1000,
  )
  return { added, updated: 0, skipped }
}

async function importComplete(client: PoolClient, buf: Buffer) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0

  for (const row of rows) {
    const extId = colInt(row, 0)
    if (!extId) { skipped++; continue }

    const parent = colInt(row, 2) || null
    const depth = colInt(row, 4)
    const chapter = col(row, 6)

    const parts: string[] = []
    for (let c = 7; c < row.length; c++) {
      const p = col(row, c)
      if (p) parts.push(p)
    }
    const text = parts[parts.length - 1] || ''
    if (!text) { skipped++; continue }

    records.push([
      extId,
      parent,
      depth,
      chapter || null,
      text,
      parts.join(' > ') || text,
    ])
  }

  const added = await batchUpsert(
    client,
    'rep_rubrics',
    ['ext_id', 'parent_ext_id', 'depth', 'chapter', 'rubric_text', 'full_path'],
    ['ext_id'],
    ['parent_ext_id', 'depth', 'chapter', 'rubric_text', 'full_path', 'updated_at'],
    records,
    500,
  )
  return { added, updated: 0, skipped }
}

async function importREPolar(client: PoolClient, buf: Buffer) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const a = colInt(row, 0), b = colInt(row, 1)
    if (!a || !b) { skipped++; continue }
    records.push([a, b])
  }
  const added = await batchUpsert(
    client,
    'rep_polar_pairs',
    ['ext_id_1', 'ext_id_2'],
    ['ext_id_1', 'ext_id_2'],
    [],
    records,
    1000,
  )
  return { added, updated: 0, skipped }
}

async function importPagerefs(client: PoolClient, buf: Buffer) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const ext = colInt(row, 0)
    if (!ext) { skipped++; continue }
    records.push([ext, col(row, 1) || '?', colInt(row, 2, 0)])
  }
  const added = await batchUpsert(
    client,
    'rep_page_refs',
    ['rubric_ext_id', 'book_code', 'page_number'],
    ['rubric_ext_id', 'book_code', 'page_number'],
    [],
    records,
    1000,
  )
  return { added, updated: 0, skipped }
}

async function importLibraryIndex(client: PoolClient, buf: Buffer) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const ext = colInt(row, 0)
    if (!ext) { skipped++; continue }
    records.push([ext, col(row, 3), col(row, 4), col(row, 5)])
  }
  const added = await batchUpsert(
    client,
    'rep_library_index',
    ['rubric_ext_id', 'reference', 'author', 'year'],
    ['rubric_ext_id', 'reference', 'author', 'year'],
    [],
    records,
    1000,
  )
  return { added, updated: 0, skipped }
}

async function importPapaSub(client: PoolClient, buf: Buffer) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const ext = colInt(row, 0), code = colInt(row, 1)
    if (!ext || !code) { skipped++; continue }
    records.push([ext, code])
  }
  const added = await batchUpsert(
    client,
    'rep_papasub',
    ['rubric_ext_id', 'rem_code'],
    ['rubric_ext_id', 'rem_code'],
    [],
    records,
    2000,
  )
  return { added, updated: 0, skipped }
}

async function importXrefs(client: PoolClient, buf: Buffer) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const xref   = colInt(row, 0)
    const ext1   = colInt(row, 2)
    const ext2   = colInt(row, 3)
    if (!xref || !ext1 || !ext2) { skipped++; continue }
    const pair   = colInt(row, 1) || null
    const rel    = Math.min(127, Math.max(0, colInt(row, 4, 0)))
    records.push([xref, pair, ext1, ext2, rel])
  }
  const added = await batchUpsert(
    client,
    'rep_xrefs',
    ['xref_id', 'pair_id', 'rubric_ext_id_1', 'rubric_ext_id_2', 'rel_type'],
    ['xref_id'],
    ['pair_id', 'rubric_ext_id_1', 'rubric_ext_id_2', 'rel_type'],
    records,
    1000,
  )
  return { added, updated: 0, skipped }
}

async function importRemlist(client: PoolClient, buf: Buffer) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const ext = colInt(row, 0), code = colInt(row, 1)
    if (!ext || !code) { skipped++; continue }
    const grade = Math.min(4, Math.max(1, colInt(row, 2, 1)))
    records.push([ext, code, grade])
  }
  // Largest file (~2.8M rows). Batched UPSERT keeps memory bounded.
  const added = await batchUpsert(
    client,
    'rep_remlist',
    ['rubric_ext_id', 'rem_code', 'grade'],
    ['rubric_ext_id', 'rem_code'],
    ['grade'],
    records,
    2000,
  )
  return { added, updated: 0, skipped }
}

// ---------------------------------------------------------------------------
// Per-file dispatch
// ---------------------------------------------------------------------------
const IMPORTERS: Record<string, (c: PoolClient, b: Buffer) => Promise<{ added: number; updated: number; skipped: number }>> = {
  'RemID.tab':        importRemID,
  'REPolar.tab':      importREPolar,
  'Complete.tab':     importComplete,
  'Pagerefs.tab':     importPagerefs,
  'LibraryIndex.tab': importLibraryIndex,
  'PapaSub.tab':      importPapaSub,
  'Remlist.tab':      importRemlist,
  'Xrefs.tab':        importXrefs,
}

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------
export interface JobMetadata {
  source?: string
  year?: number
  version?: string
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

// ---------------------------------------------------------------------------
// Preview — counts new/existing rows per file without writing.
// Uses each table's PK to detect "would be insert" vs "would be update".
// ---------------------------------------------------------------------------
export interface FilePreview {
  file: string
  totalRows: number
  parsedRows: number
  newRows: number
  existingRows: number
  toUpdateRows: number   // existing rows whose data would change
  unchangedRows: number  // existing rows that match exactly
  skippedRows: number
}

const BATCH_KEYS = 1000

async function pkExistsBatch(table: string, pkCols: string[], rows: any[][]): Promise<Set<string>> {
  const existing = new Set<string>()
  if (rows.length === 0) return existing
  const colList = pkCols.join(',')
  for (let i = 0; i < rows.length; i += BATCH_KEYS) {
    const chunkRows = rows.slice(i, i + BATCH_KEYS)
    const placeholders: string[] = []
    const params: any[] = []
    let p = 1
    for (const r of chunkRows) {
      const slots: string[] = []
      for (const v of r) { params.push(v); slots.push(`$${p++}`) }
      placeholders.push(`(${slots.join(',')})`)
    }
    const sql = `SELECT ${colList} FROM ${table} WHERE (${colList}) IN (${placeholders.join(',')})`
    const res = await localPool.query(sql, params)
    for (const row of res.rows) {
      existing.add(pkCols.map(c => String(row[c])).join('|'))
    }
  }
  return existing
}

export async function previewFiles(files: Map<string, Buffer>): Promise<FilePreview[]> {
  const results: FilePreview[] = []

  for (const fileName of REQUIRED_FILES) {
    const buf = files.get(fileName)
    if (!buf) {
      results.push({ file: fileName, totalRows: 0, parsedRows: 0, newRows: 0, existingRows: 0, toUpdateRows: 0, unchangedRows: 0, skippedRows: 0 })
      continue
    }
    const rows = parseTabBuffer(buf)
    const totalRows = rows.length

    let pkRows: any[][] = []
    let table = ''
    let pkCols: string[] = []
    let skipped = 0

    if (fileName === 'RemID.tab') {
      table = 'rep_remedies'; pkCols = ['rem_code']
      for (const row of rows) {
        const code = colInt(row, 0); if (!code) { skipped++; continue }
        pkRows.push([code])
      }
    } else if (fileName === 'REPolar.tab') {
      table = 'rep_polar_pairs'; pkCols = ['ext_id_1','ext_id_2']
      for (const row of rows) {
        const a = colInt(row, 0), b = colInt(row, 1)
        if (!a || !b) { skipped++; continue }
        pkRows.push([a, b])
      }
    } else if (fileName === 'Complete.tab') {
      table = 'rep_rubrics'; pkCols = ['ext_id']
      for (const row of rows) {
        const ext = colInt(row, 0); if (!ext) { skipped++; continue }
        pkRows.push([ext])
      }
    } else if (fileName === 'Pagerefs.tab') {
      table = 'rep_page_refs'; pkCols = ['rubric_ext_id','book_code','page_number']
      for (const row of rows) {
        const ext = colInt(row, 0); if (!ext) { skipped++; continue }
        pkRows.push([ext, col(row, 1) || '?', colInt(row, 2, 0)])
      }
    } else if (fileName === 'LibraryIndex.tab') {
      table = 'rep_library_index'; pkCols = ['rubric_ext_id','reference','author','year']
      for (const row of rows) {
        const ext = colInt(row, 0); if (!ext) { skipped++; continue }
        pkRows.push([ext, col(row, 3), col(row, 4), col(row, 5)])
      }
    } else if (fileName === 'PapaSub.tab') {
      table = 'rep_papasub'; pkCols = ['rubric_ext_id','rem_code']
      for (const row of rows) {
        const ext = colInt(row, 0), code = colInt(row, 1)
        if (!ext || !code) { skipped++; continue }
        pkRows.push([ext, code])
      }
    } else if (fileName === 'Remlist.tab') {
      table = 'rep_remlist'; pkCols = ['rubric_ext_id','rem_code']
      for (const row of rows) {
        const ext = colInt(row, 0), code = colInt(row, 1)
        if (!ext || !code) { skipped++; continue }
        pkRows.push([ext, code])
      }
    } else if (fileName === 'Xrefs.tab') {
      table = 'rep_xrefs'; pkCols = ['xref_id']
      for (const row of rows) {
        const xref = colInt(row, 0)
        const ext1 = colInt(row, 2), ext2 = colInt(row, 3)
        if (!xref || !ext1 || !ext2) { skipped++; continue }
        pkRows.push([xref])
      }
    }

    // For very large files (Remlist > 100k), use a fast COUNT approach:
    // sample only the first N PKs, extrapolate proportions. For accuracy on
    // smaller files, do exact lookup.
    let existingCount = 0
    let toUpdate = 0
    let unchanged = 0

    if (pkRows.length === 0) {
      results.push({ file: fileName, totalRows, parsedRows: 0, newRows: 0, existingRows: 0, toUpdateRows: 0, unchangedRows: 0, skippedRows: skipped })
      continue
    }

    // For Remlist (millions of rows), exact preview is too slow.
    // Instead: count target rows and existing rows in DB; assume overlap = min.
    const isHuge = pkRows.length > 100_000
    if (isHuge) {
      const existingTotalRes = await localPool.query(`SELECT COUNT(*)::int AS c FROM ${table}`)
      const existingInDb = existingTotalRes.rows[0].c as number
      // Heuristic: if our payload is a re-upload of the same data, overlap ≈ min.
      // We can't know exact overlap without scanning. Estimate:
      existingCount = Math.min(existingInDb, pkRows.length)
      toUpdate = existingCount  // assume potential update for all matched
      unchanged = 0             // unknown without column comparison
    } else {
      const existingSet = await pkExistsBatch(table, pkCols, pkRows)
      existingCount = existingSet.size
      // Without full column comparison we treat all existing as potentially-updated.
      toUpdate = existingCount
      unchanged = 0
    }

    results.push({
      file: fileName,
      totalRows,
      parsedRows: pkRows.length,
      newRows: pkRows.length - existingCount,
      existingRows: existingCount,
      toUpdateRows: toUpdate,
      unchangedRows: unchanged,
      skippedRows: skipped,
    })
  }

  return results
}

export async function getJob(id: number) {
  const r = await localPool.query(`SELECT * FROM rep_upload_jobs WHERE id=$1`, [id])
  return r.rows[0] ?? null
}

export async function resetData(withHistory = false) {
  const dataTables = [
    'rep_xrefs', 'rep_remlist', 'rep_papasub', 'rep_library_index',
    'rep_page_refs', 'rep_polar_pairs', 'rep_rubrics', 'rep_remedies',
  ]
  await localPool.query(`TRUNCATE ${dataTables.join(', ')} RESTART IDENTITY`)
  if (withHistory) {
    await localPool.query(`TRUNCATE rep_file_versions, rep_upload_jobs RESTART IDENTITY CASCADE`)
  } else {
    await localPool.query(`TRUNCATE rep_file_versions RESTART IDENTITY`)
  }
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

export async function runImport(
  jobId: number,
  files: Map<string, Buffer>,
  onProgress?: (file: string, msg: string) => void,
): Promise<FileSummary[]> {
  await localPool.query(`UPDATE rep_upload_jobs SET status='importing', updated_at=NOW() WHERE id=$1`, [jobId])

  const summary: FileSummary[] = []

  for (const fileName of IMPORT_ORDER) {
    const buf = files.get(fileName)
    if (!buf) {
      summary.push({ file: fileName, status: 'MISSING' })
      continue
    }

    const hash = md5(buf)
    const startedAt = Date.now()

    // Per-file transaction — rollback on failure
    const client = await localPool.connect()
    let released = false
    try {
      if (await isAlreadyImported(client, fileName, hash)) {
        summary.push({ file: fileName, status: 'UNCHANGED', hash, durationMs: Date.now() - startedAt })
        onProgress?.(fileName, 'Skipped (unchanged)')
        continue
      }

      // FIX B1 — file_version row + data + status all inside ONE transaction.
      // On failure, ROLLBACK removes the 'processing' row; the catch block then
      // writes a fresh 'failed' row via a separate connection.
      await client.query('BEGIN')
      onProgress?.(fileName, 'Importing...')

      const v = await client.query(
        `INSERT INTO rep_file_versions (job_id, file_name, md5_hash, status, error_msg, rows_added, rows_updated, rows_skipped)
         VALUES ($1, $2, $3, 'processing', NULL, 0, 0, 0)
         ON CONFLICT (file_name, md5_hash) DO UPDATE
           SET job_id     = EXCLUDED.job_id,
               status     = 'processing',
               error_msg  = NULL,
               rows_added = 0, rows_updated = 0, rows_skipped = 0,
               imported_at = NOW()
         RETURNING id`,
        [jobId, fileName, hash],
      )
      const versionId = v.rows[0].id

      const fn = IMPORTERS[fileName]
      const result = await fn(client, buf)

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
        `INSERT INTO rep_file_versions (job_id, file_name, md5_hash, status, error_msg)
         VALUES ($1,$2,$3,'failed',$4)
         ON CONFLICT (file_name, md5_hash) DO UPDATE SET status='failed', error_msg=EXCLUDED.error_msg`,
        [jobId, fileName, hash, err.message],
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

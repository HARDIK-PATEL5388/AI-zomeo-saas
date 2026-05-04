// Complete repertory parser (TAB format).
// Owns the 8 .tab files Complete/Murphy/Kent ship with: RemID, REPolar,
// Complete, Pagerefs, LibraryIndex, PapaSub, Remlist (→ rep_rubric_remedies),
// and Xrefs. Importers were extracted verbatim from repertoryUploadService
// so behavior for the existing Complete book is unchanged.

import type { Pool, PoolClient } from 'pg'
import { parseTabBuffer, col, colInt, chunk } from '../tabParser'
import type {
  RepertoryParser, ValidationResult, ValidationIssue,
  FilePreview, ParserContext, FileSpec,
} from './parser.types'

// ─── File contract ─────────────────────────────────────────────────────────
const FILE_SPECS: FileSpec[] = [
  { name: 'RemID.tab',        required: true, minColumns: 3, description: 'Remedy master (rem_code, abbreviation, full name)' },
  { name: 'REPolar.tab',      required: true, minColumns: 2, description: 'Polar pairs between rubrics' },
  { name: 'Complete.tab',     required: true, minColumns: 8, description: 'Rubric hierarchy and chapters' },
  { name: 'Pagerefs.tab',     required: true, minColumns: 2, description: 'Page references' },
  { name: 'LibraryIndex.tab', required: true, minColumns: 4, description: 'Literature references' },
  { name: 'PapaSub.tab',      required: true, minColumns: 2, description: 'Rubric → remedy links (no grade)' },
  { name: 'Remlist.tab',      required: true, minColumns: 3, description: 'Rubric → remedy links with grade' },
  { name: 'Xrefs.tab',        required: true, minColumns: 4, description: 'Cross-references between rubrics' },
]

const IMPORT_ORDER = FILE_SPECS.map(f => f.name)

// ─── Generic batched UPSERT helper (book-aware) ────────────────────────────
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

// ─── Per-file importers (one transaction per file, owned by orchestrator) ──

async function importRemID(client: PoolClient, buf: Buffer, _bookId: number) {
  // rep_remedies is shared across books (Bryonia is Bryonia in any repertory).
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const code = colInt(row, 0)
    if (!code) { skipped++; continue }
    records.push([code, col(row, 1), col(row, 2) || col(row, 1), col(row, 3) || null])
  }
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

async function importComplete(client: PoolClient, buf: Buffer, bookId: number) {
  const rows = parseTabBuffer(buf)
  const chapterNames = new Set<string>()
  const staged: Array<{
    extId: number; parent: number | null; depth: number;
    chapter: string | null; text: string; full: string;
  }> = []
  let skipped = 0

  for (const row of rows) {
    const extId = colInt(row, 0)
    if (!extId) { skipped++; continue }

    const parent  = colInt(row, 2) || null
    const depth   = colInt(row, 4)
    const chapter = col(row, 6) || null

    const parts: string[] = []
    for (let c = 7; c < row.length; c++) {
      const p = col(row, c)
      if (p) parts.push(p)
    }
    const text = parts[parts.length - 1] || ''
    if (!text) { skipped++; continue }
    if (chapter) chapterNames.add(chapter)

    staged.push({
      extId, parent, depth, chapter, text,
      full: parts.join(' > ') || text,
    })
  }

  // Chapters for this book (idempotent).
  const chapterArr = Array.from(chapterNames)
  for (let i = 0; i < chapterArr.length; i++) {
    await client.query(
      `INSERT INTO rep_book_chapters (book_id, name, code, sort_order)
         VALUES ($1, $2, $2, $3)
       ON CONFLICT (book_id, name) DO NOTHING`,
      [bookId, chapterArr[i], i + 1],
    )
  }

  const chapterMap = new Map<string, number>()
  const chRes = await client.query(
    `SELECT id, name FROM rep_book_chapters WHERE book_id = $1`,
    [bookId],
  )
  for (const r of chRes.rows) chapterMap.set(r.name, r.id)

  const records: any[][] = staged.map(s => [
    bookId,
    s.extId,
    s.parent,
    s.depth,
    s.chapter ? chapterMap.get(s.chapter) ?? null : null,
    s.chapter,
    s.text,
    s.full,
  ])

  const added = await batchUpsert(
    client,
    'rep_rubrics',
    ['book_id', 'ext_id', 'parent_ext_id', 'depth', 'chapter_id', 'chapter', 'rubric_text', 'full_path'],
    ['book_id', 'ext_id'],
    ['parent_ext_id', 'depth', 'chapter_id', 'chapter', 'rubric_text', 'full_path', 'updated_at'],
    records,
    500,
  )
  return { added, updated: 0, skipped }
}

async function importREPolar(client: PoolClient, buf: Buffer, bookId: number) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const a = colInt(row, 0), b = colInt(row, 1)
    if (!a || !b) { skipped++; continue }
    records.push([bookId, a, b])
  }
  const added = await batchUpsert(
    client,
    'rep_polar_pairs',
    ['book_id', 'ext_id_1', 'ext_id_2'],
    ['book_id', 'ext_id_1', 'ext_id_2'],
    [],
    records,
    1000,
  )
  return { added, updated: 0, skipped }
}

async function importPagerefs(client: PoolClient, buf: Buffer, bookId: number) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const ext = colInt(row, 0)
    if (!ext) { skipped++; continue }
    records.push([bookId, ext, col(row, 1) || '?', colInt(row, 2, 0)])
  }
  const added = await batchUpsert(
    client,
    'rep_page_refs',
    ['book_id', 'rubric_ext_id', 'book_code', 'page_number'],
    ['book_id', 'rubric_ext_id', 'book_code', 'page_number'],
    [],
    records,
    1000,
  )
  return { added, updated: 0, skipped }
}

async function importLibraryIndex(client: PoolClient, buf: Buffer, bookId: number) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const ext = colInt(row, 0)
    if (!ext) { skipped++; continue }
    records.push([bookId, ext, col(row, 3), col(row, 4), col(row, 5)])
  }
  const added = await batchUpsert(
    client,
    'rep_library_index',
    ['book_id', 'rubric_ext_id', 'reference', 'author', 'year'],
    ['book_id', 'rubric_ext_id', 'reference', 'author', 'year'],
    [],
    records,
    1000,
  )
  return { added, updated: 0, skipped }
}

async function importPapaSub(client: PoolClient, buf: Buffer, bookId: number) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const ext = colInt(row, 0), code = colInt(row, 1)
    if (!ext || !code) { skipped++; continue }
    records.push([bookId, ext, code])
  }
  const added = await batchUpsert(
    client,
    'rep_papasub',
    ['book_id', 'rubric_ext_id', 'rem_code'],
    ['book_id', 'rubric_ext_id', 'rem_code'],
    [],
    records,
    2000,
  )
  return { added, updated: 0, skipped }
}

async function importXrefs(client: PoolClient, buf: Buffer, bookId: number) {
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
    records.push([bookId, xref, pair, ext1, ext2, rel])
  }
  const added = await batchUpsert(
    client,
    'rep_xrefs',
    ['book_id', 'xref_id', 'pair_id', 'rubric_ext_id_1', 'rubric_ext_id_2', 'rel_type'],
    ['xref_id'],
    ['book_id', 'pair_id', 'rubric_ext_id_1', 'rubric_ext_id_2', 'rel_type'],
    records,
    1000,
  )
  return { added, updated: 0, skipped }
}

async function importRemlist(client: PoolClient, buf: Buffer, bookId: number) {
  const rows = parseTabBuffer(buf)
  const records: any[][] = []
  let skipped = 0
  for (const row of rows) {
    const ext = colInt(row, 0), code = colInt(row, 1)
    if (!ext || !code) { skipped++; continue }
    const grade = Math.min(4, Math.max(1, colInt(row, 2, 1)))
    records.push([bookId, ext, code, grade])
  }
  const added = await batchUpsert(
    client,
    'rep_rubric_remedies',
    ['book_id', 'rubric_ext_id', 'rem_code', 'grade'],
    ['book_id', 'rubric_ext_id', 'rem_code'],
    ['grade'],
    records,
    2000,
  )
  return { added, updated: 0, skipped }
}

type FileImporter = (c: PoolClient, b: Buffer, bookId: number) =>
  Promise<{ added: number; updated: number; skipped: number }>

const FILE_IMPORTERS: Record<string, FileImporter> = {
  'RemID.tab':        importRemID,
  'REPolar.tab':      importREPolar,
  'Complete.tab':     importComplete,
  'Pagerefs.tab':     importPagerefs,
  'LibraryIndex.tab': importLibraryIndex,
  'PapaSub.tab':      importPapaSub,
  'Remlist.tab':      importRemlist,
  'Xrefs.tab':        importXrefs,
}

// ─── Validation ────────────────────────────────────────────────────────────
function validate(files: Map<string, Buffer>): ValidationResult {
  const issues: ValidationIssue[] = []

  for (const spec of FILE_SPECS) {
    if (!spec.required) continue
    const buf = files.get(spec.name)
    if (!buf) {
      issues.push({ file: spec.name, problem: 'File missing' })
      continue
    }
    if (buf.length === 0) {
      issues.push({ file: spec.name, problem: 'File is empty' })
      continue
    }
    const rows = parseTabBuffer(buf)
    if (rows.length === 0) {
      issues.push({ file: spec.name, problem: 'No parseable rows' })
      continue
    }
    const min = spec.minColumns ?? 1
    const firstRow = rows.find(r => r.some(c => c.trim().length > 0))
    if (!firstRow || firstRow.length < min) {
      issues.push({
        file: spec.name,
        problem: `Expected at least ${min} columns, got ${firstRow?.length ?? 0}`,
      })
    }
  }
  return { ok: issues.length === 0, issues }
}

// ─── Preview (read-only counts of new vs existing) ────────────────────────
const BATCH_KEYS = 1000

async function pkExistsBatch(
  pool: Pool,
  table: string,
  pkCols: string[],
  rows: any[][],
  scope?: { col: string; value: any },
): Promise<Set<string>> {
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
    let sql = `SELECT ${colList} FROM ${table} WHERE (${colList}) IN (${placeholders.join(',')})`
    if (scope) {
      params.push(scope.value)
      sql += ` AND ${scope.col} = $${p++}`
    }
    const res = await pool.query(sql, params)
    for (const row of res.rows) {
      existing.add(pkCols.map(c => String(row[c])).join('|'))
    }
  }
  return existing
}

async function preview(
  files: Map<string, Buffer>,
  bookId: number | null,
  pool: Pool,
): Promise<FilePreview[]> {
  const scope = bookId == null ? undefined : { col: 'book_id', value: bookId }
  const results: FilePreview[] = []

  for (const fileName of IMPORT_ORDER) {
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
      table = 'rep_rubric_remedies'; pkCols = ['rubric_ext_id','rem_code']
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

    if (pkRows.length === 0) {
      results.push({ file: fileName, totalRows, parsedRows: 0, newRows: 0, existingRows: 0, toUpdateRows: 0, unchangedRows: 0, skippedRows: skipped })
      continue
    }

    // Remlist exact-preview is too slow at ~3M rows — fall back to a count.
    const isHuge = pkRows.length > 100_000
    const tableHasBookId = table !== 'rep_remedies' && bookId != null

    let existingCount = 0
    if (isHuge) {
      const sql = tableHasBookId
        ? `SELECT COUNT(*)::int AS c FROM ${table} WHERE book_id=$1`
        : `SELECT COUNT(*)::int AS c FROM ${table}`
      const args = tableHasBookId ? [bookId] : []
      const existingTotalRes = await pool.query(sql, args)
      const existingInDb = existingTotalRes.rows[0].c as number
      existingCount = Math.min(existingInDb, pkRows.length)
    } else {
      const existingSet = await pkExistsBatch(
        pool, table, pkCols, pkRows,
        tableHasBookId ? scope : undefined,
      )
      existingCount = existingSet.size
    }

    results.push({
      file: fileName,
      totalRows,
      parsedRows: pkRows.length,
      newRows: pkRows.length - existingCount,
      existingRows: existingCount,
      toUpdateRows: existingCount,
      unchangedRows: 0,
      skippedRows: skipped,
    })
  }
  return results
}

// ─── Per-file import (orchestrator opens the transaction & owns logging) ──
async function importFile(
  client: PoolClient,
  fileName: string,
  buffer: Buffer,
  ctx: ParserContext,
): Promise<{ added: number; updated: number; skipped: number }> {
  const fn = FILE_IMPORTERS[fileName]
  if (!fn) throw new Error(`Unknown file: ${fileName}`)
  return fn(client, buffer, ctx.bookId)
}

// ─── Parser export ────────────────────────────────────────────────────────
export const completeTabParser: RepertoryParser = {
  id: 'complete_tab',
  name: 'Complete (TAB)',
  description: 'Complete repertory and compatible TAB-formatted books (Murphy, Kent shipped as .tab)',
  fileSpec: FILE_SPECS,
  importOrder: IMPORT_ORDER,
  validate,
  preview,
  importFile,
}

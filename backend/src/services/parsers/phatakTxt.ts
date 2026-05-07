// Phatak parser — single plain-text file, one rubric per line.
//
// ─── Source grammar ───────────────────────────────────────────────────────
// Every non-empty line of PHATAK.txt is a rubric definition:
//
//     #2 Abdomen:#  0#                                  ← depth-2 root rubric
//     # 3 Affections in general:# 18#1:Aeth, 1:Arg-n,…  ← depth-3 child
//     #  4 Drawn in:#  1#1:Thuj,                        ← depth-4 child
//     #   5 Heavy:#  1#1:Tab,                           ← depth-5 child
//
// Format: `#<level> <title>:#<count>#<grade>:<abbrev>, <grade>:<abbrev>, …`
//
// `<level>` (2..6) directly encodes hierarchy depth; parents are resolved by
// walking a depth stack. `<count>` is the declared remedy count (used only as
// a sanity check). Remedies are comma-separated `<grade>:<abbrev>` tokens
// with grades 1..3 (mirroring the same scale as Complete/Murphy/Khullar).
//
// ─── Storage shape ────────────────────────────────────────────────────────
// Single chapter "Phatak A-Z" matches the legacy Zomeo display:
//     Phatak (1) → Phatak A-Z → 2 ABDOMEN: → 3 Affections in general: …
// Rubric ext_ids are sequential line indexes (1..N) — re-imports are
// idempotent because we wipe the whole book slice first.

import type { Pool, PoolClient } from 'pg'
import { chunk } from '../tabParser'
import type {
  RepertoryParser, ValidationResult, ValidationIssue,
  FilePreview, ParserContext,
} from './parser.types'

const SOURCE_FILE   = 'PHATAK.txt'
const CHAPTER_NAME  = 'Phatak A-Z'
const CHAPTER_INDEX = 1

// `#<level> <title>:#<count>#<rest>` — leading `#` then optional spaces, the
// depth digit, one+ spaces, the title (lazy), `:#`, optional spaces, the
// declared count, `#`, then the (possibly empty) remedy stream.
const LINE_RE = /^#\s*(\d+)\s+(.+?):#\s*(\d+)#(.*)$/
const REM_RE  = /^\s*(\d+)\s*:\s*([A-Za-z][A-Za-z0-9\-]*)\s*$/

interface ParsedRubric {
  extId: number
  parentExtId: number | null
  depth: number
  title: string
  fullPath: string
  remedies: Array<{ grade: number; abbrev: string }>
}
interface ParseResult {
  rubrics: ParsedRubric[]
  abbrevs: Set<string>
}

function canonAbbrev(raw: string): string {
  return (raw ?? '').toLowerCase().trim().replace(/\.+$/, '')
}

function parsePhatak(body: string): ParseResult {
  const lines = body.split(/\r\n|\r|\n/)
  const rubrics: ParsedRubric[] = []
  const abbrevs = new Set<string>()
  // Stack of open ancestors keyed by depth — popped down to depth-1 on each
  // new line so the new rubric's parent is the deepest still-open ancestor.
  const stack: ParsedRubric[] = []
  let extId = 0

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    const m = LINE_RE.exec(line.trim())
    if (!m) continue

    const depth = parseInt(m[1], 10)
    const title = m[2].trim()
    const remStr = m[4]

    extId++
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack.length > 0 ? stack[stack.length - 1] : null
    const parentPath = parent ? parent.fullPath : CHAPTER_NAME
    const r: ParsedRubric = {
      extId,
      parentExtId: parent ? parent.extId : null,
      depth,
      title,
      fullPath: `${parentPath} > ${title}`,
      remedies: [],
    }

    for (const tok of remStr.split(',')) {
      const trimmed = tok.trim()
      if (!trimmed) continue
      const rm = REM_RE.exec(trimmed)
      if (!rm) continue
      const grade = Math.min(4, Math.max(1, parseInt(rm[1], 10) || 1))
      const abbrev = rm[2]
      r.remedies.push({ grade, abbrev })
      const k = canonAbbrev(abbrev)
      if (k) abbrevs.add(k)
    }

    rubrics.push(r)
    stack.push(r)
  }
  return { rubrics, abbrevs }
}

// ─── Validation ────────────────────────────────────────────────────────────
function validate(files: Map<string, Buffer>): ValidationResult {
  const issues: ValidationIssue[] = []
  const buf = files.get(SOURCE_FILE)
    ?? files.get(SOURCE_FILE.toLowerCase())
    ?? files.get(SOURCE_FILE.toUpperCase())
  if (!buf) {
    issues.push({ file: SOURCE_FILE, problem: 'Required file is missing' })
    return { ok: false, issues }
  }
  if (buf.length === 0) {
    issues.push({ file: SOURCE_FILE, problem: 'File is empty' })
    return { ok: false, issues }
  }
  const head = buf.toString('utf8', 0, Math.min(buf.length, 4096))
  const firstLine = head.split(/\r\n|\r|\n/).find(l => l.trim().length > 0) ?? ''
  if (!LINE_RE.test(firstLine.trim())) {
    issues.push({ file: SOURCE_FILE, problem: 'First line does not match `#<level> <title>:#<count>#` grammar' })
  }
  return { ok: issues.length === 0, issues }
}

// ─── Preview ───────────────────────────────────────────────────────────────
async function preview(
  files: Map<string, Buffer>,
  bookId: number | null,
  pool: Pool,
): Promise<FilePreview[]> {
  const buf = files.get(SOURCE_FILE)
    ?? files.get(SOURCE_FILE.toLowerCase())
    ?? files.get(SOURCE_FILE.toUpperCase())
  if (!buf) {
    return [emptyPreview(SOURCE_FILE)]
  }
  let total = 0
  try {
    const { rubrics } = parsePhatak(buf.toString('utf8'))
    total = rubrics.length
  } catch {
    /* preview is best-effort */
  }
  let existing = 0
  if (bookId != null && total > 0) {
    const r = await pool.query(`SELECT COUNT(*)::int AS c FROM rep_rubrics WHERE book_id=$1`, [bookId])
    existing = Math.min(total, r.rows[0].c as number)
  }
  return [{
    file: SOURCE_FILE,
    totalRows: total,
    parsedRows: total,
    newRows: total - existing,
    existingRows: existing,
    toUpdateRows: existing,
    unchangedRows: 0,
    skippedRows: 0,
  }]
}
function emptyPreview(file: string): FilePreview {
  return { file, totalRows: 0, parsedRows: 0, newRows: 0, existingRows: 0, toUpdateRows: 0, unchangedRows: 0, skippedRows: 0 }
}

// ─── Generic batched UPSERT (book-aware) ───────────────────────────────────
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
      for (const v of row) { params.push(v); slots.push(`$${idx++}`) }
      placeholders.push(`(${slots.join(',')})`)
    }
    const sql = `INSERT INTO ${table} (${colSql}) VALUES ${placeholders.join(',')} ${onConflict}`
    const r = await client.query(sql, params)
    total += r.rowCount ?? batch.length
  }
  return total
}

// ─── Per-file import ───────────────────────────────────────────────────────
async function importFile(
  client: PoolClient,
  fileName: string,
  buffer: Buffer,
  ctx: ParserContext,
): Promise<{ added: number; updated: number; skipped: number }> {
  if (fileName.toLowerCase() !== SOURCE_FILE.toLowerCase()) {
    throw new Error(`Unknown file: ${fileName}`)
  }

  const body = buffer.toString('utf8')
  const { rubrics, abbrevs } = parsePhatak(body)
  if (rubrics.length === 0) {
    return { added: 0, updated: 0, skipped: 0 }
  }

  // Single chapter row — idempotent on (book_id, name).
  const chRes = await client.query(
    `INSERT INTO rep_book_chapters (book_id, name, code, sort_order)
       VALUES ($1, $2, $2, $3)
     ON CONFLICT (book_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
     RETURNING id`,
    [ctx.bookId, CHAPTER_NAME, CHAPTER_INDEX],
  )
  const chapterId: number = chRes.rows[0].id

  // Wipe Phatak's slice for an idempotent re-import.
  await client.query(`DELETE FROM rep_rubric_remedies WHERE book_id = $1`, [ctx.bookId])
  await client.query(`DELETE FROM rep_rubrics         WHERE book_id = $1`, [ctx.bookId])

  // Resolve rep_remedies rem_codes (canonical-abbrev lookup, shared with
  // every other parser).
  const existingRem = new Map<string, number>()
  {
    const r = await client.query(
      `SELECT rem_code, abbreviation FROM rep_remedies WHERE abbreviation IS NOT NULL ORDER BY rem_code`,
    )
    for (const row of r.rows) {
      const key = canonAbbrev(String(row.abbreviation))
      if (key && !existingRem.has(key)) existingRem.set(key, row.rem_code as number)
    }
  }
  const newAbbrevs: string[] = []
  for (const a of abbrevs) {
    if (!existingRem.has(a)) newAbbrevs.push(a)
  }
  if (newAbbrevs.length > 0) {
    const maxRes = await client.query(`SELECT COALESCE(MAX(rem_code), 0) AS m FROM rep_remedies`)
    let next = (maxRes.rows[0].m as number) + 1
    const insertRows: any[][] = []
    for (const a of newAbbrevs) {
      insertRows.push([next, a, a, null])
      existingRem.set(a, next)
      next++
    }
    await batchUpsert(
      client,
      'rep_remedies',
      ['rem_code', 'abbreviation', 'full_name', 'common_name'],
      ['rem_code'],
      ['abbreviation', 'full_name', 'common_name', 'updated_at'],
      insertRows,
      500,
    )
  }

  // Insert rubrics.
  const rubricRows: any[][] = rubrics.map(r => [
    ctx.bookId, r.extId, r.parentExtId, r.depth, chapterId, CHAPTER_NAME, r.title, r.fullPath,
  ])
  const addedRubrics = await batchUpsert(
    client,
    'rep_rubrics',
    ['book_id', 'ext_id', 'parent_ext_id', 'depth', 'chapter_id', 'chapter', 'rubric_text', 'full_path'],
    ['book_id', 'ext_id'],
    ['parent_ext_id', 'depth', 'chapter_id', 'chapter', 'rubric_text', 'full_path', 'updated_at'],
    rubricRows,
    500,
  )

  // Build rubric_remedies, deduped per (rubric, rem_code) keeping max grade.
  const dedup = new Map<string, { extId: number; remCode: number; grade: number }>()
  let skipped = 0
  for (const ru of rubrics) {
    for (const r of ru.remedies) {
      const code = existingRem.get(canonAbbrev(r.abbrev))
      if (!code) { skipped++; continue }
      const grade = Math.min(4, Math.max(1, r.grade || 1))
      const key = `${ru.extId}|${code}`
      const prev = dedup.get(key)
      if (!prev || grade > prev.grade) {
        dedup.set(key, { extId: ru.extId, remCode: code, grade })
      }
    }
  }
  const rrRows: any[][] = []
  for (const v of dedup.values()) rrRows.push([ctx.bookId, v.extId, v.remCode, v.grade])
  const addedRR = await batchUpsert(
    client,
    'rep_rubric_remedies',
    ['book_id', 'rubric_ext_id', 'rem_code', 'grade'],
    ['book_id', 'rubric_ext_id', 'rem_code'],
    ['grade'],
    rrRows,
    2000,
  )

  ctx.onProgress?.(SOURCE_FILE, `rubrics=${addedRubrics} rubric_remedies=${addedRR} skipped=${skipped}`)
  return { added: addedRubrics + addedRR, updated: 0, skipped }
}

// ─── Parser export ────────────────────────────────────────────────────────
export const phatakTxtParser: RepertoryParser = {
  id: 'phatak_txt',
  name: 'Phatak (Concise Repertory TXT)',
  description: 'Phatak Concise Repertory of Homoeopathic Medicines — single PHATAK.txt with `#<level> <title>:#<count>#` hierarchy lines',
  fileSpec: [{
    name: SOURCE_FILE,
    required: true,
    minColumns: 1,
    description: 'Phatak A-Z hierarchy file',
  }],
  importOrder: [SOURCE_FILE],
  validate,
  preview,
  importFile,
}

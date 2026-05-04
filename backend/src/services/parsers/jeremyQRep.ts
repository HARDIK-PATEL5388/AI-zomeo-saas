// Jeremy (QRep) parser — UTF-8 CSV/TSV inputs from Jeremy's Mental Qualities
// repertory. See docs/JEREMY_DISCOVERY.md for the per-file inventory and the
// dependency graph.
//
// Required files (3):
//   Definitions.csv             — 38 quality definitions; body is TAB-separated
//   QRepV4.csv                  — every (remedy, grade, quality) triple
//   Primary.QRepV4.csv          — the grade-3/4 subset (rubric "(Primary remedies):")
// Optional files (2):
//   AbbreviationTable.QRepV4.csv — substance → abbreviation enrichment
//   RemReplace.txt               — old:new abbreviation aliases (~87 useful)
//
// Import order (orchestrator opens one transaction per file in this order):
//   1. AbbreviationTable.QRepV4.csv  (prepares lookup tables for later inserts)
//   2. RemReplace.txt                (idem; alias map)
//   3. Definitions.csv               (creates the 'Mental Qualities' chapter
//                                     and 76 rubrics — base for steps 4 & 5)
//   4. QRepV4.csv                    (rep_remedies INSERTs + rep_rubric_remedies
//                                     for "X Quality:" rubrics)
//   5. Primary.QRepV4.csv            (rep_rubric_remedies for "(Primary remedies):")
//
// Steps 1-2 only stage in-memory lookup state in rep_remedies metadata-style
// rows — they don't write anything that depends on later files.

import type { Pool, PoolClient } from 'pg'
import { chunk } from '../tabParser'
import type {
  RepertoryParser, ValidationResult, ValidationIssue,
  FilePreview, ParserContext, FileSpec,
} from './parser.types'

// ─── File contract ─────────────────────────────────────────────────────────
const FILE_SPECS: FileSpec[] = [
  { name: 'AbbreviationTable.QRepV4.csv', required: false, minColumns: 2,
    description: 'Optional — substance → abbreviation enrichment for new remedies' },
  { name: 'RemReplace.txt',               required: false, minColumns: 2,
    description: 'Optional — old:new abbreviation aliases (colon-separated)' },
  { name: 'Definitions.csv',              required: true,  minColumns: 6,
    description: '38 Mental Quality definitions (header is CSV, body is TAB)' },
  { name: 'QRepV4.csv',                   required: true,  minColumns: 3,
    description: 'Per-quality remedy list with grade (CSV)' },
  { name: 'Primary.QRepV4.csv',           required: true,  minColumns: 3,
    description: 'Primary-remedy subset, grade 3/4 only (CSV)' },
]

const IMPORT_ORDER = FILE_SPECS.map(f => f.name)

const CHAPTER_NAME = 'Mental Qualities'

// ─── Tiny readers (no `csv` dep — files are quote-free per discovery report) ─
function decodeUtf8(buf: Buffer): string {
  // Strip a single UTF-8 BOM if present, otherwise pass through.
  const s = buf.toString('utf8')
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter(l => l.length > 0)
}

function parseCsv(buf: Buffer): string[][] {
  return splitLines(decodeUtf8(buf)).map(l => l.split(',').map(c => c.trim()))
}

function parseTsv(buf: Buffer): string[][] {
  return splitLines(decodeUtf8(buf)).map(l => l.split('\t').map(c => c.trim()))
}

/** Definitions.csv: header line is `,`-separated, body is `\t`-separated. */
function parseDefinitions(buf: Buffer): Array<{
  name: string; descEn: string; primaryEn: string;
  nameDe: string; descDe: string; primaryDe: string;
}> {
  const lines = splitLines(decodeUtf8(buf))
  const out: Array<any> = []
  // Skip the header (line 0). Body rows are tab-separated, 6 fields.
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t')
    const name = (cols[0] ?? '').trim()
    if (!name) continue
    out.push({
      name,
      descEn:    (cols[1] ?? '').trim(),
      primaryEn: (cols[2] ?? '').trim(),
      nameDe:    (cols[3] ?? '').trim(),
      descDe:    (cols[4] ?? '').trim(),
      primaryDe: (cols[5] ?? '').trim(),
    })
  }
  return out
}

/** RemReplace.txt: `OldAbbrev:NewAbbrev` per line. Returns canonical map. */
function parseRemReplace(buf: Buffer): Map<string, string> {
  const map = new Map<string, string>()
  for (const raw of splitLines(decodeUtf8(buf))) {
    const idx = raw.indexOf(':')
    if (idx < 0) continue
    const k = canonAbbrev(raw.slice(0, idx))
    const v = canonAbbrev(raw.slice(idx + 1))
    if (k && v) map.set(k, v)
  }
  return map
}

/** AbbreviationTable.QRepV4.csv: `Substance,Abbreviation` per line. */
function parseAbbrevTable(buf: Buffer): Map<string, string> {
  const map = new Map<string, string>()
  const rows = parseCsv(buf)
  for (let i = 1; i < rows.length; i++) {
    const [substance, abbrev] = rows[i]
    if (!abbrev) continue
    map.set(canonAbbrev(abbrev), substance ?? '')
  }
  return map
}

/** Normalize a quality name from any of the CSVs (trims trailing space). */
function normalizeQualityName(q: string): string {
  return (q ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Canonical form of a remedy abbreviation.
 *
 * Complete stores abbreviations with a trailing period (`lyc.`, `phos.`,
 * `sulph.`); Jeremy uses the bare form (`lyc`, `phos`, `sulph`). Without
 * stripping the period on both sides, Jeremy would insert ~1,150 duplicate
 * rep_remedies rows that already exist under Complete, and mixed-book
 * analysis would never roll a Jeremy hit into a Complete hit for the same
 * remedy. Lower-case + strip trailing dots fixes both.
 */
function canonAbbrev(raw: string): string {
  return (raw ?? '').toLowerCase().trim().replace(/\.+$/, '')
}

// Rubric ext_id allocation — deterministic per quality so re-imports are idempotent.
// Quality index (1-based, sorted by name) gives:
//   ext_id = qualityIndex * 2 - 1   for "X Quality:"
//   ext_id = qualityIndex * 2       for "X Quality (Primary remedies):"
// Composite PK is (book_id, ext_id), so ext_id collisions across books are fine.
function rubricExtIds(qualityIndex: number): { general: number; primary: number } {
  return { general: qualityIndex * 2 - 1, primary: qualityIndex * 2 }
}
function generalRubricText(qualityName: string): string {
  return `${normalizeQualityName(qualityName)} Quality:`
}
function primaryRubricText(qualityName: string): string {
  return `${normalizeQualityName(qualityName)} Quality (Primary remedies):`
}

// ─── Validation ────────────────────────────────────────────────────────────
function validate(files: Map<string, Buffer>): ValidationResult {
  const issues: ValidationIssue[] = []
  for (const spec of FILE_SPECS) {
    const buf = files.get(spec.name)
    if (!buf) {
      if (spec.required) issues.push({ file: spec.name, problem: 'File missing' })
      continue
    }
    if (buf.length === 0) {
      issues.push({ file: spec.name, problem: 'File is empty' })
      continue
    }
    let cols = 0
    try {
      const isDefs = spec.name === 'Definitions.csv'
      const rows = isDefs ? parseTsv(buf) : (spec.name === 'RemReplace.txt' ? null : parseCsv(buf))
      if (spec.name === 'RemReplace.txt') {
        const map = parseRemReplace(buf)
        cols = map.size > 0 ? 2 : 0
      } else {
        // Skip header; first data row's column count is the contract.
        const dataRow = rows!.slice(1).find(r => r.some(c => c.length > 0))
        cols = dataRow?.length ?? 0
      }
    } catch (e: any) {
      issues.push({ file: spec.name, problem: `Parse error: ${e.message}` })
      continue
    }
    const min = spec.minColumns ?? 1
    if (cols < min) {
      issues.push({
        file: spec.name,
        problem: `Expected at least ${min} columns, got ${cols}`,
      })
    }
  }
  return { ok: issues.length === 0, issues }
}

// ─── Preview ────────────────────────────────────────────────────────────────
async function preview(
  files: Map<string, Buffer>,
  bookId: number | null,
  pool: Pool,
): Promise<FilePreview[]> {
  const results: FilePreview[] = []

  // Definitions.csv → 38 quality rows; preview shows expected rubric inserts.
  const defsBuf = files.get('Definitions.csv')
  let qualities: ReturnType<typeof parseDefinitions> = []
  if (defsBuf) {
    qualities = parseDefinitions(defsBuf)
    let existing = 0
    if (bookId != null) {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS c FROM rep_rubrics WHERE book_id=$1`,
        [bookId],
      )
      existing = r.rows[0].c as number
    }
    const expected = qualities.length * 2  // general + primary per quality
    results.push({
      file: 'Definitions.csv',
      totalRows: qualities.length,
      parsedRows: qualities.length,
      newRows: Math.max(0, expected - existing),
      existingRows: Math.min(existing, expected),
      toUpdateRows: Math.min(existing, expected),
      unchangedRows: 0,
      skippedRows: 0,
    })
  } else {
    results.push(emptyPreview('Definitions.csv'))
  }

  for (const fileName of ['QRepV4.csv', 'Primary.QRepV4.csv']) {
    const buf = files.get(fileName)
    if (!buf) { results.push(emptyPreview(fileName)); continue }
    const rows = parseCsv(buf)
    let parsed = 0, skipped = 0
    for (let i = 1; i < rows.length; i++) {
      const [abbrev, gradeStr, quality] = rows[i]
      if (!abbrev || !gradeStr || !quality) { skipped++; continue }
      parsed++
    }
    let existing = 0
    if (bookId != null) {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS c FROM rep_rubric_remedies WHERE book_id=$1`,
        [bookId],
      )
      existing = Math.min(parsed, r.rows[0].c as number)
    }
    results.push({
      file: fileName,
      totalRows: rows.length - 1,
      parsedRows: parsed,
      newRows: parsed - existing,
      existingRows: existing,
      toUpdateRows: existing,
      unchangedRows: 0,
      skippedRows: skipped,
    })
  }

  // Optional files: report parsed count only (not stored as data rows).
  for (const fileName of ['AbbreviationTable.QRepV4.csv', 'RemReplace.txt']) {
    const buf = files.get(fileName)
    if (!buf) { results.push(emptyPreview(fileName)); continue }
    const map = fileName === 'RemReplace.txt' ? parseRemReplace(buf) : parseAbbrevTable(buf)
    results.push({
      file: fileName,
      totalRows: map.size,
      parsedRows: map.size,
      newRows: 0,           // stored implicitly, not as their own rows
      existingRows: 0,
      toUpdateRows: 0,
      unchangedRows: map.size,
      skippedRows: 0,
    })
  }

  // Re-order to match importOrder for nicer UI.
  const order = new Map(IMPORT_ORDER.map((n, i) => [n, i]))
  return results.sort((a, b) => (order.get(a.file)! - order.get(b.file)!))
}

function emptyPreview(file: string): FilePreview {
  return { file, totalRows: 0, parsedRows: 0, newRows: 0, existingRows: 0, toUpdateRows: 0, unchangedRows: 0, skippedRows: 0 }
}

// ─── Per-file importers ────────────────────────────────────────────────────

// 1. AbbreviationTable.QRepV4.csv — no DB writes; the data is consulted
//    later by the QRepV4 / Primary importers via ctx.files.
async function importAbbrevTable(_client: PoolClient, buf: Buffer) {
  const map = parseAbbrevTable(buf)
  return { added: 0, updated: 0, skipped: 0, infoRows: map.size }
}

// 2. RemReplace.txt — same pattern; no writes here, reused later.
async function importRemReplace(_client: PoolClient, buf: Buffer) {
  const map = parseRemReplace(buf)
  return { added: 0, updated: 0, skipped: 0, infoRows: map.size }
}

// 3. Definitions.csv — creates the 'Mental Qualities' chapter and the 76
//    rubrics. Idempotent on (book_id, ext_id).
async function importDefinitions(client: PoolClient, buf: Buffer, bookId: number) {
  const qualities = parseDefinitions(buf)
  if (qualities.length === 0) return { added: 0, updated: 0, skipped: 0 }

  // Ensure the single chapter exists.
  const chRes = await client.query(
    `INSERT INTO rep_book_chapters (book_id, name, code, sort_order)
       VALUES ($1, $2, $2, 1)
     ON CONFLICT (book_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
     RETURNING id`,
    [bookId, CHAPTER_NAME],
  )
  const chapterId: number = chRes.rows[0].id

  // Sort qualities for deterministic ext_id allocation.
  const sorted = [...qualities].sort((a, b) =>
    normalizeQualityName(a.name).localeCompare(normalizeQualityName(b.name)),
  )

  // Two rubric rows per quality.
  const rows: any[][] = []
  for (let i = 0; i < sorted.length; i++) {
    const q = sorted[i]
    const ids = rubricExtIds(i + 1)
    const qName = normalizeQualityName(q.name)

    rows.push([
      bookId, ids.general, null, 0, chapterId, CHAPTER_NAME,
      generalRubricText(qName), generalRubricText(qName),
    ])
    rows.push([
      bookId, ids.primary, null, 0, chapterId, CHAPTER_NAME,
      primaryRubricText(qName), primaryRubricText(qName),
    ])
  }

  const added = await batchUpsert(
    client,
    'rep_rubrics',
    ['book_id', 'ext_id', 'parent_ext_id', 'depth', 'chapter_id', 'chapter', 'rubric_text', 'full_path'],
    ['book_id', 'ext_id'],
    ['parent_ext_id', 'depth', 'chapter_id', 'chapter', 'rubric_text', 'full_path', 'updated_at'],
    rows,
    200,
  )
  return { added, updated: 0, skipped: 0 }
}

// 4 & 5. QRepV4.csv / Primary.QRepV4.csv — load remedies + rubric_remedies.
async function importGradedRemedies(
  client: PoolClient,
  buf: Buffer,
  bookId: number,
  ctx: ParserContext,
  variant: 'general' | 'primary',
) {
  const rows = parseCsv(buf)
  if (rows.length <= 1) return { added: 0, updated: 0, skipped: 0 }

  // Build the alias + abbreviation lookup tables ONCE per file from sibling files.
  const remReplaceBuf = ctx.files.get('RemReplace.txt')
  const abbrevTableBuf = ctx.files.get('AbbreviationTable.QRepV4.csv')
  const aliases = remReplaceBuf ? parseRemReplace(remReplaceBuf) : new Map<string, string>()
  const substanceMap = abbrevTableBuf ? parseAbbrevTable(abbrevTableBuf) : new Map<string, string>()

  // Map normalized quality name → rubric ext_id (general or primary side).
  const qualityIndexRes = await client.query(
    `SELECT ext_id, rubric_text
       FROM rep_rubrics
      WHERE book_id = $1`,
    [bookId],
  )
  // The rubric_text is `<Quality> Quality:` or `<Quality> Quality (Primary remedies):`.
  // Build a lookup: quality name → ext_id by re-parsing the rubric_text.
  const generalByQ = new Map<string, number>()
  const primaryByQ = new Map<string, number>()
  const reGen = /^(.*) Quality:$/
  const rePri = /^(.*) Quality \(Primary remedies\):$/
  for (const r of qualityIndexRes.rows) {
    const txt: string = r.rubric_text
    let m = reGen.exec(txt)
    if (m) { generalByQ.set(normalizeQualityName(m[1]).toLowerCase(), r.ext_id); continue }
    m = rePri.exec(txt)
    if (m) primaryByQ.set(normalizeQualityName(m[1]).toLowerCase(), r.ext_id)
  }
  const rubricMap = variant === 'general' ? generalByQ : primaryByQ
  if (rubricMap.size === 0) {
    throw new Error('No Jeremy rubrics found — Definitions.csv must be imported first')
  }

  // Pre-load existing remedy abbreviations. Key is the CANONICAL form (lower
  // + trailing-period stripped), so Jeremy's `lyc` resolves to Complete's
  // `lyc.` row. The first occurrence per key wins — if Complete already has a
  // row, we reuse its rem_code instead of inserting a Jeremy duplicate.
  const existingRem = new Map<string, number>()
  {
    const r = await client.query(
      `SELECT rem_code, abbreviation FROM rep_remedies WHERE abbreviation IS NOT NULL ORDER BY rem_code`,
    )
    for (const row of r.rows) {
      const key = canonAbbrev(String(row.abbreviation))
      if (!key) continue
      if (!existingRem.has(key)) existingRem.set(key, row.rem_code as number)
    }
  }

  // Resolver — applies alias map, prefers existing rep_remedies row, else
  // marks for insert and assigns a fresh rem_code from the sequence below.
  const toInsert: Array<{ abbrev: string; substance: string | null }> = []
  const insertedKeys = new Set<string>()
  function resolve(rawAbbrev: string): string {
    const k = canonAbbrev(rawAbbrev)
    return aliases.get(k) ?? k
  }
  function ensureRemCode(rawAbbrev: string): number | null {
    const key = resolve(rawAbbrev)
    if (!key) return null
    const hit = existingRem.get(key)
    if (hit) return hit
    if (!insertedKeys.has(key)) {
      insertedKeys.add(key)
      toInsert.push({ abbrev: key, substance: substanceMap.get(key) || null })
    }
    return -1  // placeholder until we batch-insert below
  }

  // First pass: collect placeholder triples (book, ext_id, abbrevKey, grade).
  type Pending = { extId: number; abbrevKey: string; grade: number }
  const pending: Pending[] = []
  let skipped = 0
  for (let i = 1; i < rows.length; i++) {
    const [abbrev, gradeStr, quality] = rows[i]
    if (!abbrev || !gradeStr || !quality) { skipped++; continue }
    const grade = Math.min(4, Math.max(1, parseInt(gradeStr) || 0))
    if (!grade) { skipped++; continue }
    const qkey = normalizeQualityName(quality).toLowerCase()
    const extId = rubricMap.get(qkey)
    if (!extId) { skipped++; continue }
    const tag = ensureRemCode(abbrev)
    if (tag == null) { skipped++; continue }
    pending.push({ extId, abbrevKey: resolve(abbrev), grade })
  }

  // Batch-insert any new remedies, capturing their assigned rem_codes.
  if (toInsert.length > 0) {
    // Allocate via MAX+1; rep_remedies.rem_code has no sequence default and
    // we are inside a per-file transaction, so the gap is safe.
    const maxRes = await client.query(`SELECT COALESCE(MAX(rem_code), 0) AS m FROM rep_remedies`)
    let next = (maxRes.rows[0].m as number) + 1
    // DEDUP: two aliased Jeremy abbreviations could pick the same canonical
    // key. We already use insertedKeys to prevent that, but guard once more
    // before allocating codes (cheap and protects against future refactors).
    const seen = new Set<string>()
    const insertRows: any[][] = []
    for (const r of toInsert) {
      if (seen.has(r.abbrev)) continue
      seen.add(r.abbrev)
      insertRows.push([next, r.abbrev, r.substance || r.abbrev, null])
      existingRem.set(r.abbrev, next)
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

  // Second pass: build the actual rep_rubric_remedies rows now that codes exist.
  // DEDUP: aliases (RemReplace) and trailing-space duplicates can collapse two
  // input rows into the same (book, rubric, rem_code) tuple. ON CONFLICT DO
  // UPDATE rejects two such rows in one INSERT, so collapse here keeping the
  // highest grade (matches Jeremy's "strongest grade wins" intent).
  const dedup = new Map<string, { extId: number; remCode: number; grade: number }>()
  for (const p of pending) {
    const code = existingRem.get(p.abbrevKey)
    if (!code) { skipped++; continue }
    const key = `${p.extId}|${code}`
    const prev = dedup.get(key)
    if (!prev || p.grade > prev.grade) {
      dedup.set(key, { extId: p.extId, remCode: code, grade: p.grade })
    } else {
      skipped++  // a stronger grade for the same (rubric, remedy) already won
    }
  }
  const records: any[][] = []
  for (const v of dedup.values()) {
    records.push([bookId, v.extId, v.remCode, v.grade])
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

// ─── Generic batched UPSERT (book-aware) ──────────────────────────────────
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

// ─── Per-file dispatch ────────────────────────────────────────────────────
async function importFile(
  client: PoolClient,
  fileName: string,
  buffer: Buffer,
  ctx: ParserContext,
): Promise<{ added: number; updated: number; skipped: number }> {
  switch (fileName) {
    case 'AbbreviationTable.QRepV4.csv': return importAbbrevTable(client, buffer)
    case 'RemReplace.txt':               return importRemReplace(client, buffer)
    case 'Definitions.csv':              return importDefinitions(client, buffer, ctx.bookId)
    case 'QRepV4.csv':                   return importGradedRemedies(client, buffer, ctx.bookId, ctx, 'general')
    case 'Primary.QRepV4.csv':           return importGradedRemedies(client, buffer, ctx.bookId, ctx, 'primary')
    default:                             throw new Error(`Unknown file: ${fileName}`)
  }
}

// ─── Parser export ────────────────────────────────────────────────────────
export const jeremyQRepParser: RepertoryParser = {
  id: 'jeremy_qrep',
  name: 'Jeremy (QRep)',
  description: 'Jeremy Sherr-style Mental Qualities repertory; CSV/TSV inputs',
  fileSpec: FILE_SPECS,
  importOrder: IMPORT_ORDER,
  validate,
  preview,
  importFile,
}

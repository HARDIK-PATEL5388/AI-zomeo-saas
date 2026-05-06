// Murphy parser — RTF chapter files (one .rtf per chapter, 74 total).
//
// Source format observed in the Murphy repertory ship folder
// `oldandnew/Murphy/`: each chapter is a separate Rich Text Format document
// produced by Microsoft WordPad / Msftedit. The body of every file is a flat
// stream of rubric "lines" delimited by RTF's `\par` token, where each line
// follows the convention:
//
//   #<level> <title> :# <count>#<grade>:<remedy>, <grade>:<remedy>, ...
//   #2 Aching, pain :# 50#1:Alum, 1:Arg, ... \par
//   # 3 Inguinal :#  4#3:Hep, 2:Merc, 1:Sil, 1:Syph, \par
//   #  4 Iliac fossa :#  1#1:Upa, \par
//   #2 Abscess, abdomen, (see Bubo):#  0#\par                    (no remedies)
//
// Whitespace before <level> is purely visual (the more spaces, the deeper the
// nesting). The numeric <level> is the source of truth — 2 = top-level rubric
// in the chapter, 3 = sub-rubric, 4/5 = nested. Hierarchy is rebuilt from the
// running level stack as each line is parsed.
//
// All Murphy files are optional in `fileSpec` so a partial upload (one chapter
// at a time, e.g. just `46. Mind.rtf`) is allowed; `validate()` requires that
// at least one recognised RTF be present.
//
// Each file maps to a single `rep_book_chapters` row; rubrics go into
// `rep_rubrics` with deterministic ext_ids (`chapterIndex * 1_000_000 + n`),
// remedies are looked up by canonical abbreviation in the shared
// `rep_remedies` table (so Murphy's `Lyc` reuses Complete's `lyc.` rem_code).

import type { Pool, PoolClient } from 'pg'
import { chunk } from '../tabParser'
import type {
  RepertoryParser, ValidationResult, ValidationIssue,
  FilePreview, ParserContext, FileSpec,
} from './parser.types'

// ─── Chapter contract ──────────────────────────────────────────────────────
// Filename is the contract — the wizard / orchestrator uses .name as the key
// in the form-data Map. .index drives sort_order and ext_id allocation.
// .chapter is the display name written into rep_book_chapters.name.
const CHAPTER_FILES: Array<{ index: number; name: string; chapter: string }> = [
  { index:  1, name: '1. abdomem.rtf',     chapter: 'Abdomen' },
  { index:  2, name: '2. Ankles.rtf',      chapter: 'Ankles' },
  { index:  3, name: '3. Arms.rtf',        chapter: 'Arms' },
  { index:  4, name: '4. Back.rtf',        chapter: 'Back' },
  { index:  5, name: '5. Bladder.rtf',     chapter: 'Bladder' },
  { index:  6, name: '6. Bones.rtf',       chapter: 'Bones' },
  { index:  7, name: '7. Brain.rtf',       chapter: 'Brain' },
  { index:  8, name: '8. Breasts.rtf',     chapter: 'Breasts' },
  { index:  9, name: '9. breathing.rtf',   chapter: 'Breathing' },
  { index: 10, name: '10. cancer.rtf',     chapter: 'Cancer' },
  { index: 11, name: '11. chest.rtf',      chapter: 'Chest' },
  { index: 12, name: '12. children.rtf',   chapter: 'Children' },
  { index: 13, name: '13. chills.rtf',     chapter: 'Chills' },
  { index: 14, name: '14. Clinical.rtf',   chapter: 'Clinical' },
  { index: 15, name: '15. Constitutions.rtf', chapter: 'Constitutions' },
  { index: 16, name: '16. Coughing.rtf',   chapter: 'Coughing' },
  { index: 17, name: '17. Dreams.rtf',     chapter: 'Dreams' },
  { index: 18, name: '18. Ears.rtf',       chapter: 'Ears' },
  { index: 19, name: '19. Elbows.rtf',     chapter: 'Elbows' },
  { index: 20, name: '20. Eyes.rtf',       chapter: 'Eyes' },
  { index: 21, name: '21. Face.rtf',       chapter: 'Face' },
  { index: 22, name: '22. Fainting.rtf',   chapter: 'Fainting' },
  { index: 23, name: '23. Feet.rtf',       chapter: 'Feet' },
  { index: 24, name: '24. Female.rtf',     chapter: 'Female' },
  { index: 25, name: '25. Fevers.rtf',     chapter: 'Fevers' },
  { index: 26, name: '26. Food.rtf',       chapter: 'Food' },
  { index: 27, name: '27. Gallbladder.rtf', chapter: 'Gallbladder' },
  { index: 28, name: '28. Generals.rtf',   chapter: 'Generals' },
  { index: 29, name: '29. Glands.rtf',     chapter: 'Glands' },
  { index: 30, name: '30. Hands.rtf',      chapter: 'Hands' },
  { index: 31, name: '31. Head.rtf',       chapter: 'Head' },
  { index: 32, name: '32. Headaches.rtf',  chapter: 'Headaches' },
  { index: 33, name: '33. Hearing.rtf',    chapter: 'Hearing' },
  { index: 34, name: '34. Heart.rtf',      chapter: 'Heart' },
  { index: 35, name: '35. Hips.rtf',       chapter: 'Hips' },
  { index: 36, name: '36. Intestines.rtf', chapter: 'Intestines' },
  { index: 37, name: '37. Joints.rtf',     chapter: 'Joints' },
  { index: 38, name: '38. Kidneys.rtf',    chapter: 'Kidneys' },
  { index: 39, name: '39. Knees.rtf',      chapter: 'Knees' },
  { index: 40, name: '40. Larynx.rtf',     chapter: 'Larynx' },
  { index: 41, name: '41. Legs.rtf',       chapter: 'Legs' },
  { index: 42, name: '42. Limbs.rtf',      chapter: 'Limbs' },
  { index: 43, name: '43. Liver.rtf',      chapter: 'Liver' },
  { index: 44, name: '44. Lungs.rtf',      chapter: 'Lungs' },
  { index: 45, name: '45. Male.rtf',       chapter: 'Male' },
  { index: 46, name: '46. Mind.rtf',       chapter: 'Mind' },
  { index: 47, name: '47. Mouth.rtf',      chapter: 'Mouth' },
  { index: 48, name: '48. Muscles.rtf',    chapter: 'Muscles' },
  { index: 49, name: '49. Neck.rtf',       chapter: 'Neck' },
  { index: 50, name: '50. Nose.rtf',       chapter: 'Nose' },
  { index: 51, name: '51. Pelvis.rtf',     chapter: 'Pelvis' },
  { index: 52, name: '52. Perspiration.rtf', chapter: 'Perspiration' },
  { index: 53, name: '53. Pregnancy.rtf',  chapter: 'Pregnancy' },
  { index: 54, name: '54. Pulse.rtf',      chapter: 'Pulse' },
  { index: 55, name: '55. Rectum.rtf',     chapter: 'Rectum' },
  { index: 56, name: '56. Shoulders.rtf',  chapter: 'Shoulders' },
  { index: 57, name: '57. Skin.rtf',       chapter: 'Skin' },
  { index: 58, name: '58. Sleep.rtf',      chapter: 'Sleep' },
  { index: 59, name: '59. Speech.rtf',     chapter: 'Speech' },
  { index: 60, name: '60. Spleen.rtf',     chapter: 'Spleen' },
  { index: 61, name: '61. Stomach.rtf',    chapter: 'Stomach' },
  { index: 62, name: '62. Stool.rtf',      chapter: 'Stool' },
  { index: 63, name: '63. Taste.rtf',      chapter: 'Taste' },
  { index: 64, name: '64. Teeth.rtf',      chapter: 'Teeth' },
  { index: 65, name: '65. Throat.rtf',     chapter: 'Throat' },
  { index: 66, name: '66. Time.rtf',       chapter: 'Time' },
  { index: 67, name: '67. Tongue.rtf',     chapter: 'Tongue' },
  { index: 68, name: '68. Toxicity.rtf',   chapter: 'Toxicity' },
  { index: 69, name: '69. Urine.rtf',      chapter: 'Urine' },
  { index: 70, name: '70. Vaccinations.rtf', chapter: 'Vaccinations' },
  { index: 71, name: '71. Vertigo.rtf',    chapter: 'Vertigo' },
  { index: 72, name: '72. Vision.rtf',     chapter: 'Vision' },
  { index: 73, name: '73. Weakness.rtf',   chapter: 'Weakness' },
  { index: 74, name: '74. Wrists.rtf',     chapter: 'Wrists' },
]

const FILE_BY_NAME = new Map(CHAPTER_FILES.map(f => [f.name, f]))

const FILE_SPECS: FileSpec[] = CHAPTER_FILES.map(f => ({
  name: f.name,
  required: false,
  minColumns: 1,
  description: `Chapter ${f.index}: ${f.chapter}`,
}))

const IMPORT_ORDER = CHAPTER_FILES.map(f => f.name)

// Each chapter owns ext_id range [index*1M+1, (index+1)*1M). Fits ~999K rubrics
// per chapter (the largest, Abdomen at ~497 KB, has well under 10K).
const EXT_ID_BLOCK = 1_000_000

// ─── RTF decoding ──────────────────────────────────────────────────────────
// Map non-ASCII bytes that survive `\'XX` decoding back to readable Unicode.
// The Murphy files declare \ansicpg1252 but contain Mac-Roman remnants for
// typographic punctuation (e.g. `\'d5` was meant as a right single quote, not
// the cp1252 'Õ'). We honour cp1252 first, then fall through to Mac-mapped
// guesses for the curly-quote / dash bytes that consistently misroute.
const BYTE_TO_CHAR: Record<number, string> = {
  0x91: '‘', 0x92: '’',  // cp1252 left/right single quote
  0x93: '“', 0x94: '”',  // cp1252 left/right double quote
  0x96: '–', 0x97: '—',  // cp1252 en/em dash
  0xA0: ' ',                        // nbsp → ASCII space
  0xD2: '“', 0xD3: '”',  // Mac left/right double quote
  0xD4: '‘', 0xD5: '’',  // Mac left/right single quote
  0xD0: '–', 0xD1: '—',  // Mac en/em dash
}
function decodeByte(code: number): string {
  return BYTE_TO_CHAR[code] ?? String.fromCharCode(code)
}

/**
 * Strip RTF markup down to the rubric stream.
 *
 *  - `\par` becomes `\n` (line separator for our parser).
 *  - `\'XX` hex byte escapes are decoded via BYTE_TO_CHAR / cp1252.
 *  - Other backslash control words (`\f0`, `\fs20`, `\viewkind4`, `\pard`, …)
 *    are dropped entirely along with their optional trailing space.
 *  - Group braces `{}` are dropped.
 *
 * Murphy files contain no `\b`/`\i`/`\u####` runs in the body, so the simple
 * sweep above is sufficient. If a future drop adds those, the parser will
 * still produce valid lines because it never treats stripped tokens as text.
 */
function rtfToBody(buf: Buffer): string {
  let s = buf.toString('latin1') // 1:1 byte-to-char for hex-escape decoding
  // Skip the document header up to and including \fs20 (or first `\par`).
  const headEnd = /\\fs\d+\s|\\par\b/.exec(s)
  if (headEnd && headEnd.index !== undefined) {
    s = s.slice(headEnd.index + headEnd[0].length)
  }
  // 1. Decode \'XX hex bytes.
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, hex) => decodeByte(parseInt(hex, 16)))
  // 2. \par → newline (our paragraph separator).
  s = s.replace(/\\par\b\s*/g, '\n')
  // 3. Drop other control words. Some may swallow a trailing space.
  s = s.replace(/\\[a-zA-Z]+(-?\d+)?\s?/g, '')
  // 4. Drop braces.
  s = s.replace(/[{}]/g, '')
  return s
}

// ─── Rubric line parser ────────────────────────────────────────────────────
interface ParsedRubric {
  level: number
  title: string
  remedies: Array<{ grade: number; abbrev: string }>
}
const RUBRIC_RE = /^#\s*(\d+)\s+(.+?)\s*:#\s*(\d+)#(.*)$/
// Optional whitespace after the colon — the source data sporadically has
// typos like `1: Sin-a` (with a space) which would otherwise drop the remedy.
const REMEDY_RE = /(\d+):\s*([A-Za-z][A-Za-z0-9-]*)/g

function parseRubricLine(line: string): ParsedRubric | null {
  const m = RUBRIC_RE.exec(line)
  if (!m) return null
  const level = parseInt(m[1], 10)
  if (!Number.isFinite(level) || level < 1) return null
  const title = m[2].replace(/\s+/g, ' ').trim()
  if (!title) return null
  const remedies: Array<{ grade: number; abbrev: string }> = []
  let rm: RegExpExecArray | null
  REMEDY_RE.lastIndex = 0
  while ((rm = REMEDY_RE.exec(m[4])) !== null) {
    remedies.push({ grade: parseInt(rm[1], 10), abbrev: rm[2] })
  }
  return { level, title, remedies }
}

// Canonical form of a remedy abbreviation. Same rule as Jeremy: lower-case +
// strip trailing `.` so Complete's `lyc.` and Murphy's `Lyc` collapse to the
// same rep_remedies row.
function canonAbbrev(raw: string): string {
  return (raw ?? '').toLowerCase().trim().replace(/\.+$/, '')
}

interface ChapterParsed {
  rubrics: Array<{
    extId: number
    parentExtId: number | null
    depth: number
    title: string
    fullPath: string
    remedies: Array<{ grade: number; abbrev: string }>
  }>
  abbrevs: Set<string>
}

function parseChapterBody(meta: { index: number; chapter: string }, body: string): ChapterParsed {
  // Some rubrics (e.g. Mind → "Anxiety") carry hundreds of remedies and the
  // source editor wraps the remedy list across multiple `\par`s. Every real
  // rubric line starts with `#<digits>`; lines that don't are continuations
  // of the previous rubric and we splice them back onto the parent before
  // running the regex (otherwise we'd silently drop ~100s of remedies for the
  // largest rubrics).
  const rawLines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const lines: string[] = []
  for (const raw of rawLines) {
    if (/^#\s*\d+\s/.test(raw)) {
      lines.push(raw)
    } else if (lines.length > 0) {
      // Trim a stray trailing `\` left from the RTF strip, then glue the
      // continuation onto the last logical rubric.
      lines[lines.length - 1] += ' ' + raw.replace(/\\+\s*$/, '')
    }
    // If there's no previous rubric (file pre-amble noise), drop the line.
  }
  const stack: Array<{ extId: number; depth: number; title: string }> = []
  const rubrics: ChapterParsed['rubrics'] = []
  const abbrevs = new Set<string>()
  let n = 0
  for (const line of lines) {
    const parsed = parseRubricLine(line)
    if (!parsed) continue
    n++
    const extId = meta.index * EXT_ID_BLOCK + n
    while (stack.length && stack[stack.length - 1].depth >= parsed.level) stack.pop()
    const parent = stack.length ? stack[stack.length - 1] : null
    const ancestors = stack.map(s => s.title)
    const fullPath = [meta.chapter, ...ancestors, parsed.title].join(' > ')
    rubrics.push({
      extId,
      parentExtId: parent ? parent.extId : null,
      depth: parsed.level,
      title: parsed.title,
      fullPath,
      remedies: parsed.remedies,
    })
    for (const r of parsed.remedies) {
      const k = canonAbbrev(r.abbrev)
      if (k) abbrevs.add(k)
    }
    stack.push({ extId, depth: parsed.level, title: parsed.title })
  }
  return { rubrics, abbrevs }
}

// ─── Validation ────────────────────────────────────────────────────────────
function validate(files: Map<string, Buffer>): ValidationResult {
  const issues: ValidationIssue[] = []
  let recognised = 0
  for (const [name, buf] of files) {
    if (!FILE_BY_NAME.has(name)) {
      issues.push({ file: name, problem: 'Unknown chapter file (not in Murphy 74-file contract)' })
      continue
    }
    if (buf.length === 0) {
      issues.push({ file: name, problem: 'File is empty' })
      continue
    }
    // Cheap sniff: every Murphy chapter starts with '{\rtf'.
    const head = buf.slice(0, 5).toString('latin1')
    if (head !== '{\\rtf') {
      issues.push({ file: name, problem: 'Not an RTF file (missing {\\rtf header)' })
      continue
    }
    recognised++
  }
  if (recognised === 0) {
    issues.push({ file: '*', problem: 'Upload at least one Murphy chapter (.rtf)' })
  }
  return { ok: issues.length === 0, issues }
}

// ─── Preview ───────────────────────────────────────────────────────────────
async function preview(
  files: Map<string, Buffer>,
  bookId: number | null,
  pool: Pool,
): Promise<FilePreview[]> {
  const results: FilePreview[] = []
  for (const fileName of IMPORT_ORDER) {
    const meta = FILE_BY_NAME.get(fileName)!
    const buf = files.get(fileName)
    if (!buf) {
      results.push(emptyPreview(fileName))
      continue
    }
    const body = rtfToBody(buf)
    const { rubrics } = parseChapterBody(meta, body)
    let existing = 0
    if (bookId != null && rubrics.length > 0) {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS c FROM rep_rubrics
           WHERE book_id = $1 AND ext_id BETWEEN $2 AND $3`,
        [bookId, meta.index * EXT_ID_BLOCK + 1, (meta.index + 1) * EXT_ID_BLOCK],
      )
      existing = Math.min(rubrics.length, r.rows[0].c as number)
    }
    results.push({
      file: fileName,
      totalRows: rubrics.length,
      parsedRows: rubrics.length,
      newRows: rubrics.length - existing,
      existingRows: existing,
      toUpdateRows: existing,
      unchangedRows: 0,
      skippedRows: 0,
    })
  }
  return results
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
async function importChapter(
  client: PoolClient,
  fileName: string,
  buffer: Buffer,
  ctx: ParserContext,
): Promise<{ added: number; updated: number; skipped: number }> {
  const meta = FILE_BY_NAME.get(fileName)
  if (!meta) throw new Error(`Unknown file: ${fileName}`)

  const body = rtfToBody(buffer)
  const { rubrics, abbrevs } = parseChapterBody(meta, body)
  if (rubrics.length === 0) {
    return { added: 0, updated: 0, skipped: 0 }
  }

  // Chapter row (idempotent on book_id+name).
  const chRes = await client.query(
    `INSERT INTO rep_book_chapters (book_id, name, code, sort_order)
       VALUES ($1, $2, $2, $3)
     ON CONFLICT (book_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
     RETURNING id`,
    [ctx.bookId, meta.chapter, meta.index],
  )
  const chapterId: number = chRes.rows[0].id

  // Wipe this chapter's slice so a re-import with edits doesn't leave orphan
  // rows behind. The ext_id range is deterministic per chapter index.
  const minExt = meta.index * EXT_ID_BLOCK + 1
  const maxExt = (meta.index + 1) * EXT_ID_BLOCK - 1
  await client.query(
    `DELETE FROM rep_rubric_remedies
       WHERE book_id = $1 AND rubric_ext_id BETWEEN $2 AND $3`,
    [ctx.bookId, minExt, maxExt],
  )
  await client.query(
    `DELETE FROM rep_rubrics
       WHERE book_id = $1 AND ext_id BETWEEN $2 AND $3`,
    [ctx.bookId, minExt, maxExt],
  )

  // Resolve rep_remedies rem_codes (canonical-abbrev lookup, shared with
  // Complete + Jeremy). Keys not present get inserted with MAX(rem_code)+1.
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
    const maxRes = await client.query(
      `SELECT COALESCE(MAX(rem_code), 0) AS m FROM rep_remedies`,
    )
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
    ctx.bookId, r.extId, r.parentExtId, r.depth, chapterId, meta.chapter, r.title, r.fullPath,
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
  // ON CONFLICT DO UPDATE rejects duplicate target tuples in a single INSERT,
  // so the dedup must happen in memory before the bulk write.
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
  for (const v of dedup.values()) {
    rrRows.push([ctx.bookId, v.extId, v.remCode, v.grade])
  }
  const addedRR = await batchUpsert(
    client,
    'rep_rubric_remedies',
    ['book_id', 'rubric_ext_id', 'rem_code', 'grade'],
    ['book_id', 'rubric_ext_id', 'rem_code'],
    ['grade'],
    rrRows,
    2000,
  )

  return { added: addedRubrics + addedRR, updated: 0, skipped }
}

// ─── Per-file dispatch ─────────────────────────────────────────────────────
async function importFile(
  client: PoolClient,
  fileName: string,
  buffer: Buffer,
  ctx: ParserContext,
): Promise<{ added: number; updated: number; skipped: number }> {
  if (!FILE_BY_NAME.has(fileName)) throw new Error(`Unknown file: ${fileName}`)
  return importChapter(client, fileName, buffer, ctx)
}

// ─── Parser export ────────────────────────────────────────────────────────
export const murphyRtfParser: RepertoryParser = {
  id: 'murphy_rtf',
  name: 'Murphy (RTF chapters)',
  description: 'Murphy repertory shipped as 74 RTF chapter files (one chapter per file)',
  fileSpec: FILE_SPECS,
  importOrder: IMPORT_ORDER,
  validate,
  preview,
  importFile,
}

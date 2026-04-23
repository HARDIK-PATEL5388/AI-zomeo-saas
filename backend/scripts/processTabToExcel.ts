/**
 * Zomeo.ai — TAB → Excel Local Processor
 *
 * Reads all 7 TAB files from data/row_data/complete_repertory/
 * Parses with correct column mappings, transforms, and writes
 * structured Excel files to data/output/
 *
 * Usage: npx tsx scripts/processTabToExcel.ts
 */

import fs from 'fs'
import path from 'path'
import iconv from 'iconv-lite'
import * as XLSX from 'xlsx'

const DATA_DIR = path.resolve(__dirname, '../../data/row_data/complete_repertory')
const OUTPUT_DIR = path.resolve(__dirname, '../../data/output')

// ─── TAB Parser ─────────────────────────────────────────────────────────────
function parseTab(filePath: string): string[][] {
  const buffer = fs.readFileSync(filePath)
  const text = iconv.decode(buffer, 'win1252')
  return text
    .split(/\r\n|\r|\n/)
    .filter(line => line.length > 0)
    .map(line => line.split('\t'))
}

function col(row: string[], idx: number, fallback = ''): string {
  return row[idx]?.trim() ?? fallback
}

function colInt(row: string[], idx: number, fallback = 0): number {
  const v = parseInt(row[idx]?.trim() ?? '')
  return isNaN(v) ? fallback : v
}

function writeExcel(fileName: string, headers: string[], data: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data])

  // Auto-width columns
  ws['!cols'] = headers.map((h, i) => {
    let maxLen = h.length
    for (const row of data.slice(0, 100)) {
      const cellLen = String(row[i] ?? '').length
      if (cellLen > maxLen) maxLen = cellLen
    }
    return { wch: Math.min(maxLen + 2, 60) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  const outPath = path.join(OUTPUT_DIR, fileName)
  XLSX.writeFile(wb, outPath)
  return outPath
}

// ─── 1. Process RemID.tab → remedies.xlsx ───────────────────────────────────
function processRemID() {
  console.log('\n━━━ 1/7 RemID.tab → remedies.xlsx ━━━')
  const rows = parseTab(path.join(DATA_DIR, 'RemID.tab'))
  console.log(`  Parsed ${rows.length} rows`)

  const headers = ['rem_code', 'abbreviation', 'name', 'extra']
  const data: any[][] = []

  for (const row of rows) {
    const remCode = colInt(row, 0)
    if (!remCode) continue
    data.push([
      remCode,
      col(row, 1),
      col(row, 2) || col(row, 1),
      col(row, 3),
    ])
  }

  const outPath = writeExcel('01_remedies.xlsx', headers, data)
  console.log(`  ✓ ${data.length} remedies → ${outPath}`)
  return data
}

// ─── 2. Process REPolar.tab → polar_pairs.xlsx ──────────────────────────────
function processREPolar() {
  console.log('\n━━━ 2/7 REPolar.tab → polar_pairs.xlsx ━━━')
  const rows = parseTab(path.join(DATA_DIR, 'REPolar.tab'))
  console.log(`  Parsed ${rows.length} rows`)

  const headers = ['rubric_ext_id_1', 'rubric_ext_id_2']
  const data: any[][] = []

  for (const row of rows) {
    const id1 = colInt(row, 0)
    const id2 = colInt(row, 1)
    if (!id1 || !id2) continue
    data.push([id1, id2])
  }

  const outPath = writeExcel('02_polar_pairs.xlsx', headers, data)
  console.log(`  ✓ ${data.length} pairs → ${outPath}`)
  return data
}

// ─── 3. Process Complete.tab → rubrics.xlsx (the rubric hierarchy) ──────────
function processRubrics() {
  console.log('\n━━━ 3/7 Complete.tab → rubrics.xlsx ━━━')
  const rows = parseTab(path.join(DATA_DIR, 'Complete.tab'))
  console.log(`  Parsed ${rows.length} rows (21 cols each)`)

  const headers = ['ext_id', 'sequence_id', 'parent_ext_id', 'depth', 'sort_key', 'chapter', 'rubric_text', 'full_path']
  const data: any[][] = []
  let skipped = 0

  for (const row of rows) {
    const extId = colInt(row, 0)
    if (!extId) { skipped++; continue }

    const seqId = colInt(row, 1)
    const parentExtId = colInt(row, 2) || ''
    const depth = colInt(row, 4)
    const sortKey = col(row, 5)
    const chapter = col(row, 6)

    // Build rubric text from depth-level columns (col 7+)
    const textParts: string[] = []
    for (let c = 7; c < row.length; c++) {
      const part = col(row, c)
      if (part) textParts.push(part)
    }

    const rubricText = textParts[textParts.length - 1] || ''
    const fullPath = textParts.join(' > ')

    if (!chapter || !rubricText) { skipped++; continue }

    data.push([extId, seqId, parentExtId, depth, sortKey, chapter, rubricText, fullPath])
  }

  const outPath = writeExcel('03_rubrics.xlsx', headers, data)
  console.log(`  ✓ ${data.length} rubrics → ${outPath} (${skipped} skipped)`)
  return data
}

// ─── 4. Process Pagerefs.tab → page_refs.xlsx ──────────────────────────────
function processPageRefs() {
  console.log('\n━━━ 4/7 Pagerefs.tab → page_refs.xlsx ━━━')
  const rows = parseTab(path.join(DATA_DIR, 'Pagerefs.tab'))
  console.log(`  Parsed ${rows.length} rows`)

  const headers = ['rubric_ext_id', 'book_refs', 'extra']
  const data: any[][] = []

  for (const row of rows) {
    const extId = colInt(row, 0)
    if (!extId) continue
    data.push([extId, col(row, 1), col(row, 2)])
  }

  const outPath = writeExcel('04_page_refs.xlsx', headers, data)
  console.log(`  ✓ ${data.length} page refs → ${outPath}`)
  return data
}

// ─── 5. Process LibraryIndex.tab → library_index.xlsx ───────────────────────
function processLibraryIndex() {
  console.log('\n━━━ 5/7 LibraryIndex.tab → library_index.xlsx ━━━')
  const rows = parseTab(path.join(DATA_DIR, 'LibraryIndex.tab'))
  console.log(`  Parsed ${rows.length} rows (12 cols each)`)

  const headers = ['id', 'col1', 'col2', 'reference', 'author', 'year', 'col6', 'col7', 'col8', 'col9', 'col10', 'col11']
  const data: any[][] = []

  for (const row of rows) {
    const id = colInt(row, 0)
    if (!id) continue
    data.push([
      id,
      col(row, 1), col(row, 2),
      col(row, 3), col(row, 4), col(row, 5),
      col(row, 6), col(row, 7), col(row, 8),
      col(row, 9), col(row, 10), col(row, 11),
    ])
  }

  const outPath = writeExcel('05_library_index.xlsx', headers, data)
  console.log(`  ✓ ${data.length} entries → ${outPath}`)
  return data
}

// ─── 6. Process PapaSub.tab → rubric_remedy_links.xlsx (no grade) ───────────
function processPapaSub() {
  console.log('\n━━━ 6/7 PapaSub.tab → rubric_remedy_links.xlsx ━━━')
  const rows = parseTab(path.join(DATA_DIR, 'PapaSub.tab'))
  console.log(`  Parsed ${rows.length} rows`)

  const headers = ['rubric_ext_id', 'remedy_rem_code', 'grade']
  const data: any[][] = []

  for (const row of rows) {
    const rubricExt = colInt(row, 0)
    const remedyCode = colInt(row, 1)
    if (!rubricExt || !remedyCode) continue
    data.push([rubricExt, remedyCode, 1])  // default grade 1
  }

  const outPath = writeExcel('06_rubric_remedy_links.xlsx', headers, data)
  console.log(`  ✓ ${data.length} links → ${outPath}`)
  return data
}

// ─── 7. Process Remlist.tab → rubric_remedy_grades.xlsx (WITH grade) ────────
function processRemlist() {
  console.log('\n━━━ 7/7 Remlist.tab → rubric_remedy_grades.xlsx ━━━')
  const rows = parseTab(path.join(DATA_DIR, 'Remlist.tab'))
  console.log(`  Parsed ${rows.length} rows (10 cols each)`)

  const headers = ['rubric_ext_id', 'remedy_rem_code', 'grade', 'col3', 'col4', 'col5', 'col6', 'col7', 'col8', 'col9']
  const data: any[][] = []
  let skipped = 0

  for (const row of rows) {
    const rubricExt = colInt(row, 0)
    const remedyCode = colInt(row, 1)
    if (!rubricExt || !remedyCode) { skipped++; continue }

    const grade = Math.min(4, Math.max(1, colInt(row, 2, 1)))

    data.push([
      rubricExt, remedyCode, grade,
      col(row, 3), col(row, 4), col(row, 5),
      col(row, 6), col(row, 7), col(row, 8), col(row, 9),
    ])
  }

  // Remlist is huge (2.8M rows) — split into multiple sheets if needed
  if (data.length > 1000000) {
    console.log(`  Large file: splitting into multiple Excel files...`)
    const CHUNK_SIZE = 500000
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const partNum = Math.floor(i / CHUNK_SIZE) + 1
      const slice = data.slice(i, i + CHUNK_SIZE)
      const outPath = writeExcel(`07_rubric_remedy_grades_part${partNum}.xlsx`, headers, slice)
      console.log(`  ✓ Part ${partNum}: ${slice.length} rows → ${outPath}`)
    }
  } else {
    const outPath = writeExcel('07_rubric_remedy_grades.xlsx', headers, data)
    console.log(`  ✓ ${data.length} entries → ${outPath}`)
  }

  console.log(`  (${skipped} skipped)`)
  return data
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║  Zomeo.ai — TAB → Excel Processor                          ║')
  console.log('╠══════════════════════════════════════════════════════════════╣')
  console.log(`║  Input:  ${DATA_DIR}`)
  console.log(`║  Output: ${OUTPUT_DIR}`)
  console.log('╚══════════════════════════════════════════════════════════════╝')

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  const start = Date.now()

  // Process all files in order
  processRemID()
  processREPolar()
  processRubrics()
  processPageRefs()
  processLibraryIndex()
  processPapaSub()
  processRemlist()

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(`  All done in ${elapsed}s`)
  console.log(`  Output files in: ${OUTPUT_DIR}`)
  console.log('══════════════════════════════════════════════════════════════')

  // List output files
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.xlsx'))
  for (const f of files) {
    const stat = fs.statSync(path.join(OUTPUT_DIR, f))
    const sizeMB = (stat.size / 1024 / 1024).toFixed(1)
    console.log(`  ${f} — ${sizeMB} MB`)
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})

/**
 * Zomeo.ai — Excel → Supabase Bulk Importer
 *
 * Reads processed Excel files from data/output/ and bulk-imports
 * into Supabase database using direct PostgreSQL connection for speed.
 *
 * Usage: npx tsx scripts/importExcelToDB.ts
 *   Options:
 *     --skip-rubrics     Skip rubrics import (if already done)
 *     --skip-remedies    Skip remedies import
 *     --only=remedies    Only import remedies
 *     --only=rubrics     Only import rubrics
 *     --only=links       Only import rubric-remedy links
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import { Pool } from 'pg'

const OUTPUT_DIR = path.resolve(__dirname, '../../data/output')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Increase timeouts for bulk operations
  statement_timeout: 120000,   // 2 min per statement
  query_timeout: 120000,
  idle_in_transaction_session_timeout: 300000,
})

function readExcel(fileName: string): any[][] {
  const filePath = path.join(OUTPUT_DIR, fileName)
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ File not found: ${fileName}`)
    return []
  }
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][]
  // Skip header row
  return data.slice(1)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

// ─── 1. Import Remedies ─────────────────────────────────────────────────────
async function importRemedies(client: any) {
  console.log('\n━━━ 1. Importing Remedies ━━━')
  const rows = readExcel('01_remedies.xlsx')
  if (rows.length === 0) return

  console.log(`  ${rows.length} remedies to import`)

  // Use a single transaction with multi-row INSERT ... ON CONFLICT
  await client.query('BEGIN')

  const batches = chunk(rows, 500)
  let total = 0

  for (const batch of batches) {
    const values: any[] = []
    const placeholders: string[] = []

    batch.forEach((row, i) => {
      const offset = i * 4
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`)
      values.push(
        row[0],              // rem_code
        row[1] || '',        // abbreviation
        row[2] || row[1],    // name
        row[3] || null,      // latin_name
      )
    })

    await client.query(`
      INSERT INTO remedies (rem_code, abbreviation, name, latin_name)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (rem_code) DO UPDATE SET
        abbreviation = EXCLUDED.abbreviation,
        name = EXCLUDED.name,
        latin_name = EXCLUDED.latin_name
    `, values)

    total += batch.length
  }

  await client.query('COMMIT')
  console.log(`  ✓ ${total} remedies imported`)
}

// ─── 2. Import Rubrics ──────────────────────────────────────────────────────
async function importRubrics(client: any, sourceId: string) {
  console.log('\n━━━ 2. Importing Rubrics ━━━')
  const rows = readExcel('03_rubrics.xlsx')
  if (rows.length === 0) return

  console.log(`  ${rows.length} rubrics to import`)

  // Load chapter map
  const { rows: chapters } = await client.query(
    `SELECT id, LOWER(name) as name, LOWER(code) as code FROM chapters WHERE source_id = $1`,
    [sourceId]
  )
  const chapterMap = new Map<string, string>()
  for (const ch of chapters) {
    chapterMap.set(ch.name, ch.id)
    chapterMap.set(ch.code, ch.id)
  }

  const fallbackChapterId = chapters[0]?.id

  // Pass 1: Insert rubrics without parent_id
  console.log('  Pass 1: Inserting rubrics...')
  await client.query('BEGIN')

  const batches = chunk(rows, 200)
  let total = 0

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi]
    const values: any[] = []
    const placeholders: string[] = []

    batch.forEach((row, i) => {
      const offset = i * 6
      const chapter = String(row[5] || '').toLowerCase()
      let chapterId = chapterMap.get(chapter) || fallbackChapterId

      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`)
      values.push(
        row[0],           // ext_id
        sourceId,         // source_id
        chapterId,        // chapter_id
        row[6] || '',     // name (rubric_text)
        row[7] || '',     // full_path
        (row[3] || 0) + 1, // level (depth + 1)
      )
    })

    await client.query(`
      INSERT INTO rubrics (ext_id, source_id, chapter_id, name, full_path, level)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (ext_id) DO UPDATE SET
        source_id = EXCLUDED.source_id,
        chapter_id = EXCLUDED.chapter_id,
        name = EXCLUDED.name,
        full_path = EXCLUDED.full_path,
        level = EXCLUDED.level
    `, values)

    total += batch.length

    if (bi % 100 === 0 && bi > 0) {
      // Commit periodically to avoid long transactions
      await client.query('COMMIT')
      await client.query('BEGIN')
      console.log(`  Progress: ${total}/${rows.length} (${Math.round(total / rows.length * 100)}%)`)
    }
  }

  await client.query('COMMIT')
  console.log(`  ✓ ${total} rubrics inserted`)

  // Pass 2: Update parent_id
  console.log('  Pass 2: Linking parents...')

  // Build ext_id → db_id map
  const { rows: allRubrics } = await client.query(
    `SELECT id, ext_id FROM rubrics WHERE source_id = $1 AND ext_id IS NOT NULL`,
    [sourceId]
  )
  const extToId = new Map<number, string>()
  for (const r of allRubrics) {
    extToId.set(r.ext_id, r.id)
  }

  console.log(`  Loaded ${extToId.size} rubric IDs`)

  await client.query('BEGIN')
  let parentCount = 0

  // Batch parent updates using CASE statements for efficiency
  const parentRows = rows.filter(r => r[2]) // has parent_ext_id
  const parentBatches = chunk(parentRows, 500)

  for (let bi = 0; bi < parentBatches.length; bi++) {
    const batch = parentBatches[bi]
    const updates: Array<{ id: string; parentId: string }> = []

    for (const row of batch) {
      const id = extToId.get(Number(row[0]))
      const parentId = extToId.get(Number(row[2]))
      if (id && parentId) {
        updates.push({ id, parentId })
      }
    }

    if (updates.length === 0) continue

    // Build a batch UPDATE using unnest
    const ids = updates.map(u => u.id)
    const parentIds = updates.map(u => u.parentId)

    await client.query(`
      UPDATE rubrics SET parent_id = data.parent_id
      FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::uuid[]) AS parent_id) AS data
      WHERE rubrics.id = data.id
    `, [ids, parentIds])

    parentCount += updates.length

    if (bi % 50 === 0 && bi > 0) {
      await client.query('COMMIT')
      await client.query('BEGIN')
      console.log(`  Parent links: ${parentCount}/${parentRows.length} (${Math.round(parentCount / parentRows.length * 100)}%)`)
    }
  }

  await client.query('COMMIT')
  console.log(`  ✓ ${parentCount} parent links updated`)
}

// ─── 3. Import Page Refs ────────────────────────────────────────────────────
async function importPageRefs(client: any, sourceId: string) {
  console.log('\n━━━ 3. Importing Page References ━━━')
  const rows = readExcel('04_page_refs.xlsx')
  if (rows.length === 0) return

  // Load rubric ext_id map
  const { rows: rubrics } = await client.query(
    `SELECT id, ext_id FROM rubrics WHERE source_id = $1 AND ext_id IS NOT NULL`,
    [sourceId]
  )
  const rubricMap = new Map<number, string>()
  for (const r of rubrics) rubricMap.set(r.ext_id, r.id)

  console.log(`  ${rows.length} page refs, ${rubricMap.size} rubrics loaded`)

  // Delete existing
  await client.query(`DELETE FROM page_refs WHERE rubric_id IN (SELECT id FROM rubrics WHERE source_id = $1)`, [sourceId])

  await client.query('BEGIN')
  let total = 0

  for (const batch of chunk(rows, 500)) {
    const values: any[] = []
    const placeholders: string[] = []
    let pi = 0

    for (const row of batch) {
      const rubricId = rubricMap.get(Number(row[0]))
      if (!rubricId) continue
      placeholders.push(`($${pi * 3 + 1}, $${pi * 3 + 2}, $${pi * 3 + 3})`)
      values.push(rubricId, row[1] || '', null)
      pi++
    }

    if (placeholders.length > 0) {
      await client.query(`
        INSERT INTO page_refs (rubric_id, book_code, page_number)
        VALUES ${placeholders.join(', ')}
      `, values)
      total += pi
    }
  }

  await client.query('COMMIT')
  console.log(`  ✓ ${total} page refs imported`)
}

// ─── 4. Import Library Index ────────────────────────────────────────────────
async function importLibraryIndex(client: any, sourceId: string) {
  console.log('\n━━━ 4. Importing Library Index ━━━')
  const rows = readExcel('05_library_index.xlsx')
  if (rows.length === 0) return

  const { rows: rubrics } = await client.query(
    `SELECT id, ext_id FROM rubrics WHERE source_id = $1 AND ext_id IS NOT NULL`,
    [sourceId]
  )
  const rubricMap = new Map<number, string>()
  for (const r of rubrics) rubricMap.set(r.ext_id, r.id)

  // Delete existing
  await client.query(`DELETE FROM library_index WHERE rubric_id IN (SELECT id FROM rubrics WHERE source_id = $1)`, [sourceId])

  await client.query('BEGIN')
  let total = 0

  for (const batch of chunk(rows, 500)) {
    const values: any[] = []
    const placeholders: string[] = []
    let pi = 0

    for (const row of batch) {
      const rubricId = rubricMap.get(Number(row[0]))
      if (!rubricId) continue
      placeholders.push(`($${pi * 4 + 1}, $${pi * 4 + 2}, $${pi * 4 + 3}, $${pi * 4 + 4})`)
      values.push(rubricId, row[3] || '', row[4] || '', row[5] || '')
      pi++
    }

    if (placeholders.length > 0) {
      await client.query(`
        INSERT INTO library_index (rubric_id, reference, author, year)
        VALUES ${placeholders.join(', ')}
      `, values)
      total += pi
    }
  }

  await client.query('COMMIT')
  console.log(`  ✓ ${total} library entries imported`)
}

// ─── 5. Import Rubric-Remedy Links ──────────────────────────────────────────
async function importRubricRemedyLinks(client: any, sourceId: string) {
  console.log('\n━━━ 5. Importing Rubric-Remedy Links ━━━')

  // Load maps
  const { rows: rubrics } = await client.query(
    `SELECT id, ext_id FROM rubrics WHERE source_id = $1 AND ext_id IS NOT NULL`,
    [sourceId]
  )
  const rubricMap = new Map<number, string>()
  for (const r of rubrics) rubricMap.set(r.ext_id, r.id)

  const { rows: remedies } = await client.query(
    `SELECT id, rem_code FROM remedies WHERE rem_code IS NOT NULL`
  )
  const remedyMap = new Map<number, string>()
  for (const r of remedies) remedyMap.set(r.rem_code, r.id)

  console.log(`  Maps: ${rubricMap.size} rubrics, ${remedyMap.size} remedies`)

  // Process PapaSub links first (no grade)
  const papaRows = readExcel('06_rubric_remedy_links.xlsx')
  if (papaRows.length > 0) {
    console.log(`  PapaSub: ${papaRows.length} links`)
    await importLinksBatch(client, papaRows, rubricMap, remedyMap, sourceId, 'PapaSub')
  }

  // Process Remlist parts (with grade) — the big files
  const remlistFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('07_rubric_remedy_grades'))
    .sort()

  for (const file of remlistFiles) {
    console.log(`  Loading ${file}...`)
    const rows = readExcel(file)
    console.log(`  ${file}: ${rows.length} links`)
    await importLinksBatch(client, rows, rubricMap, remedyMap, sourceId, file)
  }

  // Update remedy counts on rubrics
  console.log('  Updating remedy counts...')
  await client.query(`
    UPDATE rubrics SET remedy_count = sub.cnt
    FROM (
      SELECT rubric_id, COUNT(*) as cnt
      FROM rubric_remedies
      WHERE source_id = $1
      GROUP BY rubric_id
    ) sub
    WHERE rubrics.id = sub.rubric_id
  `, [sourceId])

  console.log('  ✓ Remedy counts updated')
}

async function importLinksBatch(
  client: any,
  rows: any[][],
  rubricMap: Map<number, string>,
  remedyMap: Map<number, string>,
  sourceId: string,
  label: string,
) {
  await client.query('BEGIN')
  let total = 0, skipped = 0

  const batches = chunk(rows, 500)
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi]
    const values: any[] = []
    const placeholders: string[] = []
    let pi = 0

    for (const row of batch) {
      const rubricId = rubricMap.get(Number(row[0]))
      const remedyId = remedyMap.get(Number(row[1]))
      if (!rubricId || !remedyId) { skipped++; continue }

      const grade = Math.min(4, Math.max(1, Number(row[2]) || 1))
      placeholders.push(`($${pi * 4 + 1}, $${pi * 4 + 2}, $${pi * 4 + 3}, $${pi * 4 + 4})`)
      values.push(rubricId, remedyId, grade, sourceId)
      pi++
    }

    if (placeholders.length > 0) {
      await client.query(`
        INSERT INTO rubric_remedies (rubric_id, remedy_id, grade, source_id)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (rubric_id, remedy_id, source_id) DO UPDATE SET
          grade = GREATEST(rubric_remedies.grade, EXCLUDED.grade)
      `, values)
      total += pi
    }

    if (bi % 100 === 0 && bi > 0) {
      await client.query('COMMIT')
      await client.query('BEGIN')
      console.log(`  [${label}] Progress: ${total} inserted, ${skipped} skipped (${Math.round((bi + 1) / batches.length * 100)}%)`)
    }
  }

  await client.query('COMMIT')
  console.log(`  [${label}] ✓ ${total} inserted, ${skipped} skipped`)
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const only = args.find(a => a.startsWith('--only='))?.split('=')[1]
  const skipRubrics = args.includes('--skip-rubrics')
  const skipRemedies = args.includes('--skip-remedies')

  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║  Zomeo.ai — Excel → Database Bulk Importer                 ║')
  console.log('╠══════════════════════════════════════════════════════════════╣')
  console.log(`║  Source: ${OUTPUT_DIR}`)
  console.log(`║  DB:     ${process.env.DATABASE_URL?.substring(0, 40)}...`)
  console.log('╚══════════════════════════════════════════════════════════════╝')

  const client = await pool.connect()

  // Set longer timeouts for bulk operations
  await client.query('SET statement_timeout = 300000')  // 5 min
  await client.query('SET lock_timeout = 60000')

  const start = Date.now()

  try {
    // Get the Complete Repertory source ID
    const { rows: sources } = await client.query(
      `SELECT id, name FROM repertory_sources LIMIT 5`
    )
    console.log('\nAvailable sources:', sources.map(s => `${s.id}: ${s.name}`).join(', '))

    if (sources.length === 0) {
      throw new Error('No repertory sources found. Run migrations first.')
    }

    const sourceId = sources[0].id
    console.log(`Using source: ${sourceId} (${sources[0].name})`)

    if (only === 'remedies' || (!only && !skipRemedies)) {
      await importRemedies(client)
    }

    if (only === 'rubrics' || (!only && !skipRubrics)) {
      await importRubrics(client, sourceId)
    }

    if (!only || only === 'pagerefs') {
      await importPageRefs(client, sourceId)
    }

    if (!only || only === 'library') {
      await importLibraryIndex(client, sourceId)
    }

    if (only === 'links' || !only) {
      await importRubricRemedyLinks(client, sourceId)
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log('\n══════════════════════════════════════════════════════════════')
    console.log(`  ✓ All imports complete in ${elapsed}s`)
    console.log('══════════════════════════════════════════════════════════════')

  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('\n✗ Import failed:', err.message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(() => process.exit(1))

/**
 * Resume import from Part 5 — imports remaining rubric-remedy links
 * with connection retry logic to handle Supabase connection drops
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import { Pool } from 'pg'

const OUTPUT_DIR = path.resolve(__dirname, '../../data/output')

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    max: 1,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 30000,
  })
}

function readExcel(fileName: string): any[][] {
  const filePath = path.join(OUTPUT_DIR, fileName)
  if (!fs.existsSync(filePath)) return []
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  return (XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][]).slice(1)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function importFile(
  fileName: string,
  rubricMap: Map<number, string>,
  remedyMap: Map<number, string>,
  sourceId: string,
) {
  console.log(`\nLoading ${fileName}...`)
  const rows = readExcel(fileName)
  if (rows.length === 0) { console.log('  Empty file, skipping'); return }
  console.log(`  ${rows.length} rows`)

  const batches = chunk(rows, 300)
  let total = 0, skipped = 0

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi]

    // Build values for this batch
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

    if (placeholders.length === 0) continue

    // Retry logic for connection drops
    let retries = 3
    while (retries > 0) {
      let pool: Pool | null = null
      try {
        pool = createPool()
        const client = await pool.connect()
        await client.query('SET statement_timeout = 120000')
        await client.query(`
          INSERT INTO rubric_remedies (rubric_id, remedy_id, grade, source_id)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (rubric_id, remedy_id, source_id) DO UPDATE SET
            grade = GREATEST(rubric_remedies.grade, EXCLUDED.grade)
        `, values)
        client.release()
        await pool.end()
        total += pi
        break
      } catch (err: any) {
        if (pool) await pool.end().catch(() => {})
        retries--
        if (retries === 0) throw err
        console.log(`  Retry (${3 - retries}/3) after error: ${err.message.substring(0, 60)}`)
        await sleep(5000)
      }
    }

    if (bi % 50 === 0 && bi > 0) {
      console.log(`  [${fileName}] ${total} inserted, ${skipped} skipped (${Math.round((bi + 1) / batches.length * 100)}%)`)
    }
  }

  console.log(`  [${fileName}] ✓ ${total} inserted, ${skipped} skipped`)
}

async function main() {
  console.log('═══ Resuming import: Parts 5-6 + remedy count update ═══')

  // Load ID maps using a fresh connection
  let pool = createPool()
  let client = await pool.connect()
  await client.query('SET statement_timeout = 300000')

  const sourceId = (await client.query(`SELECT id FROM repertory_sources LIMIT 1`)).rows[0].id
  console.log(`Source: ${sourceId}`)

  console.log('Loading rubric map...')
  const { rows: rubrics } = await client.query(
    `SELECT id, ext_id FROM rubrics WHERE source_id = $1 AND ext_id IS NOT NULL`, [sourceId]
  )
  const rubricMap = new Map<number, string>()
  for (const r of rubrics) rubricMap.set(r.ext_id, r.id)
  console.log(`  ${rubricMap.size} rubrics`)

  console.log('Loading remedy map...')
  const { rows: remedies } = await client.query(
    `SELECT id, rem_code FROM remedies WHERE rem_code IS NOT NULL`
  )
  const remedyMap = new Map<number, string>()
  for (const r of remedies) remedyMap.set(r.rem_code, r.id)
  console.log(`  ${remedyMap.size} remedies`)

  client.release()
  await pool.end()

  // Import remaining files
  const files = ['07_rubric_remedy_grades_part5.xlsx', '07_rubric_remedy_grades_part6.xlsx']
  for (const f of files) {
    await importFile(f, rubricMap, remedyMap, sourceId)
  }

  // Update remedy counts
  console.log('\nUpdating remedy counts on rubrics...')
  pool = createPool()
  client = await pool.connect()
  await client.query('SET statement_timeout = 300000')
  await client.query(`
    UPDATE rubrics SET remedy_count = sub.cnt
    FROM (
      SELECT rubric_id, COUNT(*) as cnt FROM rubric_remedies WHERE source_id = $1 GROUP BY rubric_id
    ) sub
    WHERE rubrics.id = sub.rubric_id
  `, [sourceId])
  console.log('  ✓ Remedy counts updated')

  // Final counts
  const counts = await client.query(`SELECT
    (SELECT COUNT(*) FROM remedies) as remedies,
    (SELECT COUNT(*) FROM rubrics) as rubrics,
    (SELECT COUNT(*) FROM rubric_remedies) as links,
    (SELECT COUNT(*) FROM page_refs) as pagerefs
  `)
  console.log('\n═══ FINAL DATABASE COUNTS ═══')
  console.log(counts.rows[0])

  client.release()
  await pool.end()
  console.log('\n✓ All done!')
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1) })

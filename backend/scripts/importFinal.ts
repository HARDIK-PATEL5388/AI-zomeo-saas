/**
 * Final import — Parts 5 & 6 with single persistent connection + keepalive
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import { Client } from 'pg'

const OUTPUT_DIR = path.resolve(__dirname, '../../data/output')

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

async function main() {
  // Use Client (not Pool) for a single persistent connection
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  })

  await client.connect()
  console.log('Connected to database')

  // Disable statement timeout for bulk operations
  await client.query('SET statement_timeout = 0')
  await client.query('SET idle_in_transaction_session_timeout = 0')

  const sourceId = (await client.query(`SELECT id FROM repertory_sources LIMIT 1`)).rows[0].id
  console.log(`Source: ${sourceId}`)

  // Load maps
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

  // Check what's already imported (Part 5 had ~100K before crash)
  const { rows: countRow } = await client.query(`SELECT COUNT(*) as cnt FROM rubric_remedies`)
  console.log(`Current rubric_remedies count: ${countRow[0].cnt}`)

  const files = ['07_rubric_remedy_grades_part5.xlsx', '07_rubric_remedy_grades_part6.xlsx']

  for (const fileName of files) {
    console.log(`\n═══ ${fileName} ═══`)
    const rows = readExcel(fileName)
    if (rows.length === 0) { console.log('  Empty, skip'); continue }
    console.log(`  ${rows.length} rows`)

    const batches = chunk(rows, 500)
    let total = 0, skipped = 0

    await client.query('BEGIN')

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

      // Commit every 100 batches to avoid long transactions
      if (bi % 100 === 0 && bi > 0) {
        await client.query('COMMIT')
        await client.query('BEGIN')
        console.log(`  ${total} inserted, ${skipped} skipped (${Math.round((bi + 1) / batches.length * 100)}%)`)
      }
    }

    await client.query('COMMIT')
    console.log(`  ✓ ${total} inserted, ${skipped} skipped`)
  }

  // Update remedy counts
  console.log('\nUpdating remedy counts...')
  await client.query(`
    UPDATE rubrics SET remedy_count = sub.cnt
    FROM (
      SELECT rubric_id, COUNT(*) as cnt FROM rubric_remedies WHERE source_id = $1 GROUP BY rubric_id
    ) sub
    WHERE rubrics.id = sub.rubric_id
  `, [sourceId])
  console.log('  ✓ Done')

  // Final counts
  const { rows: final } = await client.query(`SELECT
    (SELECT COUNT(*) FROM remedies) as remedies,
    (SELECT COUNT(*) FROM rubrics) as rubrics,
    (SELECT COUNT(*) FROM rubric_remedies) as links,
    (SELECT COUNT(*) FROM page_refs) as pagerefs
  `)
  console.log('\n═══ FINAL DATABASE COUNTS ═══')
  console.log(final[0])

  await client.end()
  console.log('\n✓ All done!')
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1) })

/** Minimal pg script — no app imports — for when the wider service tree is slow. */
import { Pool } from 'pg'

async function main() {
  const url = process.env.DATABASE_URL
    ?? 'postgres://postgres:StrongPassword%40123@localhost:5432/mydb'
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10_000 })
  console.log('connecting…')
  const c = await pool.connect()
  console.log('connected, deleting…')
  try {
    const r1 = await c.query(`DELETE FROM rep_rubric_remedies WHERE book_id=(SELECT id FROM rep_books WHERE code='khullar')`)
    console.log(`  rrem deleted: ${r1.rowCount}`)
    const r2 = await c.query(`DELETE FROM rep_rubrics         WHERE book_id=(SELECT id FROM rep_books WHERE code='khullar')`)
    console.log(`  rubrics deleted: ${r2.rowCount}`)
    const r3 = await c.query(`DELETE FROM rep_book_chapters   WHERE book_id=(SELECT id FROM rep_books WHERE code='khullar')`)
    console.log(`  chapters deleted: ${r3.rowCount}`)
    const r4 = await c.query(`DELETE FROM rep_file_versions   WHERE book_code='khullar'`)
    console.log(`  file_versions deleted: ${r4.rowCount}`)
    console.log('Khullar wiped.')
  } finally {
    c.release()
    await pool.end()
  }
}
main().catch(e => { console.error(e); process.exit(1) })

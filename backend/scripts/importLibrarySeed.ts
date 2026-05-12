/*
 * One-shot bulk-import of the legacy Library seed into lib_* tables.
 *
 * Reads four files from <repoRoot>/Insert/:
 *   - BookType.sql       → lib_book_types
 *   - Author.sql         → lib_authors
 *   - FileDetails.sql    → lib_books
 *   - BooksChapters.sql  → lib_book_chapters
 *
 * Idempotent: every insert is ON CONFLICT DO NOTHING. Safe to re-run.
 * The Blackie seed from migration 012 survives untouched (its rows
 * conflict and are skipped, content is preserved).
 *
 * Usage:  cd backend && npx tsx scripts/importLibrarySeed.ts
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const INSERT_DIR = resolve(__dirname, '../../Insert')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Split a SQL `values (...)` argument list, respecting single-quoted strings
// (with '' as an escaped quote). Returns the raw token list (strings still
// wrapped in quotes; numbers as numeric strings).
function splitValueRow(raw: string): string[] {
  const out: string[] = []
  let i = 0
  let token = ''
  let inStr = false
  while (i < raw.length) {
    const ch = raw[i]
    if (inStr) {
      if (ch === "'" && raw[i + 1] === "'") {
        token += "''"
        i += 2
        continue
      }
      if (ch === "'") {
        token += "'"
        inStr = false
        i++
        continue
      }
      token += ch
      i++
      continue
    }
    if (ch === "'") {
      inStr = true
      token += "'"
      i++
      continue
    }
    if (ch === ',') {
      out.push(token.trim())
      token = ''
      i++
      continue
    }
    token += ch
    i++
  }
  if (token.trim().length) out.push(token.trim())
  return out
}

// Strip the surrounding 'quotes' from a SQL string literal and unescape ''.
function unquote(s: string): string {
  const t = s.trim()
  if (t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'")
  }
  return t
}

function parseInsertRows(sql: string, table: string): string[][] {
  const re = new RegExp(
    `insert\\s+into\\s+${table}\\s+values\\s*\\(([\\s\\S]*?)\\)\\s*;`,
    'gi',
  )
  const rows: string[][] = []
  for (const m of sql.matchAll(re)) {
    rows.push(splitValueRow(m[1]))
  }
  return rows
}

async function importBookTypes() {
  const sql = readFileSync(resolve(INSERT_DIR, 'BookType.sql'), 'utf8')
  const rows = parseInsertRows(sql, 'tbl_book_type')
  let inserted = 0
  for (const r of rows) {
    const id = Number(r[0])
    const name = unquote(r[1])
    const sortOrderRaw = unquote(r[2])
    const sortOrder = Number.parseInt(sortOrderRaw, 10) || 0
    const res = await pool.query(
      `INSERT INTO lib_book_types (id, name, sort_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [id, name, sortOrder],
    )
    inserted += res.rowCount ?? 0
  }
  console.log(`lib_book_types: parsed=${rows.length}, inserted=${inserted}`)
}

async function importAuthors() {
  const sql = readFileSync(resolve(INSERT_DIR, 'Author.sql'), 'utf8')
  const rows = parseInsertRows(sql, 'tbl_author')
  // Batch in chunks of 500 for speed
  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const values: string[] = []
    const params: unknown[] = []
    slice.forEach((r, j) => {
      values.push(`($${j * 2 + 1}, $${j * 2 + 2})`)
      params.push(Number(r[0]), unquote(r[1]))
    })
    const res = await pool.query(
      `INSERT INTO lib_authors (id, name) VALUES ${values.join(',')}
       ON CONFLICT (id) DO NOTHING`,
      params,
    )
    inserted += res.rowCount ?? 0
  }
  console.log(`lib_authors: parsed=${rows.length}, inserted=${inserted}`)
}

async function importBooks() {
  const sql = readFileSync(resolve(INSERT_DIR, 'FileDetails.sql'), 'utf8')
  const rows = parseInsertRows(sql, 'tbl_file_details')
  const CHUNK = 500
  let inserted = 0
  let skipped = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const values: string[] = []
    const params: unknown[] = []
    let col = 0
    for (const r of slice) {
      // Columns: id, sub_id, fs_code, title, author_id, book_type_id, active
      const id = Number(r[0])
      const fsCode = unquote(r[2])
      const title = unquote(r[3])
      const authorId = Number(r[4])
      const bookTypeId = Number(r[5])
      const active = Number(r[6]) >= 1
      // Defensive: skip rows that reference a book_type_id we don't have seeded.
      // Easiest to enforce at DB level via FK; we let it fail individually below.
      if (!Number.isFinite(id) || !title) {
        skipped++
        continue
      }
      values.push(
        `($${col + 1}, $${col + 2}, $${col + 3}, $${col + 4}, $${col + 5}, $${col + 6})`,
      )
      params.push(id, fsCode, title, Number.isFinite(authorId) ? authorId : null, bookTypeId, active)
      col += 6
    }
    if (values.length === 0) continue
    try {
      const res = await pool.query(
        `INSERT INTO lib_books (id, fs_code, title, author_id, book_type_id, is_active)
         VALUES ${values.join(',')}
         ON CONFLICT (id) DO NOTHING`,
        params,
      )
      inserted += res.rowCount ?? 0
    } catch (e: any) {
      // Fall back to per-row inserts when a batch contains a FK violation
      console.warn(`  batch failed (${e.message}); falling back to per-row`)
      for (let j = 0; j < values.length; j++) {
        const start = j * 6
        const rowParams = params.slice(start, start + 6)
        try {
          const res = await pool.query(
            `INSERT INTO lib_books (id, fs_code, title, author_id, book_type_id, is_active)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            rowParams,
          )
          inserted += res.rowCount ?? 0
        } catch {
          skipped++
        }
      }
    }
  }
  console.log(`lib_books: parsed=${rows.length}, inserted=${inserted}, skipped=${skipped}`)
}

async function importChapters() {
  const sql = readFileSync(resolve(INSERT_DIR, 'BooksChapters.sql'), 'utf8')
  const rows = parseInsertRows(sql, 'tbl_books_chapter')
  console.log(`lib_book_chapters: parsing ${rows.length} rows...`)
  const CHUNK = 1000
  let inserted = 0
  let skipped = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const values: string[] = []
    const params: unknown[] = []
    let col = 0
    for (const r of slice) {
      // Columns: legacy_id, book_id, chapter_name, file_offset, remedy_id, ...
      const legacyId = Number(r[0])
      const bookId = Number(r[1])
      const name = unquote(r[2])
      const fileOffset = Number(r[3])
      const remedyIdRaw = Number(r[4])
      const remedyId = Number.isFinite(remedyIdRaw) && remedyIdRaw > 0 ? remedyIdRaw : null
      if (!Number.isFinite(bookId) || !name) {
        skipped++
        continue
      }
      // sort_order = legacy chapter id (globally monotone within file, and
      // monotone within each book — perfect for ORDER BY)
      values.push(
        `($${col + 1}, $${col + 2}, $${col + 3}, $${col + 4}, $${col + 5})`,
      )
      params.push(bookId, name, legacyId, fileOffset, remedyId)
      col += 5
    }
    if (values.length === 0) continue
    try {
      const res = await pool.query(
        `INSERT INTO lib_book_chapters (book_id, name, sort_order, file_offset, remedy_id)
         VALUES ${values.join(',')}
         ON CONFLICT (book_id, sort_order) DO NOTHING`,
        params,
      )
      inserted += res.rowCount ?? 0
    } catch (e: any) {
      // Likely an orphan book_id (book not imported). Fall back per-row.
      for (let j = 0; j < values.length; j++) {
        const start = j * 5
        const rowParams = params.slice(start, start + 5)
        try {
          const res = await pool.query(
            `INSERT INTO lib_book_chapters (book_id, name, sort_order, file_offset, remedy_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (book_id, sort_order) DO NOTHING`,
            rowParams,
          )
          inserted += res.rowCount ?? 0
        } catch {
          skipped++
        }
      }
    }
    if (i % 10000 === 0 && i > 0) console.log(`  …${i}/${rows.length}`)
  }
  console.log(`lib_book_chapters: parsed=${rows.length}, inserted=${inserted}, skipped=${skipped}`)
}

async function main() {
  console.log('Bulk seed import — starting')
  console.time('total')
  await importBookTypes()
  await importAuthors()
  await importBooks()
  await importChapters()
  console.log('--- final counts ---')
  for (const tbl of ['lib_book_types', 'lib_authors', 'lib_books', 'lib_book_chapters']) {
    const r = await pool.query(`SELECT COUNT(*) AS n FROM ${tbl}`)
    console.log(`  ${tbl}: ${r.rows[0].n}`)
  }
  console.timeEnd('total')
  await pool.end()
}

main().catch(e => {
  console.error('IMPORT FAILED:', e)
  pool.end()
  process.exit(1)
})

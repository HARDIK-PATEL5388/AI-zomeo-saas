/**
 * Murphy import driver — drives the parser-aware repertoryUploadService against
 * the 74 RTF chapter files in `oldandnew/Murphy/`. Equivalent to running the
 * upload wizard with all 74 files selected.
 *
 *   cd backend && npx tsx scripts/importMurphy.ts
 *
 * Side effects:
 *   - Creates rep_books row (code='murphy', parser_type='murphy_rtf') if missing
 *   - Inserts rep_book_chapters / rep_rubrics / rep_rubric_remedies for Murphy
 *   - Reuses rep_remedies entries by canonical abbreviation
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import {
  validateFiles, createJob, runImport, localPool,
} from '../src/services/repertoryUploadService'

const SOURCE_DIR = process.env.MURPHY_DIR
  ?? 'C:/Users/Beact Infotech/Downloads/ciicic/oldandnew/Murphy'

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Murphy source dir not found: ${SOURCE_DIR}`)
    process.exit(1)
  }

  // Read every .rtf in the directory; the parser will reject any that don't
  // match the 74-file contract.
  const files = new Map<string, Buffer>()
  for (const entry of fs.readdirSync(SOURCE_DIR)) {
    if (!entry.toLowerCase().endsWith('.rtf')) continue
    if (entry.startsWith('~$')) continue   // Word/WordPad lock files
    const full = path.join(SOURCE_DIR, entry)
    files.set(entry, fs.readFileSync(full))
  }
  console.log(`Found ${files.size} .rtf files in ${SOURCE_DIR}`)

  const validation = validateFiles(files, 'murphy_rtf')
  if (!validation.ok) {
    console.error('Validation failed:')
    for (const i of validation.issues) console.error(`  - ${i.file}: ${i.problem}`)
    process.exit(2)
  }

  const jobId = await createJob(files, validation, {
    bookCode: 'murphy',
    bookName: 'Murphy',
    parserId: 'murphy_rtf',
    source: 'oldandnew/Murphy',
  })
  console.log(`Job #${jobId} created — running import…`)

  const startedAt = Date.now()
  const summary = await runImport(jobId, files, (file, msg) => {
    console.log(`[${file}] ${msg}`)
  })
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)

  let added = 0, skipped = 0, failed = 0, missing = 0, unchanged = 0
  for (const s of summary) {
    if (s.status === 'SYNCED')   { added += s.added ?? 0; skipped += s.skipped ?? 0 }
    if (s.status === 'FAILED')   failed++
    if (s.status === 'MISSING')  missing++
    if (s.status === 'UNCHANGED') unchanged++
  }
  console.log(`\nImport done in ${elapsed}s — added=${added} skipped=${skipped} failed=${failed} missing=${missing} unchanged=${unchanged}`)
  if (failed > 0) {
    console.error('Failed files:')
    for (const s of summary) if (s.status === 'FAILED') console.error(`  - ${s.file}: ${s.error}`)
    process.exit(3)
  }
  await localPool.end()
}

main().catch(e => { console.error(e); process.exit(99) })

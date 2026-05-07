/**
 * Phatak import driver — drives the parser-aware repertoryUploadService
 * against the single PHATAK.txt file shipped in
 * `oldandnew/Phatak/PHATAK.txt`. Equivalent to running the upload wizard
 * with PHATAK.txt selected and parser_type=phatak_txt.
 *
 *   cd backend && npx tsx scripts/import-phatak.ts
 *
 * Side effects:
 *   - Creates rep_books row (code='phatak', parser_type='phatak_txt') if missing
 *   - Inserts rep_book_chapters / rep_rubrics / rep_rubric_remedies for Phatak
 *   - Reuses rep_remedies entries by canonical abbreviation (shared lookup
 *     across Complete + Murphy + Khullar + Jeremy)
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import {
  validateFiles, createJob, runImport, localPool,
} from '../src/services/repertoryUploadService'

const SOURCE_FILE = process.env.PHATAK_FILE
  ?? 'C:/Users/Beact Infotech/Downloads/ciicic/oldandnew/Phatak/PHATAK.txt'

async function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`Phatak source file not found: ${SOURCE_FILE}`)
    process.exit(1)
  }

  const files = new Map<string, Buffer>()
  files.set(path.basename(SOURCE_FILE), fs.readFileSync(SOURCE_FILE))
  console.log(`Loaded ${files.size} file from ${SOURCE_FILE}`)

  const validation = validateFiles(files, 'phatak_txt')
  if (!validation.ok) {
    console.error('Validation failed:')
    for (const i of validation.issues) console.error(`  - ${i.file}: ${i.problem}`)
    process.exit(2)
  }

  const jobId = await createJob(files, validation, {
    bookCode: 'phatak',
    bookName: 'Phatak',
    parserId: 'phatak_txt',
    source: 'oldandnew/Phatak',
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

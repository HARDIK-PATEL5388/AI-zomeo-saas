// Zomeo.ai — TAB File Importer
// Imports Complete Repertory TAB files into Supabase in correct FK order
//
// Actual file roles (verified from data):
//   RemID.tab      (4 cols,  2760 rows)  = remedy master: rem_code, abbrev, full_name
//   Remlist.tab    (10 cols, 2.8M rows)  = rubric-remedy junction: rubric_ext_id, rem_code, grade
//   REPolar.tab    (2 cols,  3561 rows)  = polar rubric pairs
//   Complete.tab   (21 cols, 544K rows)  = rubric hierarchy: ext_id, seq, parent, depth, chapter, text
//   PapaSub.tab    (2 cols,  185K rows)  = rubric-remedy links (no grade): rubric_ext_id, rem_code
//   Pagerefs.tab   (3 cols,  82K rows)   = page references
//   LibraryIndex   (12 cols, 10K rows)   = literature references
//
// Import order: RemID → REPolar → Complete(rubrics) → Pagerefs → LibraryIndex → PapaSub(links) → Remlist(links+grade)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { parseTabBuffer, col, colInt, chunk } from './tabParser'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const IMPORT_ORDER = [
  'RemID.tab',        // 1. remedies master
  'REPolar.tab',      // 2. polar pairs (metadata only)
  'Complete.tab',     // 3. rubric hierarchy (must come before junction tables)
  'Pagerefs.tab',     // 4. page refs (needs rubrics)
  'LibraryIndex.tab', // 5. library refs (needs rubrics)
  'PapaSub.tab',      // 6. rubric-remedy links without grade
  'Remlist.tab',      // 7. rubric-remedy links WITH grade (the big one, always last)
]

export interface FileSummary {
  file: string
  status: 'SYNCED' | 'UNCHANGED' | 'MISSING' | 'FAILED'
  hash?: string
  added?: number
  updated?: number
  skipped?: number
  error?: string
}

function md5(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex')
}

async function isAlreadyImported(fileName: string, hash: string): Promise<boolean> {
  const { data } = await supabase
    .from('file_versions')
    .select('id')
    .eq('file_name', fileName)
    .eq('md5_hash', hash)
    .eq('status', 'done')
    .maybeSingle()
  return !!data
}

// ─── 1. Remedy Master (RemID.tab — 4 cols) ─────────────────────────────────
// Format: rem_code \t abbreviation \t full_name \t common_name
async function importRemID(buffer: Buffer, sourceId: string) {
  const rows = parseTabBuffer(buffer)
  const records: any[] = []

  for (const row of rows) {
    const remCode = colInt(row, 0)
    if (!remCode) continue
    records.push({
      rem_code: remCode,
      abbreviation: col(row, 1),
      name: col(row, 2) || col(row, 1),
      latin_name: col(row, 2) || undefined,
      common_name: col(row, 3) || undefined,
    })
  }

  let added = 0
  for (const batch of chunk(records, 200)) {
    const { error } = await supabase
      .from('remedies')
      .upsert(batch, { onConflict: 'rem_code', ignoreDuplicates: false })
    if (error) throw new Error(`remedies upsert failed: ${error.message}`)
    added += batch.length
  }

  return { added, updated: 0, skipped: 0 }
}

// ─── 2. Polar Groups (REPolar.tab — 2 cols) ────────────────────────────────
async function importREPolar(buffer: Buffer, sourceId: string) {
  const rows = parseTabBuffer(buffer)
  let updated = 0, skipped = 0

  for (const row of rows) {
    const id1 = colInt(row, 0)
    const id2 = colInt(row, 1)
    if (!id1 || !id2) { skipped++; continue }
    updated++
  }

  return { added: 0, updated, skipped }
}

// ─── 3. Rubric Hierarchy (Complete.tab — 21 cols) ───────────────────────────
// Format: ext_id \t seq \t parent_ext_id \t _ \t depth \t sort_key \t chapter \t text_parts[7..20]
async function importRubricHierarchy(
  buffer: Buffer,
  sourceId: string,
  onProgress?: (msg: string) => void
) {
  const rows = parseTabBuffer(buffer)
  let added = 0, skipped = 0

  // Load chapters
  const { data: chapters } = await supabase
    .from('chapters')
    .select('id, name, code')
    .eq('source_id', sourceId)

  const chapterMap = new Map<string, string>()
  for (const ch of chapters || []) {
    chapterMap.set(ch.name.toLowerCase(), ch.id)
    chapterMap.set(ch.code.toLowerCase(), ch.id)
  }

  onProgress?.('Pass 1: Parsing rubrics...')

  const rubricRecords: Array<{
    ext_id: number
    parent_ext_id: number | null
    chapter: string
    rubric_text: string
    depth: number
    full_path: string
  }> = []

  for (const row of rows) {
    const extId = colInt(row, 0)
    if (!extId) { skipped++; continue }

    const parentExtId = colInt(row, 2) || null
    const depth = colInt(row, 4)
    const chapter = col(row, 6)

    // Build rubric text from depth-level columns (col 7 onwards)
    const textParts: string[] = []
    for (let c = 7; c < row.length; c++) {
      const part = col(row, c)
      if (part) textParts.push(part)
    }

    const rubricText = textParts[textParts.length - 1] || ''
    const fullPath = textParts.join(' > ')

    if (!chapter || !rubricText) { skipped++; continue }

    rubricRecords.push({
      ext_id: extId,
      parent_ext_id: parentExtId,
      chapter,
      rubric_text: rubricText,
      depth,
      full_path: fullPath || rubricText,
    })
  }

  onProgress?.(`Pass 2: Inserting ${rubricRecords.length} rubrics (batch size 100)...`)

  // Pass 1: Insert rubrics without parent_id — small batches to avoid timeout
  let batchNum = 0
  const batches = chunk(rubricRecords, 100)
  for (const batch of batches) {
    batchNum++
    if (batchNum % 50 === 0) {
      onProgress?.(`Inserting batch ${batchNum}/${batches.length} (${added} done)...`)
    }

    const inserts = batch.map(r => {
      let chapterId = chapterMap.get(r.chapter.toLowerCase())
      if (!chapterId) {
        // Try partial match
        for (const [key, id] of chapterMap) {
          if (r.chapter.toLowerCase().startsWith(key.substring(0, 3))) {
            chapterId = id
            break
          }
        }
        if (!chapterId) chapterId = chapterMap.values().next().value
      }

      return {
        ext_id: r.ext_id,
        source_id: sourceId,
        chapter_id: chapterId,
        name: r.rubric_text,
        full_path: r.full_path,
        level: r.depth + 1,
        remedy_count: 0,
      }
    })

    const { error } = await supabase
      .from('rubrics')
      .upsert(inserts, { onConflict: 'ext_id', ignoreDuplicates: false })
    if (error) throw new Error(`rubrics upsert batch ${batchNum} failed: ${error.message}`)
    added += inserts.length
  }

  onProgress?.(`Pass 3: Linking parent rubrics (${rubricRecords.filter(r => r.parent_ext_id).length} links)...`)

  // Pass 2: Update parent_id — fetch ext_id map in pages to handle large datasets
  const extToId = new Map<number, string>()
  let offset = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data: page } = await supabase
      .from('rubrics')
      .select('id, ext_id')
      .eq('source_id', sourceId)
      .not('ext_id', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1)

    if (!page || page.length === 0) break
    for (const r of page) {
      if (r.ext_id) extToId.set(r.ext_id, r.id)
    }
    offset += page.length
    if (page.length < PAGE_SIZE) break
  }

  onProgress?.(`Loaded ${extToId.size} rubric IDs, updating parents...`)

  let parentUpdated = 0
  let parentBatch: Array<{ id: string; parent_id: string }> = []

  for (const rec of rubricRecords) {
    if (!rec.parent_ext_id) continue
    const id = extToId.get(rec.ext_id)
    const parentId = extToId.get(rec.parent_ext_id)
    if (!id || !parentId) continue
    parentBatch.push({ id, parent_id: parentId })

    if (parentBatch.length >= 100) {
      for (const item of parentBatch) {
        await supabase.from('rubrics').update({ parent_id: item.parent_id }).eq('id', item.id)
      }
      parentUpdated += parentBatch.length
      if (parentUpdated % 1000 === 0) onProgress?.(`Parent links: ${parentUpdated} done...`)
      parentBatch = []
    }
  }

  for (const item of parentBatch) {
    await supabase.from('rubrics').update({ parent_id: item.parent_id }).eq('id', item.id)
  }
  parentUpdated += parentBatch.length

  onProgress?.(`Done: ${added} rubrics, ${parentUpdated} parent links`)
  return { added, updated: parentUpdated, skipped }
}

// ─── 4. Page References (Pagerefs.tab — 3 cols) ────────────────────────────
async function importPagerefs(buffer: Buffer, sourceId: string) {
  const rows = parseTabBuffer(buffer)

  // Load rubric ext_id map in pages
  const rubricMap = await loadRubricExtIdMap(sourceId)

  const records: any[] = []
  let skipped = 0

  for (const row of rows) {
    const rubricId = rubricMap.get(colInt(row, 0))
    if (!rubricId) { skipped++; continue }
    records.push({
      rubric_id: rubricId,
      book_code: col(row, 1),
      page_number: colInt(row, 2) || null,
    })
  }

  // Delete old then re-insert
  const rubricIds = [...new Set(records.map(r => r.rubric_id))]
  for (const batch of chunk(rubricIds, 200)) {
    await supabase.from('page_refs').delete().in('rubric_id', batch)
  }

  let added = 0
  for (const batch of chunk(records, 200)) {
    const { error } = await supabase.from('page_refs').insert(batch)
    if (error) throw new Error(`page_refs insert failed: ${error.message}`)
    added += batch.length
  }

  return { added, updated: 0, skipped }
}

// ─── 5. Library Index (LibraryIndex.tab — 12 cols) ─────────────────────────
async function importLibraryIndex(buffer: Buffer, sourceId: string) {
  const rows = parseTabBuffer(buffer)
  const rubricMap = await loadRubricExtIdMap(sourceId)

  const records: any[] = []
  let skipped = 0

  for (const row of rows) {
    const rubricId = rubricMap.get(colInt(row, 0))
    if (!rubricId) { skipped++; continue }
    records.push({
      rubric_id: rubricId,
      reference: col(row, 3),
      author: col(row, 4),
      year: col(row, 5),
    })
  }

  const rubricIds = [...new Set(records.map(r => r.rubric_id))]
  for (const batch of chunk(rubricIds, 200)) {
    await supabase.from('library_index').delete().in('rubric_id', batch)
  }

  let added = 0
  for (const batch of chunk(records, 200)) {
    const { error } = await supabase.from('library_index').insert(batch)
    if (error) throw new Error(`library_index insert failed: ${error.message}`)
    added += batch.length
  }

  return { added, updated: 0, skipped }
}

// ─── 6. Rubric-Remedy Links (PapaSub.tab — 2 cols, no grade) ───────────────
// Format: rubric_ext_id \t remedy_rem_code
async function importPapaSub(
  buffer: Buffer,
  sourceId: string,
  onProgress?: (msg: string) => void
) {
  return importRubricRemedyData(buffer, sourceId, false, onProgress)
}

// ─── 7. Rubric-Remedy Links (Remlist.tab — 10 cols, WITH grade) ─────────────
// Format: rubric_ext_id \t remedy_rem_code \t grade \t ...
async function importRemlist(
  buffer: Buffer,
  sourceId: string,
  onProgress?: (msg: string) => void
) {
  return importRubricRemedyData(buffer, sourceId, true, onProgress)
}

// ─── Shared rubric-remedy importer ──────────────────────────────────────────
async function importRubricRemedyData(
  buffer: Buffer,
  sourceId: string,
  hasGrade: boolean,
  onProgress?: (msg: string) => void
) {
  const rows = parseTabBuffer(buffer)

  onProgress?.('Loading ID maps...')

  const rubricMap = await loadRubricExtIdMap(sourceId)

  const { data: remedyRows } = await supabase
    .from('remedies')
    .select('id, rem_code')
    .not('rem_code', 'is', null)

  const remedyMap = new Map<number, string>()
  for (const r of remedyRows || []) {
    if (r.rem_code) remedyMap.set(r.rem_code, r.id)
  }

  onProgress?.(`Processing ${rows.length} rows (rubrics: ${rubricMap.size}, remedies: ${remedyMap.size})...`)

  const records: any[] = []
  let skipped = 0

  for (const row of rows) {
    const rubricExt = colInt(row, 0)
    const remedyCode = colInt(row, 1)
    const grade = hasGrade ? Math.min(4, Math.max(1, colInt(row, 2, 1))) : 1

    const rubricId = rubricMap.get(rubricExt)
    const remedyId = remedyMap.get(remedyCode)

    if (!rubricId || !remedyId) { skipped++; continue }

    records.push({
      rubric_id: rubricId,
      remedy_id: remedyId,
      grade,
      source_id: sourceId,
    })
  }

  onProgress?.(`Upserting ${records.length} relationships...`)

  let inserted = 0
  const batches = chunk(records, 200)
  for (let i = 0; i < batches.length; i++) {
    if (i % 100 === 0 && i > 0) {
      onProgress?.(`Progress: ${inserted}/${records.length} (${Math.round(inserted / records.length * 100)}%)...`)
    }
    const { error } = await supabase
      .from('rubric_remedies')
      .upsert(batches[i], {
        onConflict: 'rubric_id,remedy_id,source_id',
        ignoreDuplicates: false,
      })
    if (error) throw new Error(`rubric_remedies upsert failed at batch ${i}: ${error.message}`)
    inserted += batches[i].length
  }

  onProgress?.(`Done: ${inserted} inserted, ${skipped} skipped`)
  return { added: inserted, updated: 0, skipped }
}

// ─── Helper: load rubric ext_id → DB id map (paginated) ────────────────────
async function loadRubricExtIdMap(sourceId: string): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  let offset = 0
  const PAGE = 1000
  while (true) {
    const { data } = await supabase
      .from('rubrics')
      .select('id, ext_id')
      .eq('source_id', sourceId)
      .not('ext_id', 'is', null)
      .range(offset, offset + PAGE - 1)

    if (!data || data.length === 0) break
    for (const r of data) {
      if (r.ext_id) map.set(r.ext_id, r.id)
    }
    offset += data.length
    if (data.length < PAGE) break
  }
  return map
}

// ─── Main Orchestrator ──────────────────────────────────────────────────────

export async function runImportPipeline(
  files: Map<string, Buffer>,
  sourceId: string,
  jobId: string,
  onProgress?: (step: string, message: string) => void
): Promise<FileSummary[]> {
  const summary: FileSummary[] = []

  const importFns: Record<string, (buf: Buffer, sid: string, onProg?: (msg: string) => void) => Promise<{ added: number; updated: number; skipped: number }>> = {
    'RemID.tab': importRemID,
    'REPolar.tab': importREPolar,
    'Complete.tab': importRubricHierarchy,
    'Pagerefs.tab': importPagerefs,
    'LibraryIndex.tab': importLibraryIndex,
    'PapaSub.tab': importPapaSub,
    'Remlist.tab': importRemlist,
  }

  for (const fileName of IMPORT_ORDER) {
    const buffer = files.get(fileName)
    if (!buffer) {
      summary.push({ file: fileName, status: 'MISSING' })
      continue
    }

    const hash = md5(buffer)

    if (await isAlreadyImported(fileName, hash)) {
      summary.push({ file: fileName, status: 'UNCHANGED', hash })
      onProgress?.(fileName, 'Skipped (unchanged)')
      continue
    }

    const { data: version } = await supabase
      .from('file_versions')
      .insert({ file_name: fileName, md5_hash: hash, source_id: sourceId, status: 'processing' })
      .select()
      .single()

    try {
      onProgress?.(fileName, `Importing ${fileName}...`)

      const importFn = importFns[fileName]
      if (!importFn) {
        summary.push({ file: fileName, status: 'FAILED', error: 'No import handler' })
        continue
      }

      const result = await importFn(buffer, sourceId, (msg) => onProgress?.(fileName, msg))

      if (version) {
        await supabase
          .from('file_versions')
          .update({ status: 'done', rows_added: result.added, rows_updated: result.updated, rows_skipped: result.skipped })
          .eq('id', version.id)
      }

      summary.push({ file: fileName, status: 'SYNCED', hash, added: result.added, updated: result.updated, skipped: result.skipped })
      onProgress?.(fileName, `Done: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped`)
    } catch (err: any) {
      if (version) {
        await supabase
          .from('file_versions')
          .update({ status: 'failed', error_msg: err.message })
          .eq('id', version.id)
      }
      summary.push({ file: fileName, status: 'FAILED', error: err.message })
      onProgress?.(fileName, `FAILED: ${err.message}`)
    }

    await supabase
      .from('upload_jobs')
      .update({
        progress: { current_file: fileName, step: IMPORT_ORDER.indexOf(fileName) + 1, total: IMPORT_ORDER.length, summary },
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  }

  return summary
}

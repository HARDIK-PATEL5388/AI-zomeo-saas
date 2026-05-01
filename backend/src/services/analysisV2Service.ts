// backend/src/services/analysisV2Service.ts
// Repertory Analysis v2 — operates exclusively on `rep_*` integer-keyed tables.
// Linked to legacy `cases` UUID via `case_rep_rubrics` and `case_rep_analyses`.

import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

export type AnalysisMethod = 'kent' | 'weighted'

export interface RubricSearchHit {
  ext_id: number
  rubric_id: number
  book_id: number
  book_code: string
  book_name: string
  rubric_text: string
  full_path: string | null
  chapter: string | null
  depth: number
  remedy_count: number
}

export interface SelectedRubric {
  id: number
  case_id: string
  rubric_ext_id: number
  rubric_id: number
  book_id: number
  book_code: string
  book_name: string
  weight: number
  intensity: 'high' | 'mid' | 'low' | null
  symptom_note: string | null
  sort_order: number
  rubric_text: string
  full_path: string | null
  chapter: string | null
  remedy_count: number
}

export interface RankedRemedy {
  rank: number
  rem_code: number
  abbreviation: string | null
  full_name: string | null
  common_name: string | null
  total_score: number
  match_count: number
  match_percent: number
  grade_breakdown: Record<string, number>
}

export interface RemedyDetail {
  rem_code: number
  abbreviation: string | null
  full_name: string | null
  common_name: string | null
  contributions: Array<{
    rubric_ext_id: number
    rubric_text: string
    full_path: string | null
    chapter: string | null
    weight: number
    grade: number
    contribution: number
  }>
}

// ─── Verification helpers ──────────────────────────────────────────────────

export async function verifyCaseAccess(caseId: string, clinicId: string): Promise<boolean> {
  const r = await pool.query(
    'SELECT 1 FROM cases WHERE id = $1 AND clinic_id = $2',
    [caseId, clinicId]
  )
  return r.rowCount! > 0
}

// ─── Search ────────────────────────────────────────────────────────────────

export async function searchRubrics(
  query: string,
  limit = 25,
  bookCode?: string,
): Promise<RubricSearchHit[]> {
  if (!query || query.trim().length < 2) return []
  const q = `%${query.trim()}%`
  const prefix = `${query.trim()}%`
  const params: any[] = [q, prefix, limit]
  let bookFilter = ''
  if (bookCode) {
    params.push(bookCode)
    bookFilter = `AND b.code = $${params.length}`
  }
  const sql = `
    SELECT
      r.ext_id, r.rubric_id, r.book_id,
      b.code AS book_code, b.name AS book_name,
      r.rubric_text, r.full_path, r.chapter, r.depth,
      (SELECT COUNT(*) FROM rep_rubric_remedies rr
        WHERE rr.book_id = r.book_id AND rr.rubric_ext_id = r.ext_id)::int AS remedy_count
    FROM rep_rubrics r
    JOIN rep_books   b ON b.id = r.book_id AND b.is_active
    WHERE (r.rubric_text ILIKE $1 OR r.full_path ILIKE $1) ${bookFilter}
    ORDER BY
      CASE WHEN r.rubric_text ILIKE $2 THEN 0 ELSE 1 END,
      b.sort_order, r.depth, LENGTH(r.rubric_text)
    LIMIT $3
  `
  const r = await pool.query(sql, params)
  return r.rows
}

export async function searchSymptoms(
  query: string,
  limit = 30,
  bookCode?: string,
): Promise<RubricSearchHit[]> {
  if (!query || query.trim().length < 2) return []
  const params: any[] = [`%${query.trim()}%`, query.trim(), limit]
  let bookFilter = ''
  if (bookCode) {
    params.push(bookCode)
    bookFilter = `AND b.code = $${params.length}`
  }
  const sql = `
    SELECT
      r.ext_id, r.rubric_id, r.book_id,
      b.code AS book_code, b.name AS book_name,
      r.rubric_text, r.full_path, r.chapter, r.depth,
      (SELECT COUNT(*) FROM rep_rubric_remedies rr
        WHERE rr.book_id = r.book_id AND rr.rubric_ext_id = r.ext_id)::int AS remedy_count
    FROM rep_rubrics r
    JOIN rep_books   b ON b.id = r.book_id AND b.is_active
    WHERE (r.rubric_text ILIKE $1 OR r.full_path ILIKE $1 OR r.chapter ILIKE $1) ${bookFilter}
    ORDER BY similarity(r.rubric_text, $2) DESC NULLS LAST, b.sort_order, r.depth
    LIMIT $3
  `
  const r = await pool.query(sql, params)
  return r.rows
}

// ─── Rubric CRUD on a case ─────────────────────────────────────────────────

export async function listCaseRubrics(caseId: string, sort: 'added' | 'weight' | 'chapter' = 'added'): Promise<SelectedRubric[]> {
  const orderBy = sort === 'weight'
    ? 'crr.weight DESC, crr.created_at ASC'
    : sort === 'chapter'
    ? 'b.sort_order ASC, r.chapter ASC NULLS LAST, crr.created_at ASC'
    : 'crr.sort_order ASC, crr.created_at ASC'

  const sql = `
    SELECT
      crr.id,
      crr.case_id,
      crr.rubric_ext_id,
      crr.rubric_id,
      crr.book_id,
      b.code AS book_code,
      b.name AS book_name,
      crr.weight,
      crr.intensity,
      crr.symptom_note,
      crr.sort_order,
      r.rubric_text,
      r.full_path,
      r.chapter,
      (SELECT COUNT(*) FROM rep_rubric_remedies rr
        WHERE rr.book_id = r.book_id AND rr.rubric_ext_id = r.ext_id)::int AS remedy_count
    FROM case_rep_rubrics crr
    JOIN rep_rubrics r ON r.rubric_id = crr.rubric_id
    JOIN rep_books   b ON b.id = r.book_id
    WHERE crr.case_id = $1
    ORDER BY ${orderBy}
  `
  const r = await pool.query(sql, [caseId])
  return r.rows
}

/**
 * Add a rubric to a case. Accepts the surrogate rubric_id — the only
 * identifier that uniquely points to one row regardless of book.
 *
 * The legacy signature (caseId, rubricExtId, opts) still works; in that
 * case the resolver assumes the 'complete' book to preserve old callers.
 */
export async function addCaseRubric(
  caseId: string,
  rubricRef: number | { rubricId: number } | { bookCode: string; rubricExtId: number },
  opts: { weight?: number; intensity?: 'high' | 'mid' | 'low'; symptom_note?: string; added_by?: string }
): Promise<SelectedRubric> {
  const weight = opts.weight ?? 1
  const intensity = opts.intensity ?? 'mid'
  const note = opts.symptom_note ?? null
  const addedBy = opts.added_by ?? null

  // Resolve rubric_id, book_id, ext_id from whatever the caller supplied.
  let resolved: { rubric_id: number; book_id: number; ext_id: number } | null = null
  if (typeof rubricRef === 'number') {
    const r = await pool.query(
      `SELECT rubric_id, book_id, ext_id FROM rep_rubrics
        WHERE ext_id=$1 AND book_id=(SELECT id FROM rep_books WHERE code='complete')`,
      [rubricRef],
    )
    resolved = r.rows[0] ?? null
  } else if ('rubricId' in rubricRef) {
    const r = await pool.query(
      `SELECT rubric_id, book_id, ext_id FROM rep_rubrics WHERE rubric_id=$1`,
      [rubricRef.rubricId],
    )
    resolved = r.rows[0] ?? null
  } else {
    const r = await pool.query(
      `SELECT rubric_id, book_id, ext_id FROM rep_rubrics
        WHERE ext_id=$1 AND book_id=(SELECT id FROM rep_books WHERE code=$2)`,
      [rubricRef.rubricExtId, rubricRef.bookCode],
    )
    resolved = r.rows[0] ?? null
  }
  if (!resolved) throw new Error('Rubric not found')

  await pool.query(
    `INSERT INTO case_rep_rubrics
       (case_id, rubric_ext_id, rubric_id, book_id, weight, intensity, symptom_note, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (case_id, rubric_id)
       DO UPDATE SET weight = EXCLUDED.weight,
                     intensity = EXCLUDED.intensity,
                     symptom_note = EXCLUDED.symptom_note`,
    [caseId, resolved.ext_id, resolved.rubric_id, resolved.book_id, weight, intensity, note, addedBy],
  )
  const list = await listCaseRubrics(caseId)
  const hit = list.find(r => r.rubric_id === resolved!.rubric_id)
  if (!hit) throw new Error('Rubric add failed')
  return hit
}

export async function updateCaseRubric(
  caseId: string,
  rubricRef: { rubricId: number } | { rubricExtId: number; bookCode?: string },
  patch: { weight?: number; intensity?: 'high' | 'mid' | 'low'; sort_order?: number; symptom_note?: string }
): Promise<void> {
  const fields: string[] = []
  const values: any[] = [caseId]
  let i = 2
  if (patch.weight !== undefined)       { fields.push(`weight = $${i++}`); values.push(patch.weight) }
  if (patch.intensity !== undefined)    { fields.push(`intensity = $${i++}`); values.push(patch.intensity) }
  if (patch.sort_order !== undefined)   { fields.push(`sort_order = $${i++}`); values.push(patch.sort_order) }
  if (patch.symptom_note !== undefined) { fields.push(`symptom_note = $${i++}`); values.push(patch.symptom_note) }
  if (fields.length === 0) return

  let where: string
  if ('rubricId' in rubricRef) {
    values.push(rubricRef.rubricId)
    where = `case_id = $1 AND rubric_id = $${i}`
  } else {
    const code = rubricRef.bookCode ?? 'complete'
    values.push(rubricRef.rubricExtId, code)
    where = `case_id = $1 AND rubric_ext_id = $${i++}
             AND book_id = (SELECT id FROM rep_books WHERE code = $${i})`
  }
  await pool.query(`UPDATE case_rep_rubrics SET ${fields.join(', ')} WHERE ${where}`, values)
}

export async function removeCaseRubric(
  caseId: string,
  rubricRef: { rubricId: number } | { rubricExtId: number; bookCode?: string },
): Promise<void> {
  if ('rubricId' in rubricRef) {
    await pool.query(
      'DELETE FROM case_rep_rubrics WHERE case_id = $1 AND rubric_id = $2',
      [caseId, rubricRef.rubricId],
    )
  } else {
    const code = rubricRef.bookCode ?? 'complete'
    await pool.query(
      `DELETE FROM case_rep_rubrics
        WHERE case_id = $1 AND rubric_ext_id = $2
          AND book_id = (SELECT id FROM rep_books WHERE code = $3)`,
      [caseId, rubricRef.rubricExtId, code],
    )
  }
}

export async function clearCaseRubrics(caseId: string): Promise<void> {
  await pool.query('DELETE FROM case_rep_rubrics WHERE case_id = $1', [caseId])
}

// ─── Engine: Kent + Weighted ───────────────────────────────────────────────

export async function runAnalysis(
  caseId: string,
  method: AnalysisMethod,
  opts: { minScore?: number; limit?: number } = {}
): Promise<RankedRemedy[]> {
  const minScore = opts.minScore ?? 0
  const limit = opts.limit ?? 50

  const rubrics = await listCaseRubrics(caseId)
  if (rubrics.length === 0) return []

  // pg returns BIGINT as string — coerce to Number so map keys match the
  // Number(...) we use on the DB-row side. Otherwise every lookup misses
  // and weights silently fall back to 1.
  const rubricIds = rubrics.map(r => Number(r.rubric_id))
  const weightMap = new Map<number, number>(rubrics.map(r => [Number(r.rubric_id), r.weight]))
  const totalRubrics = rubrics.length

  // Join rep_rubric_remedies through rep_rubrics so we resolve by rubric_id
  // and stay correct even when the same ext_id exists in multiple books.
  const sql = `
    SELECT r.rubric_id, rr.rem_code, rr.grade
    FROM rep_rubrics r
    JOIN rep_rubric_remedies rr
      ON rr.book_id = r.book_id AND rr.rubric_ext_id = r.ext_id
    WHERE r.rubric_id = ANY($1::bigint[])
  `
  const { rows } = await pool.query(sql, [rubricIds])

  type Agg = { score: number; count: number; grades: Record<string, number> }
  const agg = new Map<number, Agg>()

  for (const row of rows) {
    const grade: number = row.grade
    const w = weightMap.get(Number(row.rubric_id)) ?? 1
    const contribution = method === 'weighted' ? w * grade : grade

    let a = agg.get(row.rem_code)
    if (!a) {
      a = { score: 0, count: 0, grades: {} }
      agg.set(row.rem_code, a)
    }
    a.score += contribution
    a.count += 1
    const k = `grade_${grade}`
    a.grades[k] = (a.grades[k] ?? 0) + 1
  }

  const remCodes = Array.from(agg.keys())
  if (remCodes.length === 0) return []

  const remRows = await pool.query(
    `SELECT rem_code, abbreviation, full_name, common_name
     FROM rep_remedies
     WHERE rem_code = ANY($1::int[])`,
    [remCodes]
  )
  const remMap = new Map<number, any>(remRows.rows.map(r => [r.rem_code, r]))

  const ranked: RankedRemedy[] = remCodes
    .map(rc => {
      const a = agg.get(rc)!
      const r = remMap.get(rc)
      return {
        rank: 0,
        rem_code: rc,
        abbreviation: r?.abbreviation ?? null,
        full_name: r?.full_name ?? null,
        common_name: r?.common_name ?? null,
        total_score: a.score,
        match_count: a.count,
        match_percent: totalRubrics > 0 ? Math.round((a.count / totalRubrics) * 1000) / 10 : 0,
        grade_breakdown: a.grades,
      }
    })
    .filter(r => r.total_score >= minScore)
    .sort((a, b) => {
      if (b.total_score !== a.total_score) return b.total_score - a.total_score
      return b.match_count - a.match_count
    })
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }))

  return ranked
}

// ─── Remedy detail (per-case contribution breakdown) ───────────────────────

export async function getRemedyDetail(
  caseId: string,
  remCode: number,
  method: AnalysisMethod
): Promise<RemedyDetail | null> {
  const remRow = await pool.query(
    `SELECT rem_code, abbreviation, full_name, common_name
     FROM rep_remedies WHERE rem_code = $1`,
    [remCode]
  )
  if (remRow.rowCount === 0) return null
  const remedy = remRow.rows[0]

  const rubrics = await listCaseRubrics(caseId)
  if (rubrics.length === 0) {
    return { ...remedy, contributions: [] }
  }
  // pg returns BIGINT as string — coerce both sides to Number so the map
  // lookups don't silently miss and leave rubric_text undefined.
  const rubricIds = rubrics.map(r => Number(r.rubric_id))
  const weightMap = new Map<number, number>(rubrics.map(r => [Number(r.rubric_id), r.weight]))
  const rubricMap = new Map<number, typeof rubrics[number]>(rubrics.map(r => [Number(r.rubric_id), r]))

  const sql = `
    SELECT r.rubric_id, r.ext_id AS rubric_ext_id, rr.grade
    FROM rep_rubrics r
    JOIN rep_rubric_remedies rr
      ON rr.book_id = r.book_id AND rr.rubric_ext_id = r.ext_id
    WHERE rr.rem_code = $1 AND r.rubric_id = ANY($2::bigint[])
  `
  const { rows } = await pool.query(sql, [remCode, rubricIds])

  const contributions = rows.map(row => {
    const rid = Number(row.rubric_id)
    const w = weightMap.get(rid) ?? 1
    const r = rubricMap.get(rid)!
    const contribution = method === 'weighted' ? w * row.grade : row.grade
    return {
      rubric_ext_id: row.rubric_ext_id,
      rubric_text: r.rubric_text,
      full_path: r.full_path,
      chapter: r.chapter,
      weight: w,
      grade: row.grade,
      contribution,
    }
  }).sort((a, b) => b.contribution - a.contribution)

  return { ...remedy, contributions }
}

// ─── Save / list analyses ──────────────────────────────────────────────────

export async function saveAnalysis(
  caseId: string,
  userId: string | null,
  method: AnalysisMethod,
  results: RankedRemedy[],
  rubricCount: number,
  notes?: string
): Promise<{ id: string; created_at: string }> {
  const r = await pool.query(
    `INSERT INTO case_rep_analyses (case_id, method, rubric_count, results, notes, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING id, created_at`,
    [caseId, method, rubricCount, JSON.stringify(results), notes ?? null, userId]
  )
  return r.rows[0]
}

export async function listAnalyses(caseId: string, limit = 20) {
  const r = await pool.query(
    `SELECT id, method, rubric_count, notes, created_at, created_by
     FROM case_rep_analyses
     WHERE case_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [caseId, limit]
  )
  return r.rows
}

export async function getAnalysis(id: string, caseId: string) {
  const r = await pool.query(
    `SELECT id, case_id, method, rubric_count, results, notes, created_at, created_by
     FROM case_rep_analyses
     WHERE id = $1 AND case_id = $2`,
    [id, caseId]
  )
  return r.rows[0] ?? null
}

export { pool as analysisV2Pool }

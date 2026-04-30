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

export async function searchRubrics(query: string, limit = 25): Promise<RubricSearchHit[]> {
  if (!query || query.trim().length < 2) return []
  const q = `%${query.trim()}%`
  const sql = `
    SELECT
      r.ext_id,
      r.rubric_text,
      r.full_path,
      r.chapter,
      r.depth,
      COALESCE(rc.cnt, 0)::int AS remedy_count
    FROM rep_rubrics r
    LEFT JOIN (
      SELECT rubric_ext_id, COUNT(*) AS cnt
      FROM rep_remlist
      GROUP BY rubric_ext_id
    ) rc ON rc.rubric_ext_id = r.ext_id
    WHERE r.rubric_text ILIKE $1 OR r.full_path ILIKE $1
    ORDER BY
      CASE WHEN r.rubric_text ILIKE $2 THEN 0 ELSE 1 END,
      r.depth,
      LENGTH(r.rubric_text)
    LIMIT $3
  `
  const prefix = `${query.trim()}%`
  const r = await pool.query(sql, [q, prefix, limit])
  return r.rows
}

export async function searchSymptoms(query: string, limit = 30): Promise<RubricSearchHit[]> {
  // Broader fuzzy match — uses pg_trgm similarity if available.
  if (!query || query.trim().length < 2) return []
  const sql = `
    SELECT
      r.ext_id,
      r.rubric_text,
      r.full_path,
      r.chapter,
      r.depth,
      COALESCE(rc.cnt, 0)::int AS remedy_count
    FROM rep_rubrics r
    LEFT JOIN (
      SELECT rubric_ext_id, COUNT(*) AS cnt
      FROM rep_remlist
      GROUP BY rubric_ext_id
    ) rc ON rc.rubric_ext_id = r.ext_id
    WHERE r.rubric_text ILIKE $1
       OR r.full_path  ILIKE $1
       OR r.chapter    ILIKE $1
    ORDER BY similarity(r.rubric_text, $2) DESC NULLS LAST, r.depth
    LIMIT $3
  `
  const r = await pool.query(sql, [`%${query.trim()}%`, query.trim(), limit])
  return r.rows
}

// ─── Rubric CRUD on a case ─────────────────────────────────────────────────

export async function listCaseRubrics(caseId: string, sort: 'added' | 'weight' | 'chapter' = 'added'): Promise<SelectedRubric[]> {
  const orderBy = sort === 'weight'
    ? 'crr.weight DESC, crr.created_at ASC'
    : sort === 'chapter'
    ? 'r.chapter ASC NULLS LAST, crr.created_at ASC'
    : 'crr.sort_order ASC, crr.created_at ASC'

  const sql = `
    SELECT
      crr.id,
      crr.case_id,
      crr.rubric_ext_id,
      crr.weight,
      crr.intensity,
      crr.symptom_note,
      crr.sort_order,
      r.rubric_text,
      r.full_path,
      r.chapter,
      COALESCE(rc.cnt, 0)::int AS remedy_count
    FROM case_rep_rubrics crr
    JOIN rep_rubrics r ON r.ext_id = crr.rubric_ext_id
    LEFT JOIN (
      SELECT rubric_ext_id, COUNT(*) AS cnt
      FROM rep_remlist
      GROUP BY rubric_ext_id
    ) rc ON rc.rubric_ext_id = crr.rubric_ext_id
    WHERE crr.case_id = $1
    ORDER BY ${orderBy}
  `
  const r = await pool.query(sql, [caseId])
  return r.rows
}

export async function addCaseRubric(
  caseId: string,
  rubricExtId: number,
  opts: { weight?: number; intensity?: 'high' | 'mid' | 'low'; symptom_note?: string; added_by?: string }
): Promise<SelectedRubric> {
  const weight = opts.weight ?? 1
  const intensity = opts.intensity ?? 'mid'
  const note = opts.symptom_note ?? null
  const addedBy = opts.added_by ?? null

  const upsert = `
    INSERT INTO case_rep_rubrics (case_id, rubric_ext_id, weight, intensity, symptom_note, added_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (case_id, rubric_ext_id)
      DO UPDATE SET weight = EXCLUDED.weight,
                    intensity = EXCLUDED.intensity,
                    symptom_note = EXCLUDED.symptom_note
    RETURNING id
  `
  await pool.query(upsert, [caseId, rubricExtId, weight, intensity, note, addedBy])
  const list = await listCaseRubrics(caseId)
  const hit = list.find(r => r.rubric_ext_id === rubricExtId)
  if (!hit) throw new Error('Rubric add failed')
  return hit
}

export async function updateCaseRubric(
  caseId: string,
  rubricExtId: number,
  patch: { weight?: number; intensity?: 'high' | 'mid' | 'low'; sort_order?: number; symptom_note?: string }
): Promise<void> {
  const fields: string[] = []
  const values: any[] = [caseId, rubricExtId]
  let i = 3
  if (patch.weight !== undefined)       { fields.push(`weight = $${i++}`); values.push(patch.weight) }
  if (patch.intensity !== undefined)    { fields.push(`intensity = $${i++}`); values.push(patch.intensity) }
  if (patch.sort_order !== undefined)   { fields.push(`sort_order = $${i++}`); values.push(patch.sort_order) }
  if (patch.symptom_note !== undefined) { fields.push(`symptom_note = $${i++}`); values.push(patch.symptom_note) }
  if (fields.length === 0) return

  await pool.query(
    `UPDATE case_rep_rubrics SET ${fields.join(', ')} WHERE case_id = $1 AND rubric_ext_id = $2`,
    values
  )
}

export async function removeCaseRubric(caseId: string, rubricExtId: number): Promise<void> {
  await pool.query(
    'DELETE FROM case_rep_rubrics WHERE case_id = $1 AND rubric_ext_id = $2',
    [caseId, rubricExtId]
  )
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

  const extIds = rubrics.map(r => r.rubric_ext_id)
  const weightMap = new Map<number, number>(rubrics.map(r => [r.rubric_ext_id, r.weight]))
  const totalRubrics = rubrics.length

  const sql = `
    SELECT rl.rubric_ext_id, rl.rem_code, rl.grade
    FROM rep_remlist rl
    WHERE rl.rubric_ext_id = ANY($1::int[])
  `
  const { rows } = await pool.query(sql, [extIds])

  type Agg = { score: number; count: number; grades: Record<string, number> }
  const agg = new Map<number, Agg>()

  for (const row of rows) {
    const grade: number = row.grade
    const w = weightMap.get(row.rubric_ext_id) ?? 1
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
  const extIds = rubrics.map(r => r.rubric_ext_id)
  const weightMap = new Map(rubrics.map(r => [r.rubric_ext_id, r.weight]))
  const rubricMap = new Map(rubrics.map(r => [r.rubric_ext_id, r]))

  const sql = `
    SELECT rl.rubric_ext_id, rl.grade
    FROM rep_remlist rl
    WHERE rl.rem_code = $1 AND rl.rubric_ext_id = ANY($2::int[])
  `
  const { rows } = await pool.query(sql, [remCode, extIds])

  const contributions = rows.map(row => {
    const w = weightMap.get(row.rubric_ext_id) ?? 1
    const r = rubricMap.get(row.rubric_ext_id)!
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

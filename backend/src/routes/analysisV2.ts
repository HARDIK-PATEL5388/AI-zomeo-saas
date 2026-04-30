// backend/src/routes/analysisV2.ts
// Repertory Analysis v2 — uses rep_* tables only.
// Mounted at /api/analysis/v2 BEHIND authMiddleware.
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  searchRubrics,
  searchSymptoms,
  listCaseRubrics,
  addCaseRubric,
  updateCaseRubric,
  removeCaseRubric,
  clearCaseRubrics,
  runAnalysis,
  getRemedyDetail,
  saveAnalysis,
  listAnalyses,
  getAnalysis,
  verifyCaseAccess,
} from '../services/analysisV2Service'

const app = new Hono()

// Helper: 404 if case doesn't exist or not in user's clinic
async function ensureCase(c: any, caseId: string) {
  const user = c.get('user')
  const ok = await verifyCaseAccess(caseId, user.clinicId)
  if (!ok) return c.json({ error: 'Case not found' }, 404)
  return null
}

// ─── Search ────────────────────────────────────────────────────────────────

app.get('/search/rubrics', async (c) => {
  const q = c.req.query('q') ?? ''
  const book = c.req.query('book') || undefined
  const limit = Math.min(parseInt(c.req.query('limit') ?? '25'), 100)
  const data = await searchRubrics(q, limit, book)
  return c.json({ data })
})

app.get('/search/symptoms', async (c) => {
  const q = c.req.query('q') ?? ''
  const book = c.req.query('book') || undefined
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30'), 100)
  const data = await searchSymptoms(q, limit, book)
  return c.json({ data })
})

// ─── Selected rubrics (per case) ───────────────────────────────────────────

app.get('/cases/:caseId/rubrics', async (c) => {
  const { caseId } = c.req.param()
  const guard = await ensureCase(c, caseId); if (guard) return guard
  const sort = (c.req.query('sort') as 'added' | 'weight' | 'chapter' | undefined) ?? 'added'
  const data = await listCaseRubrics(caseId, sort)
  return c.json({ data })
})

app.post(
  '/cases/:caseId/rubrics',
  zValidator('json', z.object({
    // New (preferred) — surrogate id uniquely identifies a (book, ext_id) pair.
    rubric_id: z.number().int().optional(),
    // Legacy — defaults to 'complete' book unless book_code is supplied.
    rubric_ext_id: z.number().int().optional(),
    book_code: z.string().optional(),
    weight: z.number().int().min(1).max(4).optional(),
    intensity: z.enum(['high', 'mid', 'low']).optional(),
    symptom_note: z.string().optional(),
  })),
  async (c) => {
    const { caseId } = c.req.param()
    const guard = await ensureCase(c, caseId); if (guard) return guard
    const body = c.req.valid('json')
    const user = c.get('user')

    const ref = body.rubric_id != null
      ? { rubricId: body.rubric_id }
      : body.book_code && body.rubric_ext_id != null
        ? { bookCode: body.book_code, rubricExtId: body.rubric_ext_id }
        : body.rubric_ext_id != null
          ? body.rubric_ext_id
          : null
    if (ref == null) return c.json({ error: 'rubric_id or rubric_ext_id required' }, 400)

    const data = await addCaseRubric(caseId, ref as any, {
      weight: body.weight,
      intensity: body.intensity,
      symptom_note: body.symptom_note,
      added_by: user.userId,
    })
    return c.json({ data }, 201)
  }
)

app.patch(
  '/cases/:caseId/rubrics/:extId',
  zValidator('json', z.object({
    weight: z.number().int().min(1).max(4).optional(),
    intensity: z.enum(['high', 'mid', 'low']).optional(),
    sort_order: z.number().int().optional(),
    symptom_note: z.string().optional(),
  })),
  async (c) => {
    const { caseId, extId } = c.req.param()
    const guard = await ensureCase(c, caseId); if (guard) return guard
    const bookCode = c.req.query('book') || undefined
    await updateCaseRubric(
      caseId,
      { rubricExtId: parseInt(extId), bookCode },
      c.req.valid('json'),
    )
    return c.json({ ok: true })
  }
)

app.delete('/cases/:caseId/rubrics/:extId', async (c) => {
  const { caseId, extId } = c.req.param()
  const guard = await ensureCase(c, caseId); if (guard) return guard
  const bookCode = c.req.query('book') || undefined
  await removeCaseRubric(caseId, { rubricExtId: parseInt(extId), bookCode })
  return c.json({ ok: true })
})

app.delete('/cases/:caseId/rubrics', async (c) => {
  const { caseId } = c.req.param()
  const guard = await ensureCase(c, caseId); if (guard) return guard
  await clearCaseRubrics(caseId)
  return c.json({ ok: true })
})

// ─── Run analysis ──────────────────────────────────────────────────────────

app.post(
  '/cases/:caseId/run',
  zValidator('json', z.object({
    method: z.enum(['kent', 'weighted']).default('weighted'),
    minScore: z.number().optional(),
    limit: z.number().int().optional(),
  })),
  async (c) => {
    const { caseId } = c.req.param()
    const guard = await ensureCase(c, caseId); if (guard) return guard
    const { method, minScore, limit } = c.req.valid('json')
    const data = await runAnalysis(caseId, method, { minScore, limit })
    return c.json({
      data,
      meta: {
        method,
        total: data.length,
        case_id: caseId,
        analyzed_at: new Date().toISOString(),
      },
    })
  }
)

// ─── Remedy detail ─────────────────────────────────────────────────────────

app.get('/cases/:caseId/remedy/:remCode', async (c) => {
  const { caseId, remCode } = c.req.param()
  const guard = await ensureCase(c, caseId); if (guard) return guard
  const method = (c.req.query('method') as 'kent' | 'weighted') ?? 'weighted'
  const data = await getRemedyDetail(caseId, parseInt(remCode), method)
  if (!data) return c.json({ error: 'Remedy not found' }, 404)
  return c.json({ data })
})

// ─── Save / list / get analyses ────────────────────────────────────────────

app.post(
  '/cases/:caseId/save',
  zValidator('json', z.object({
    method: z.enum(['kent', 'weighted']),
    results: z.array(z.any()),
    rubric_count: z.number().int(),
    notes: z.string().optional(),
  })),
  async (c) => {
    const { caseId } = c.req.param()
    const guard = await ensureCase(c, caseId); if (guard) return guard
    const body = c.req.valid('json')
    const user = c.get('user')
    const saved = await saveAnalysis(
      caseId,
      user.userId,
      body.method,
      body.results,
      body.rubric_count,
      body.notes
    )
    return c.json({ data: saved }, 201)
  }
)

app.get('/cases/:caseId/analyses', async (c) => {
  const { caseId } = c.req.param()
  const guard = await ensureCase(c, caseId); if (guard) return guard
  const data = await listAnalyses(caseId, 50)
  return c.json({ data })
})

app.get('/cases/:caseId/analyses/:id', async (c) => {
  const { caseId, id } = c.req.param()
  const guard = await ensureCase(c, caseId); if (guard) return guard
  const row = await getAnalysis(id, caseId)
  if (!row) return c.json({ error: 'Analysis not found' }, 404)
  return c.json({ data: row })
})

// ─── Export PDF (printable HTML) ───────────────────────────────────────────

app.get('/cases/:caseId/export-pdf', async (c) => {
  const { caseId } = c.req.param()
  const guard = await ensureCase(c, caseId); if (guard) return guard

  const method = (c.req.query('method') as 'kent' | 'weighted') ?? 'weighted'
  const analysisId = c.req.query('analysisId')

  let results: any[]
  let rubricCount: number
  let snapshotMethod: 'kent' | 'weighted' = method

  if (analysisId) {
    const row = await getAnalysis(analysisId, caseId)
    if (!row) return c.json({ error: 'Analysis not found' }, 404)
    results = row.results as any[]
    rubricCount = row.rubric_count
    snapshotMethod = row.method
  } else {
    results = await runAnalysis(caseId, method, { limit: 30 })
    const rubrics = await listCaseRubrics(caseId)
    rubricCount = rubrics.length
  }

  const rubrics = await listCaseRubrics(caseId)

  const html = renderPrintableHtml({
    caseId,
    method: snapshotMethod,
    rubrics,
    results,
    rubricCount,
  })

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
})

function escape(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderPrintableHtml(input: {
  caseId: string
  method: 'kent' | 'weighted'
  rubrics: any[]
  results: any[]
  rubricCount: number
}): string {
  const { caseId, method, rubrics, results } = input
  const rubricRows = rubrics.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escape(r.chapter ?? '')}</td>
      <td>${escape(r.full_path ?? r.rubric_text)}</td>
      <td style="text-align:center;">${r.weight}</td>
      <td style="text-align:center;">${escape(r.intensity ?? '')}</td>
    </tr>`).join('')

  const resultRows = results.map((r: any) => `
    <tr>
      <td style="text-align:center;">${r.rank}</td>
      <td>${escape(r.full_name ?? r.abbreviation ?? r.rem_code)}</td>
      <td style="text-align:center;">${escape(r.abbreviation ?? '')}</td>
      <td style="text-align:right;">${r.total_score}</td>
      <td style="text-align:right;">${r.match_count}</td>
      <td style="text-align:right;">${r.match_percent}%</td>
    </tr>`).join('')

  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>Repertory Analysis — Case ${caseId}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 32px; color:#222; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 8px; color:#444; border-bottom:1px solid #ddd; padding-bottom:4px; }
  .meta { font-size: 12px; color:#666; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; }
  th { background:#f9fafb; text-align:left; }
  .actions { margin-top: 24px; }
  @media print { .actions { display:none; } body { margin: 16mm; } }
</style>
</head><body>
<h1>Repertory Analysis</h1>
<div class="meta">
  Case: ${escape(caseId)} &middot; Method: <strong>${method.toUpperCase()}</strong>
  &middot; Generated: ${new Date().toLocaleString()}
</div>

<h2>Selected Rubrics (${rubrics.length})</h2>
<table>
  <thead><tr><th>#</th><th>Chapter</th><th>Rubric</th><th>Weight</th><th>Intensity</th></tr></thead>
  <tbody>${rubricRows || '<tr><td colspan="5" style="text-align:center;color:#999;">No rubrics</td></tr>'}</tbody>
</table>

<h2>Repertorization Results (${results.length})</h2>
<table>
  <thead><tr><th>Rank</th><th>Remedy</th><th>Abbr</th><th>Total Score</th><th>Matches</th><th>Match %</th></tr></thead>
  <tbody>${resultRows || '<tr><td colspan="6" style="text-align:center;color:#999;">No results</td></tr>'}</tbody>
</table>

<div class="actions">
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<script>setTimeout(function(){ window.print(); }, 400);</script>
</body></html>`
}

export { app as analysisV2Routes }

'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Plus, Trash2, Sparkles, Play, X, Save, FileText,
  RotateCcw, FilePlus2, ChevronRight, Pill, BookOpen,
} from 'lucide-react'
import { api } from '@/lib/api'

type Method = 'kent' | 'weighted'
type Intensity = 'high' | 'mid' | 'low'
type Tab = 'rubric' | 'symptom'

interface RubricHit {
  ext_id: number
  rubric_text: string
  full_path: string | null
  chapter: string | null
  depth: number
  remedy_count: number
}
interface SelectedRubric {
  id: number
  rubric_ext_id: number
  weight: number
  intensity: Intensity | null
  symptom_note: string | null
  sort_order: number
  rubric_text: string
  full_path: string | null
  chapter: string | null
  remedy_count: number
}
interface RankedRemedy {
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
interface RemedyDetail {
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

const INTENSITY_LABEL: Record<Intensity, string> = { high: 'High', mid: 'Mid', low: 'Low' }
const INTENSITY_BADGE: Record<Intensity, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  mid:  'bg-amber-100 text-amber-700 border-amber-200',
  low:  'bg-slate-100 text-slate-600 border-slate-200',
}
const INTENSITY_TO_WEIGHT: Record<Intensity, number> = { high: 3, mid: 2, low: 1 }

export default function AnalysisPage({ searchParams }: { searchParams: { caseId?: string } }) {
  const caseId = searchParams.caseId
  const queryClient = useQueryClient()

  // ─── State ──────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('rubric')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [aiSuggestions, setAiSuggestions] = useState<RubricHit[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const [customIntensity, setCustomIntensity] = useState<Intensity>('mid')
  const [method, setMethod] = useState<Method>('weighted')
  const [sortRubricsBy, setSortRubricsBy] = useState<'added' | 'weight' | 'chapter'>('added')
  const [results, setResults] = useState<RankedRemedy[]>([])
  const [hasRun, setHasRun] = useState(false)
  const [selectedRemCode, setSelectedRemCode] = useState<number | null>(null)
  const [resultSort, setResultSort] = useState<'score' | 'match'>('score')
  const [minScore, setMinScore] = useState<number>(0)
  const [opError, setOpError] = useState<string | null>(null)

  // Debounce the search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  // ─── Queries ────────────────────────────────────────────────────────
  const searchEndpoint = tab === 'symptom' ? 'symptoms' : 'rubrics'
  const { data: hitsResp } = useQuery({
    queryKey: ['v2-search', tab, debounced],
    queryFn: () => api.get<{ data: RubricHit[] }>(
      `/analysis/v2/search/${searchEndpoint}?q=${encodeURIComponent(debounced)}&limit=25`
    ),
    enabled: debounced.length >= 2,
  })

  const { data: rubricsResp } = useQuery({
    queryKey: ['v2-case-rubrics', caseId, sortRubricsBy],
    queryFn: () => api.get<{ data: SelectedRubric[] }>(
      `/analysis/v2/cases/${caseId}/rubrics?sort=${sortRubricsBy}`
    ),
    enabled: !!caseId,
  })
  const selected = rubricsResp?.data ?? []
  const selectedExtIds = useMemo(() => new Set(selected.map(r => r.rubric_ext_id)), [selected])

  const { data: remedyDetailResp } = useQuery({
    queryKey: ['v2-remedy-detail', caseId, selectedRemCode, method],
    queryFn: () => api.get<{ data: RemedyDetail }>(
      `/analysis/v2/cases/${caseId}/remedy/${selectedRemCode}?method=${method}`
    ),
    enabled: !!caseId && selectedRemCode != null,
  })
  const detail = remedyDetailResp?.data

  // ─── Mutations ──────────────────────────────────────────────────────
  const addRubric = useMutation({
    mutationFn: (vars: { rubric_ext_id: number; weight: number; intensity: Intensity; symptom_note?: string }) =>
      api.post(`/analysis/v2/cases/${caseId}/rubrics`, vars),
    onMutate: () => setOpError(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['v2-case-rubrics', caseId] }),
    onError: (err: Error) => {
      console.error('[analysis] addRubric failed:', err)
      setOpError(`Could not add rubric: ${err.message}`)
    },
  })

  const updateRubric = useMutation({
    mutationFn: (vars: { ext_id: number; patch: Partial<{ weight: number; intensity: Intensity; sort_order: number }> }) =>
      api.patch(`/analysis/v2/cases/${caseId}/rubrics/${vars.ext_id}`, vars.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['v2-case-rubrics', caseId] }),
    onError: (err: Error) => { console.error('[analysis] updateRubric failed:', err); setOpError(err.message) },
  })

  const removeRubric = useMutation({
    mutationFn: (ext_id: number) => api.delete(`/analysis/v2/cases/${caseId}/rubrics/${ext_id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['v2-case-rubrics', caseId] }),
    onError: (err: Error) => { console.error('[analysis] removeRubric failed:', err); setOpError(err.message) },
  })

  const clearAll = useMutation({
    mutationFn: () => api.delete(`/analysis/v2/cases/${caseId}/rubrics`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['v2-case-rubrics', caseId] })
      setResults([]); setHasRun(false); setSelectedRemCode(null)
    },
  })

  const runMutation = useMutation({
    mutationFn: () => api.post<{ data: RankedRemedy[] }>(
      `/analysis/v2/cases/${caseId}/run`,
      { method, minScore, limit: 50 }
    ),
    onSuccess: (res) => { setResults(res.data); setHasRun(true); setSelectedRemCode(res.data[0]?.rem_code ?? null) },
  })

  const saveCase = useMutation({
    mutationFn: () => api.post(`/analysis/v2/cases/${caseId}/save`, {
      method, results, rubric_count: selected.length,
    }),
  })

  // ─── AI ─────────────────────────────────────────────────────────────
  const runAiSuggest = useCallback(async () => {
    if (!search.trim()) return
    setAiBusy(true)
    try {
      const r = await api.post<{ data: any[] }>('/ai/search', { query: search, limit: 15 })
      // AI returns rubric_id (UUID) for legacy tables; for v2 we re-search ourselves on the text
      const fallback = await api.get<{ data: RubricHit[] }>(
        `/analysis/v2/search/symptoms?q=${encodeURIComponent(search)}&limit=15`
      ).catch(() => ({ data: [] as RubricHit[] }))
      setAiSuggestions(fallback.data)
    } finally { setAiBusy(false) }
  }, [search])

  // ─── Derived: sorted results ────────────────────────────────────────
  const visibleResults = useMemo(() => {
    const arr = [...results]
    if (resultSort === 'match') arr.sort((a, b) => b.match_count - a.match_count)
    else arr.sort((a, b) => b.total_score - a.total_score)
    return arr.map((r, i) => ({ ...r, rank: i + 1 }))
  }, [results, resultSort])

  // ─── Handlers ───────────────────────────────────────────────────────
  const handleAddRubric = (hit: RubricHit, intensity: Intensity = 'mid') => {
    addRubric.mutate({
      rubric_ext_id: hit.ext_id,
      weight: INTENSITY_TO_WEIGHT[intensity],
      intensity,
    })
  }

  const handleAddCustom = () => {
    if (!customText.trim()) return
    // Custom symptoms still need a rubric anchor — search for nearest
    api.get<{ data: RubricHit[] }>(`/analysis/v2/search/symptoms?q=${encodeURIComponent(customText)}&limit=1`)
      .then((r) => {
        if (r.data[0]) {
          addRubric.mutate({
            rubric_ext_id: r.data[0].ext_id,
            weight: INTENSITY_TO_WEIGHT[customIntensity],
            intensity: customIntensity,
            symptom_note: customText,
          })
        }
        setCustomText(''); setCustomOpen(false)
      })
  }

  const handleExportPdf = () => {
    const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/analysis/v2/cases/${caseId}/export-pdf?method=${method}`
    const token = typeof window !== 'undefined' ? localStorage.getItem('zomeo_access_token') : null
    // Open in new tab; pass token via fetch then write to a window.
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.text())
      .then(html => {
        const w = window.open('', '_blank')
        if (w) { w.document.open(); w.document.write(html); w.document.close() }
      })
  }

  // ─── No case selected ───────────────────────────────────────────────
  if (!caseId) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <FilePlus2 className="w-12 h-12 mx-auto text-slate-300 mb-3" />
          <p className="text-slate-600 font-medium">No case selected</p>
          <p className="text-sm text-slate-400 mt-1">Open a case from the Patients page to start a repertory analysis.</p>
        </div>
      </div>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Top bar */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-semibold text-slate-900">Repertory Analysis</h1>
          <span className="text-xs text-slate-400">Case {caseId.slice(0, 8)}…</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Method</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
            className="px-2.5 py-1.5 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="weighted">Basic Weighted</option>
            <option value="kent">Kent</option>
          </select>
          <button
            onClick={() => runMutation.mutate()}
            disabled={!selected.length || runMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4" />
            {runMutation.isPending ? 'Analyzing…' : 'Run Repertorization'}
          </button>
        </div>
      </div>

      {/* Three-column body */}
      <div className="flex-1 grid grid-cols-12 overflow-hidden">
        {/* ─── LEFT: Add Symptoms / Rubrics ─────────────────────────────── */}
        <aside className="col-span-3 border-r bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold text-slate-900">Add Symptoms / Rubrics</h2>
          </div>
          <div className="px-4 pt-3">
            <div className="inline-flex rounded-md bg-slate-100 p-0.5 text-xs font-medium">
              <button
                onClick={() => setTab('rubric')}
                className={`px-3 py-1 rounded ${tab === 'rubric' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              >Rubric Search</button>
              <button
                onClick={() => setTab('symptom')}
                className={`px-3 py-1 rounded ${tab === 'symptom' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              >Symptom Search</button>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tab === 'rubric' ? 'Search rubrics…' : 'Search symptoms…'}
                className="w-full pl-8 pr-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={runAiSuggest}
                disabled={aiBusy || search.trim().length < 2}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50 text-xs font-medium"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {aiBusy ? '…' : 'AI Suggest'}
              </button>
              <button
                onClick={() => setCustomOpen(o => !o)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 border rounded-md hover:bg-slate-50 text-xs font-medium text-slate-700"
              >
                <Plus className="w-3.5 h-3.5" />
                Custom
              </button>
            </div>
            {customOpen && (
              <div className="mt-3 p-3 border rounded-md bg-slate-50 space-y-2">
                <input
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="Custom symptom text…"
                  className="w-full px-2 py-1.5 text-sm border rounded bg-white"
                />
                <div className="flex items-center gap-2">
                  <select
                    value={customIntensity}
                    onChange={(e) => setCustomIntensity(e.target.value as Intensity)}
                    className="text-xs border rounded px-2 py-1 bg-white"
                  >
                    <option value="high">High</option>
                    <option value="mid">Mid</option>
                    <option value="low">Low</option>
                  </select>
                  <button
                    onClick={handleAddCustom}
                    className="ml-auto px-3 py-1 bg-emerald-600 text-white rounded text-xs font-medium"
                  >Add</button>
                </div>
                <p className="text-[11px] text-slate-500">Anchored to the closest matching rubric.</p>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {aiSuggestions.length > 0 && (
              <div className="mb-2">
                <div className="px-1.5 text-[11px] font-semibold text-violet-700 uppercase tracking-wide flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> AI Suggestions
                </div>
                {aiSuggestions.map(h => (
                  <RubricRow key={`ai-${h.ext_id}`} hit={h} added={selectedExtIds.has(h.ext_id)} onAdd={(intensity) => handleAddRubric(h, intensity)} />
                ))}
                <div className="border-t my-2" />
              </div>
            )}
            {(hitsResp?.data ?? []).map(h => (
              <RubricRow key={h.ext_id} hit={h} added={selectedExtIds.has(h.ext_id)} onAdd={(intensity) => handleAddRubric(h, intensity)} />
            ))}
            {debounced.length >= 2 && !hitsResp?.data?.length && (
              <p className="text-center text-xs text-slate-400 py-6">No matches</p>
            )}
            {debounced.length < 2 && !aiSuggestions.length && (
              <p className="text-center text-xs text-slate-400 py-6">Type at least 2 characters</p>
            )}
          </div>
        </aside>

        {/* ─── MIDDLE: Selected + Reactions ──────────────────────────────── */}
        <section className="col-span-5 border-r bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Selected Rubrics <span className="text-slate-400 font-normal">({selected.length})</span>
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={sortRubricsBy}
                onChange={(e) => setSortRubricsBy(e.target.value as any)}
                className="text-xs border rounded px-2 py-1 bg-white"
              >
                <option value="added">Sort: Added</option>
                <option value="weight">Sort: Weight</option>
                <option value="chapter">Sort: Chapter</option>
              </select>
              {selected.length > 0 && (
                <button
                  onClick={() => clearAll.mutate()}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                >Clear all</button>
              )}
            </div>
          </div>

          <div className="overflow-y-auto max-h-[40%] border-b">
            {selected.length === 0 ? (
              <div className="text-center py-10 text-sm text-slate-400">
                <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                Search and add rubrics from the left panel
              </div>
            ) : selected.map(r => (
              <div key={r.id} className="flex items-start gap-2 px-4 py-2.5 border-b border-slate-100 hover:bg-slate-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <ChevronRight className="w-3 h-3" />
                    <span className="truncate">{r.chapter ?? '—'}</span>
                  </div>
                  <p className="text-sm text-slate-900 leading-snug">{r.full_path ?? r.rubric_text}</p>
                  {r.symptom_note && (
                    <p className="text-xs text-slate-500 italic mt-0.5">"{r.symptom_note}"</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[11px]">
                    <span className="text-slate-400">{r.remedy_count} remedies</span>
                    {r.intensity && (
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${INTENSITY_BADGE[r.intensity]}`}>
                        {INTENSITY_LABEL[r.intensity]}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <select
                    value={r.weight}
                    onChange={(e) => updateRubric.mutate({ ext_id: r.rubric_ext_id, patch: { weight: parseInt(e.target.value) } })}
                    className="text-xs border rounded px-1 py-0.5 bg-white"
                    title="Weight"
                  >
                    {[1, 2, 3, 4].map(w => <option key={w} value={w}>W:{w}</option>)}
                  </select>
                  <button
                    onClick={() => removeRubric.mutate(r.rubric_ext_id)}
                    className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                  ><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>

          {/* Reactions table */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2.5 flex items-center justify-between bg-slate-50 border-b">
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Reactions</h3>
              <div className="flex items-center gap-2">
                <select
                  value={resultSort}
                  onChange={(e) => setResultSort(e.target.value as any)}
                  className="text-xs border rounded px-2 py-1 bg-white"
                >
                  <option value="score">Sort: Score</option>
                  <option value="match">Sort: Match %</option>
                </select>
                <input
                  type="number"
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value) || 0)}
                  placeholder="Min"
                  className="w-16 text-xs border rounded px-2 py-1 bg-white"
                  title="Minimum score"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {!hasRun ? (
                <div className="text-center py-12 text-sm text-slate-400">
                  <Play className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  Run repertorization to see results
                </div>
              ) : visibleResults.length === 0 ? (
                <div className="text-center py-12 text-sm text-slate-400">No remedies match the selected rubrics</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white border-b text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-2 w-10">#</th>
                      <th className="text-left px-4 py-2">Remedy</th>
                      <th className="text-right px-4 py-2">Total Score</th>
                      <th className="text-right px-4 py-2">Match %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResults.map(r => (
                      <tr
                        key={r.rem_code}
                        onClick={() => setSelectedRemCode(r.rem_code)}
                        className={`cursor-pointer hover:bg-emerald-50/40 border-b border-slate-100 ${selectedRemCode === r.rem_code ? 'bg-emerald-50' : ''}`}
                      >
                        <td className="px-4 py-2 text-slate-400">{r.rank}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {r.rank <= 3 && (
                              <span className={`w-5 h-5 rounded-full text-xs text-white font-bold flex items-center justify-center ${
                                r.rank === 1 ? 'bg-amber-500' : r.rank === 2 ? 'bg-slate-400' : 'bg-amber-700'
                              }`}>{r.rank}</span>
                            )}
                            <div>
                              <p className="text-slate-900 font-medium">{r.full_name ?? r.abbreviation ?? `#${r.rem_code}`}</p>
                              {r.abbreviation && <p className="text-[11px] text-slate-400">{r.abbreviation}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700">{r.total_score}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{r.match_percent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>

        {/* ─── RIGHT: Remedy Details ─────────────────────────────────────── */}
        <aside className="col-span-4 bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold text-slate-900">Remedy Details</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!selectedRemCode || !detail ? (
              <div className="text-center py-12 text-sm text-slate-400 px-6">
                <Pill className="w-10 h-10 mx-auto mb-3 opacity-40" />
                Select a remedy from the results table to see how it covers each rubric.
              </div>
            ) : (
              <div className="p-5 space-y-5">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">{detail.full_name ?? detail.abbreviation}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {detail.abbreviation && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                        {detail.abbreviation}
                      </span>
                    )}
                    {detail.common_name && <span className="text-xs text-slate-500">{detail.common_name}</span>}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Matching Rubrics ({detail.contributions.length})
                  </h4>
                  <div className="space-y-1.5">
                    {detail.contributions.map((c) => (
                      <div key={c.rubric_ext_id} className="border rounded-md p-2.5 text-xs">
                        <div className="text-[10px] text-slate-400 mb-0.5">{c.chapter ?? '—'}</div>
                        <div className="text-slate-800 leading-snug">{c.full_path ?? c.rubric_text}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-white text-[10px] font-bold ${
                            c.grade === 4 ? 'bg-red-600' :
                            c.grade === 3 ? 'bg-orange-500' :
                            c.grade === 2 ? 'bg-amber-400 text-slate-900' : 'bg-slate-300 text-slate-700'
                          }`}>Grade {c.grade}</span>
                          <span className="text-slate-500">Weight ×{c.weight}</span>
                          <span className="ml-auto font-mono font-semibold text-emerald-700">+{c.contribution}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Footer */}
      <div className="bg-white border-t px-6 py-3 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-slate-500 text-xs">
          {saveCase.isSuccess && <span className="text-emerald-600">Saved.</span>}
          {saveCase.isError && <span className="text-red-600">Save failed.</span>}
          {opError && (
            <span className="text-red-600">
              {opError}
              <button onClick={() => setOpError(null)} className="ml-1 text-red-400 hover:text-red-700">×</button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/cases"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-slate-700 hover:bg-slate-50 text-xs"
          >
            <FilePlus2 className="w-3.5 h-3.5" /> New Case
          </a>
          <button
            onClick={() => saveCase.mutate()}
            disabled={!hasRun || saveCase.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-slate-700 hover:bg-slate-50 text-xs disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" /> Save Case
          </button>
          <a
            href={`/prescriptions/new?caseId=${caseId}${selectedRemCode ? `&remCode=${selectedRemCode}` : ''}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-xs font-medium"
          >
            <Pill className="w-3.5 h-3.5" /> Generate Prescription
          </a>
          <button
            onClick={handleExportPdf}
            disabled={!hasRun}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-slate-700 hover:bg-slate-50 text-xs disabled:opacity-50"
          >
            <FileText className="w-3.5 h-3.5" /> Export PDF
          </button>
          <button
            onClick={() => clearAll.mutate()}
            disabled={!selected.length}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-md text-red-600 hover:bg-red-50 text-xs disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Analysis
          </button>
        </div>
      </div>
    </div>
  )
}

function RubricRow({
  hit, added, onAdd,
}: {
  hit: RubricHit
  added: boolean
  onAdd: (intensity: Intensity) => void
}) {
  const [showIntensity, setShowIntensity] = useState(false)
  const pick = (intensity: Intensity) => {
    setShowIntensity(false)
    onAdd(intensity)
  }
  return (
    <div className={`px-2 py-2 mb-1.5 rounded-md border text-sm ${added ? 'bg-emerald-50 border-emerald-200' : 'border-slate-100 hover:bg-slate-50'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-slate-400 truncate">{hit.chapter ?? '—'}</div>
          <p className="text-[13px] text-slate-900 leading-snug">{hit.full_path ?? hit.rubric_text}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">{hit.remedy_count} remedies</p>
        </div>
        {added ? (
          <span className="text-[10px] uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded font-medium">Added</span>
        ) : showIntensity ? (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button type="button" onClick={() => pick('high')} title="High"
              className="text-[10px] font-bold w-6 h-6 rounded bg-red-500 hover:bg-red-600 text-white">H</button>
            <button type="button" onClick={() => pick('mid')} title="Mid"
              className="text-[10px] font-bold w-6 h-6 rounded bg-amber-500 hover:bg-amber-600 text-white">M</button>
            <button type="button" onClick={() => pick('low')} title="Low"
              className="text-[10px] font-bold w-6 h-6 rounded bg-slate-400 hover:bg-slate-500 text-white">L</button>
            <button type="button" onClick={() => setShowIntensity(false)}
              className="p-1 text-slate-400 hover:text-slate-600">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowIntensity(true)}
            className="p-1.5 rounded-md hover:bg-emerald-100 text-slate-500 hover:text-emerald-700 flex-shrink-0"
          ><Plus className="w-4 h-4" /></button>
        )}
      </div>
    </div>
  )
}

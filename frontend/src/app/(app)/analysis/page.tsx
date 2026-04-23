'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, Trash2, Play, Sparkles, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { AIRubricSuggestion } from '@/types'

export default function AnalysisPage({ searchParams }: { searchParams: { caseId?: string } }) {
  const caseId = searchParams.caseId || 'demo-case'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSource, setSelectedSource] = useState<string>()
  const [isAISearching, setIsAISearching] = useState(false)
  const [aiSuggestions, setAISuggestions] = useState<AIRubricSuggestion[]>([])
  const [selectedRemedyId, setSelectedRemedyId] = useState<string>()
  const queryClient = useQueryClient()

  const { data: sources } = useQuery({
    queryKey: ['repertory-sources'],
    queryFn: () => api.get<{ data: any[] }>('/repertory/sources'),
  })

  const { data: caseRubrics, isLoading: rubricLoading } = useQuery({
    queryKey: ['case-rubrics', caseId],
    queryFn: () => api.get<{ data: any[] }>(`/analysis/rubrics/${caseId}`),
  })

  const { data: results } = useQuery({
    queryKey: ['analysis-results', caseId],
    queryFn: () => api.get<{ data: any[] }>(`/analysis/${caseId}`),
  })

  const runAnalysis = useMutation({
    mutationFn: () => api.post<{ data: any }>(`/analysis/run/${caseId}`, { sourceId: selectedSource }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analysis-results', caseId] })
    },
  })

  const addRubric = useMutation({
    mutationFn: (data: { rubric_id: string; source_id: string; weight: number }) =>
      api.post<{ data: any }>(`/analysis/rubrics/${caseId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-rubrics', caseId] })
    },
  })

  const removeRubric = useMutation({
    mutationFn: (rubricId: string) =>
      api.delete(`/analysis/rubrics/${caseId}/${rubricId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-rubrics', caseId] })
    },
  })

  const handleAISearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setIsAISearching(true)
    try {
      const response = await api.post<{ data: AIRubricSuggestion[] }>('/ai/search', {
        query: searchQuery,
        source_id: selectedSource,
        limit: 15,
      })
      setAISuggestions(response.data)
    } finally {
      setIsAISearching(false)
    }
  }, [searchQuery, selectedSource])

  const gradeColors: Record<number, string> = {
    4: 'bg-red-600 text-white',
    3: 'bg-orange-500 text-white',
    2: 'bg-yellow-500 text-black',
    1: 'bg-gray-200 text-gray-700',
  }

  const weightColors: Record<number, string> = {
    4: 'border-red-500 bg-red-50',
    3: 'border-orange-500 bg-orange-50',
    2: 'border-yellow-500 bg-yellow-50',
    1: 'border-gray-300 bg-gray-50',
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Repertory Analysis</h1>
          <p className="text-sm text-gray-500 mt-0.5">Select rubrics and run repertorization</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedSource || ''}
            onChange={(e) => setSelectedSource(e.target.value || undefined)}
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">All Sources</option>
            {sources?.data?.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={() => runAnalysis.mutate()}
            disabled={!caseRubrics?.data?.length || runAnalysis.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
          >
            <Play className="w-4 h-4" />
            {runAnalysis.isPending ? 'Analyzing...' : 'Run Repertorization'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div className="w-96 border-r bg-white flex flex-col">
          <div className="p-4 border-b">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAISearch()}
                  placeholder="Search rubrics with AI..."
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                onClick={handleAISearch}
                disabled={isAISearching}
                className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-sm font-medium disabled:opacity-50 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {isAISearching ? '...' : 'AI'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Try: "fear of death at night" or "anxiety with restlessness"
            </p>
            {!selectedSource && (
              <p className="text-xs text-orange-500 mt-1">
                Select a repertory source above to add rubrics.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {aiSuggestions.length > 0 && (
              <div className="p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-violet-700 mb-2">
                  <Sparkles className="w-3 h-3" />
                  AI Suggestions ({aiSuggestions.length})
                </div>
                {aiSuggestions.map((suggestion) => (
                  <RubricSuggestionCard
                    key={suggestion.rubric_id}
                    suggestion={suggestion}
                    onAdd={(weight) => {
                      if (!selectedSource) return
                      addRubric.mutate({
                        rubric_id: suggestion.rubric_id,
                        source_id: selectedSource,
                        weight,
                      })
                    }}
                    isAdded={caseRubrics?.data?.some(
                      (cr: any) => cr.rubric_id === suggestion.rubric_id
                    ) ?? false}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Middle Panel */}
        <div className="w-80 border-r bg-white flex flex-col">
          <div className="p-4 border-b">
            <h2 className="font-medium text-gray-900">
              Selected Rubrics ({caseRubrics?.data?.length || 0})
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {rubricLoading ? (
              <div className="text-center text-gray-400 py-8 text-sm">Loading...</div>
            ) : !caseRubrics?.data?.length ? (
              <div className="text-center text-gray-400 py-8 text-sm">
                No rubrics selected.<br />Use AI search to add rubrics.
              </div>
            ) : (
              caseRubrics.data.map((cr: any) => (
                <div key={cr.id} className={`border rounded-lg p-3 ${weightColors[cr.weight] || 'bg-gray-50'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500 truncate">{cr.chapter_name}</p>
                      <p className="text-sm font-medium text-gray-900 leading-snug mt-0.5">{cr.full_path}</p>
                      <p className="text-xs text-gray-500 mt-1">{cr.remedy_count} remedies</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <select
                        value={cr.weight}
                        onChange={(e) => addRubric.mutate({
                          rubric_id: cr.rubric_id,
                          source_id: cr.source_id,
                          weight: parseInt(e.target.value),
                        })}
                        className="text-xs border rounded px-1 py-0.5 bg-white"
                      >
                        <option value={1}>W: 1</option>
                        <option value={2}>W: 2</option>
                        <option value={3}>W: 3</option>
                        <option value={4}>W: 4</option>
                      </select>
                      <button
                        onClick={() => removeRubric.mutate(cr.rubric_id)}
                        className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-white">
            <h2 className="font-medium text-gray-900">
              Repertorization Results {results?.data?.length ? `(${results.data.length})` : ''}
            </h2>
          </div>

          {!results?.data?.length ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Play className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select rubrics and run analysis</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-10">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Remedy</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Score</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Coverage</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Grades</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {results.data.map((result: any) => (
                      <tr
                        key={result.remedy_id}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${selectedRemedyId === result.remedy_id ? 'bg-emerald-50' : ''} ${result.rank <= 3 ? 'font-medium' : ''}`}
                        onClick={() => setSelectedRemedyId(selectedRemedyId === result.remedy_id ? undefined : result.remedy_id)}
                      >
                        <td className="px-4 py-3 text-gray-400">{result.rank}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {result.rank <= 3 && (
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-bold ${result.rank === 1 ? 'bg-yellow-500' : result.rank === 2 ? 'bg-gray-400' : 'bg-amber-700'}`}>
                                {result.rank}
                              </span>
                            )}
                            <div>
                              <p className="text-gray-900">{result.remedy_name}</p>
                              <p className="text-xs text-gray-400">{result.abbreviation}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono font-semibold text-emerald-700">{result.score}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-xs">{result.rubric_coverage}/{result.total_rubrics}</span>
                            <div className="w-16 bg-gray-200 rounded-full h-1.5">
                              <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${result.coverage_percent}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-0.5 justify-center">
                            {[4, 3, 2, 1].map((grade) => {
                              const count = result.grade_breakdown?.[`grade_${grade}`] || 0
                              if (!count) return null
                              return (
                                <span key={grade} className={`text-xs px-1.5 py-0.5 rounded font-medium ${gradeColors[grade] || 'bg-gray-200'}`} title={`Grade ${grade}: ${count}`}>
                                  {count}
                                </span>
                              )
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button className="text-xs px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors">
                            Prescribe
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RubricSuggestionCard({
  suggestion, onAdd, isAdded,
}: {
  suggestion: AIRubricSuggestion
  onAdd: (weight: number) => void
  isAdded: boolean
}) {
  return (
    <div className={`border rounded-lg p-3 mb-2 text-sm ${isAdded ? 'bg-emerald-50 border-emerald-300' : 'hover:bg-gray-50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-xs text-violet-600 mb-1">
            <ChevronRight className="w-3 h-3" />
            <span className="truncate">{suggestion.chapter_name}</span>
          </div>
          <p className="font-medium text-gray-900 leading-snug">{suggestion.full_path}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-400">{suggestion.remedy_count} remedies</span>
            <span className={`text-xs px-1 py-0.5 rounded ${suggestion.match_type === 'exact' ? 'bg-green-100 text-green-700' : suggestion.match_type === 'semantic' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
              {suggestion.match_type}
            </span>
          </div>
        </div>
        <button
          onClick={() => onAdd(2)}
          disabled={isAdded}
          className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${isAdded ? 'bg-emerald-100 text-emerald-600 cursor-default' : 'bg-gray-100 hover:bg-emerald-100 hover:text-emerald-600 text-gray-600'}`}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

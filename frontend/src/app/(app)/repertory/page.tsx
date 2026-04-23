'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronRight, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'

export default function RepertoryPage() {
  const [selectedSource, setSelectedSource] = useState<string>()
  const [selectedChapter, setSelectedChapter] = useState<string>()
  const [selectedRubricId, setSelectedRubricId] = useState<string>()

  const { data: sources } = useQuery({
    queryKey: ['repertory-sources'],
    queryFn: () => api.get<{ data: any[] }>('/repertory/sources'),
  })

  const { data: chapters, isLoading: chaptersLoading } = useQuery({
    queryKey: ['chapters', selectedSource],
    queryFn: () => api.get<{ data: any[] }>(`/repertory/chapters${selectedSource ? `?source_id=${selectedSource}` : ''}`),
  })

  const { data: rubrics, isLoading: rubricsLoading } = useQuery({
    queryKey: ['rubrics', selectedChapter],
    queryFn: () => api.get<{ data: any[] }>(`/repertory/rubrics?chapter_id=${selectedChapter}&parent_id=null`),
    enabled: !!selectedChapter,
  })

  const { data: rubricDetail } = useQuery({
    queryKey: ['rubric-detail', selectedRubricId],
    queryFn: () => api.get<{ data: any }>(`/repertory/rubrics/${selectedRubricId}${selectedSource ? `?source_id=${selectedSource}` : ''}`),
    enabled: !!selectedRubricId,
  })

  const gradeInfo: Record<number, { label: string; style: string }> = {
    4: { label: 'Keynote', style: 'bg-red-100 text-red-700' },
    3: { label: 'Strong', style: 'bg-orange-100 text-orange-700' },
    2: { label: 'Moderate', style: 'bg-yellow-100 text-yellow-700' },
    1: { label: 'Minor', style: 'bg-gray-100 text-gray-600' },
  }

  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">Repertory Browser</h1>
          <p className="text-sm text-gray-500 mt-0.5">Browse chapters and rubrics</p>
        </div>
        <select
          value={selectedSource || ''}
          onChange={(e) => { setSelectedSource(e.target.value || undefined); setSelectedChapter(undefined); setSelectedRubricId(undefined) }}
          className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">All Sources</option>
          {(sources?.data ?? []).map((s: any) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Chapters */}
        <div className="w-60 border-r bg-white flex flex-col">
          <div className="px-4 py-3 border-b">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Chapters</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {chaptersLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            ) : !(chapters?.data?.length) ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">No chapters found</p>
            ) : (
              chapters.data.map((ch: any) => (
                <button key={ch.id}
                  onClick={() => { setSelectedChapter(ch.id); setSelectedRubricId(undefined) }}
                  className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors ${selectedChapter === ch.id ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  <span className="text-xs font-mono text-gray-400 w-8 shrink-0">{ch.code}</span>
                  <span className="truncate">{ch.name}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-300 ml-auto shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Rubrics */}
        <div className="w-64 border-r bg-white flex flex-col">
          <div className="px-4 py-3 border-b">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rubrics</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!selectedChapter ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Select a chapter</p>
            ) : rubricsLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            ) : !(rubrics?.data?.length) ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">No rubrics found</p>
            ) : (
              rubrics.data.map((r: any) => (
                <button key={r.id}
                  onClick={() => setSelectedRubricId(r.id)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${selectedRubricId === r.id ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  <span className="truncate">{r.name}</span>
                  <span className="text-xs text-gray-400 ml-2 shrink-0">{r.remedy_count}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Rubric Detail */}
        <div className="flex-1 bg-gray-50 overflow-y-auto">
          {!rubricDetail?.data ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <BookOpen className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">Select a rubric to view remedies</p>
            </div>
          ) : (
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">{rubricDetail.data.full_path}</h2>
              <p className="text-sm text-gray-500 mb-6">{rubricDetail.data.remedy_count} remedies</p>
              {[4, 3, 2, 1].map((grade) => {
                const remedies: any[] = rubricDetail.data.remedy_by_grade?.[`grade_${grade}`] ?? []
                if (!remedies.length) return null
                const { label, style } = gradeInfo[grade]
                return (
                  <div key={grade} className="mb-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${style}`}>Grade {grade} — {label}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {remedies.map((r: any) => (
                        <span key={r.id} className="px-2 py-0.5 bg-white border rounded text-sm text-gray-700">{r.abbreviation}</span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

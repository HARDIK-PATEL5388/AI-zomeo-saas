'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronRight, ChevronDown, Loader2, Search } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface ChapterRow { chapter: string; rubric_count: number }
interface RubricRow {
  ext_id: number
  parent_ext_id: number | null
  depth: number
  chapter: string
  rubric_text: string
  full_path: string
  remedy_count: number
  child_count: number
}
interface RubricDetail extends RubricRow {
  remedy_by_grade: Record<string, Array<{ id: number; rem_code: number; abbreviation: string; full_name?: string; common_name?: string }>>
}

async function localGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/repertory-upload${path}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

const GRADE_INFO: Record<number, { label: string; style: string }> = {
  4: { label: 'Keynote',  style: 'bg-red-100 text-red-700' },
  3: { label: 'Strong',   style: 'bg-orange-100 text-orange-700' },
  2: { label: 'Moderate', style: 'bg-yellow-100 text-yellow-700' },
  1: { label: 'Minor',    style: 'bg-gray-100 text-gray-600' },
}

export default function RepertoryPage() {
  const [selectedChapter, setSelectedChapter] = useState<string>()
  const [selectedExtId, setSelectedExtId]     = useState<number>()
  const [expanded, setExpanded]               = useState<Set<number>>(new Set())
  const [search, setSearch]                   = useState('')

  // Chapters
  const chaptersQ = useQuery({
    queryKey: ['rep-chapters'],
    queryFn:  () => localGet<{ data: ChapterRow[] }>('/browse/chapters'),
  })

  // Top-level rubrics for the chapter (parent IS NULL) OR search results
  const rubricsQ = useQuery({
    queryKey: ['rep-rubrics', selectedChapter, search],
    queryFn:  () => {
      const params = new URLSearchParams()
      if (selectedChapter) params.set('chapter', selectedChapter)
      if (search.trim()) {
        params.set('q', search.trim())
        params.set('limit', '300')
      } else {
        params.set('parent', 'root')
        params.set('limit', '500')
      }
      return localGet<{ data: RubricRow[] }>(`/browse/rubrics?${params.toString()}`)
    },
    enabled: !!selectedChapter,
  })

  // Rubric detail
  const detailQ = useQuery({
    queryKey: ['rep-rubric-detail', selectedExtId],
    queryFn:  () => localGet<{ data: RubricDetail }>(`/browse/rubrics/${selectedExtId}`),
    enabled:  !!selectedExtId,
  })

  function toggleExpand(extId: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(extId)) next.delete(extId)
      else next.add(extId)
      return next
    })
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">Repertory Browser</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Browse imported repertory data from local Postgres ({chaptersQ.data?.data?.length ?? '—'} chapters)
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search rubrics..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 w-64"
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Chapters column */}
        <div className="w-64 border-r bg-white flex flex-col">
          <div className="px-4 py-3 border-b">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Chapters</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {chaptersQ.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : chaptersQ.error ? (
              <p className="px-4 py-6 text-sm text-red-500 text-center">
                {(chaptersQ.error as Error).message}
              </p>
            ) : !(chaptersQ.data?.data?.length) ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">No chapters found.<br/>Upload TAB files first.</p>
            ) : (
              chaptersQ.data.data.map((ch) => (
                <button
                  key={ch.chapter}
                  onClick={() => { setSelectedChapter(ch.chapter); setSelectedExtId(undefined); setExpanded(new Set()) }}
                  className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
                    selectedChapter === ch.chapter
                      ? 'bg-emerald-50 text-emerald-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="truncate capitalize">{ch.chapter}</span>
                  <span className="text-xs text-gray-400 shrink-0">{ch.rubric_count.toLocaleString()}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Rubrics column */}
        <div className="w-96 border-r bg-white flex flex-col">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {search.trim() ? 'Search Results' : 'Top-Level Rubrics'}
            </p>
            {rubricsQ.data?.data && (
              <span className="text-xs text-gray-400">{rubricsQ.data.data.length}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!selectedChapter ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Select a chapter</p>
            ) : rubricsQ.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : !(rubricsQ.data?.data?.length) ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">No rubrics found</p>
            ) : (
              rubricsQ.data.data.map((r) => (
                <RubricNode
                  key={r.ext_id}
                  rubric={r}
                  expanded={expanded}
                  onToggle={toggleExpand}
                  selectedExtId={selectedExtId}
                  onSelect={setSelectedExtId}
                  level={0}
                />
              ))
            )}
          </div>
        </div>

        {/* Rubric detail */}
        <div className="flex-1 bg-gray-50 overflow-y-auto">
          {!selectedExtId ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <BookOpen className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">Select a rubric to view remedies</p>
            </div>
          ) : detailQ.isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : detailQ.error ? (
            <div className="p-6 text-sm text-red-600">{(detailQ.error as Error).message}</div>
          ) : detailQ.data?.data ? (
            <div className="p-6">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1 capitalize">{detailQ.data.data.chapter}</p>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">{detailQ.data.data.full_path}</h2>
              <p className="text-sm text-gray-500 mb-6">{detailQ.data.data.remedy_count.toLocaleString()} remedies · ext_id {detailQ.data.data.ext_id}</p>

              {detailQ.data.data.remedy_count === 0 ? (
                <p className="text-sm text-gray-400 italic">No remedies for this rubric.</p>
              ) : (
                [4, 3, 2, 1].map((grade) => {
                  const remedies = detailQ.data!.data.remedy_by_grade?.[`grade_${grade}`] ?? []
                  if (!remedies.length) return null
                  const { label, style } = GRADE_INFO[grade]
                  return (
                    <div key={grade} className="mb-5">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${style}`}>
                          Grade {grade} — {label}
                        </span>
                        <span className="text-xs text-gray-400">({remedies.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {remedies.map((r) => (
                          <span
                            key={r.id}
                            title={r.full_name || r.common_name || ''}
                            className="px-2 py-0.5 bg-white border rounded text-sm text-gray-700 hover:bg-gray-50 cursor-help"
                          >
                            {r.abbreviation}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// Recursive rubric tree node — lazy-loads children on expand
function RubricNode({
  rubric, expanded, onToggle, selectedExtId, onSelect, level,
}: {
  rubric: RubricRow
  expanded: Set<number>
  onToggle: (extId: number) => void
  selectedExtId?: number
  onSelect: (extId: number) => void
  level: number
}) {
  const isOpen = expanded.has(rubric.ext_id)
  const hasChildren = rubric.child_count > 0

  const childrenQ = useQuery({
    queryKey: ['rep-children', rubric.ext_id],
    queryFn:  () => localGet<{ data: RubricRow[] }>(`/browse/rubrics?parent=${rubric.ext_id}&limit=500`),
    enabled:  isOpen && hasChildren,
  })

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 text-sm cursor-pointer transition-colors ${
          selectedExtId === rubric.ext_id
            ? 'bg-emerald-50 text-emerald-700 font-medium'
            : 'hover:bg-gray-50 text-gray-700'
        }`}
        style={{ paddingLeft: `${8 + level * 16}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(rubric.ext_id) }}
            className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 shrink-0"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          onClick={() => onSelect(rubric.ext_id)}
          className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
        >
          <span className="truncate">{rubric.rubric_text}</span>
          <span className="text-xs text-gray-400 shrink-0">{rubric.remedy_count}</span>
        </button>
      </div>
      {isOpen && hasChildren && (
        <div>
          {childrenQ.isLoading && (
            <div className="py-1.5" style={{ paddingLeft: `${24 + level * 16}px` }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
            </div>
          )}
          {childrenQ.data?.data?.map((child) => (
            <RubricNode
              key={child.ext_id}
              rubric={child}
              expanded={expanded}
              onToggle={onToggle}
              selectedExtId={selectedExtId}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

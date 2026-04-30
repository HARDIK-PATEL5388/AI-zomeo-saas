'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChevronRight, ChevronDown, Loader2, Search, Library } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface BookRow {
  id: number
  code: string
  name: string
  description?: string | null
  sort_order: number
  chapter_count: number
  rubric_count: number
}
interface ChapterRow {
  chapter_id: number
  chapter: string
  code: string | null
  sort_order: number
  rubric_count: number
}
interface RubricRow {
  rubric_id: number
  book_id: number
  ext_id: number
  parent_ext_id: number | null
  depth: number
  chapter_id: number | null
  chapter: string
  rubric_text: string
  full_path: string
  remedy_count: number
  child_count: number
  book_code?: string
  book_name?: string
}
interface RubricDetail extends RubricRow {
  book_code: string
  book_name: string
  remedy_by_grade: Record<
    string,
    Array<{ id: number; rem_code: number; abbreviation: string; full_name?: string; common_name?: string }>
  >
}

async function api<T>(path: string): Promise<T> {
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
  const [selectedBook, setSelectedBook]       = useState<BookRow>()
  const [expandedBooks, setExpandedBooks]     = useState<Set<string>>(new Set())
  const [selectedChapter, setSelectedChapter] = useState<ChapterRow>()
  const [selectedRubricId, setSelectedRubricId] = useState<number>()
  const [expandedRubrics, setExpandedRubrics] = useState<Set<number>>(new Set())
  const [search, setSearch]                   = useState('')
  const [searchScope, setSearchScope]         = useState<'book' | 'all'>('book')

  // Books
  const booksQ = useQuery({
    queryKey: ['rep-books'],
    queryFn:  () => api<{ data: BookRow[] }>('/browse/books'),
  })

  // Auto-select Complete on first load
  useEffect(() => {
    if (selectedBook || !booksQ.data?.data?.length) return
    const complete = booksQ.data.data.find(b => b.code === 'complete') ?? booksQ.data.data[0]
    setSelectedBook(complete)
    setExpandedBooks(new Set([complete.code]))
  }, [booksQ.data, selectedBook])

  // Chapters for selected book (only fetched if a book is expanded)
  const chaptersQ = useQuery({
    queryKey: ['rep-chapters', selectedBook?.code],
    queryFn:  () => api<{ data: ChapterRow[] }>(`/browse/chapters?book=${selectedBook!.code}`),
    enabled:  !!selectedBook,
  })

  // Rubrics: either chapter browse or scoped/global search
  const isSearching = search.trim().length >= 2

  const rubricsQ = useQuery({
    queryKey: ['rep-rubrics', selectedBook?.code, selectedChapter?.chapter_id, isSearching ? `q:${search.trim()}:${searchScope}` : 'top'],
    queryFn:  () => {
      if (isSearching) {
        const params = new URLSearchParams({ q: search.trim(), limit: '300' })
        if (searchScope === 'book' && selectedBook) params.set('book', selectedBook.code)
        return api<{ data: RubricRow[] }>(`/browse/search?${params.toString()}`)
      }
      const params = new URLSearchParams({
        book: selectedBook!.code,
        chapter: String(selectedChapter!.chapter_id),
        parent: 'root',
        limit: '500',
      })
      return api<{ data: RubricRow[] }>(`/browse/rubrics?${params.toString()}`)
    },
    enabled: isSearching ? !!(searchScope === 'all' || selectedBook) : !!(selectedBook && selectedChapter),
  })

  // Rubric detail
  const detailQ = useQuery({
    queryKey: ['rep-rubric-detail', selectedRubricId],
    queryFn:  () => api<{ data: RubricDetail }>(`/browse/rubrics/${selectedRubricId}`),
    enabled:  !!selectedRubricId,
  })

  function toggleBook(code: string) {
    setExpandedBooks(prev => {
      const n = new Set(prev)
      n.has(code) ? n.delete(code) : n.add(code)
      return n
    })
  }
  function toggleRubric(extId: number) {
    setExpandedRubrics(prev => {
      const n = new Set(prev)
      n.has(extId) ? n.delete(extId) : n.add(extId)
      return n
    })
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">Repertory Browser</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {detailQ.data?.data
              ? <>[<span className="font-medium">{detailQ.data.data.book_name}</span>]
                  [<span className="font-medium capitalize">{detailQ.data.data.chapter}</span>]
                  {' '}{detailQ.data.data.rubric_text}</>
              : booksQ.data?.data
                ? <>{booksQ.data.data.length} {booksQ.data.data.length === 1 ? 'book' : 'books'} ·
                    {' '}{booksQ.data.data.reduce((s, b) => s + b.rubric_count, 0).toLocaleString()} rubrics total</>
                : 'Loading repertory…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-gray-50 p-0.5 text-xs">
            <button
              onClick={() => setSearchScope('book')}
              className={`px-2.5 py-1 rounded-md transition ${
                searchScope === 'book' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-800'
              }`}
              title="Search only inside the selected book"
            >This book</button>
            <button
              onClick={() => setSearchScope('all')}
              className={`px-2.5 py-1 rounded-md transition ${
                searchScope === 'all' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-800'
              }`}
              title="Search across every book"
            >All books</button>
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
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Books / chapters tree */}
        <div className="w-72 border-r bg-white flex flex-col">
          <div className="px-4 py-3 border-b">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Repertories</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {booksQ.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : booksQ.error ? (
              <p className="px-4 py-6 text-sm text-red-500 text-center">
                {(booksQ.error as Error).message}
              </p>
            ) : !(booksQ.data?.data?.length) ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">
                No books yet. Upload TAB files to populate.
              </p>
            ) : (
              booksQ.data.data.map((book) => {
                const isOpen = expandedBooks.has(book.code)
                const isSelected = selectedBook?.code === book.code
                return (
                  <div key={book.code}>
                    <div
                      className={`flex items-center gap-1 px-3 py-2 text-sm cursor-pointer transition-colors ${
                        isSelected ? 'bg-emerald-50 text-emerald-700' : 'text-gray-800 hover:bg-gray-50'
                      }`}
                    >
                      <button
                        onClick={() => toggleBook(book.code)}
                        className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 shrink-0"
                      >
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => {
                          setSelectedBook(book)
                          setExpandedBooks(prev => new Set(prev).add(book.code))
                          setSelectedChapter(undefined)
                          setSelectedRubricId(undefined)
                          setExpandedRubrics(new Set())
                        }}
                        className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Library className="w-4 h-4 shrink-0 text-gray-400" />
                          <span className="truncate font-medium">{book.name}</span>
                        </span>
                        <span className="text-xs text-gray-400 shrink-0">({book.chapter_count})</span>
                      </button>
                    </div>
                    {isOpen && isSelected && (
                      <div className="bg-gray-50/40">
                        {chaptersQ.isLoading ? (
                          <div className="py-2 pl-10">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                          </div>
                        ) : chaptersQ.data?.data?.length ? (
                          chaptersQ.data.data.map((ch) => (
                            <button
                              key={ch.chapter_id}
                              onClick={() => {
                                setSelectedChapter(ch)
                                setSelectedRubricId(undefined)
                                setExpandedRubrics(new Set())
                                setSearch('')
                              }}
                              className={`w-full flex items-center justify-between gap-2 pl-10 pr-3 py-1.5 text-sm text-left transition-colors ${
                                selectedChapter?.chapter_id === ch.chapter_id
                                  ? 'bg-emerald-100 text-emerald-800 font-medium'
                                  : 'text-gray-700 hover:bg-gray-100'
                              }`}
                            >
                              <span className="truncate capitalize">{ch.chapter}</span>
                              <span className="text-xs text-gray-400 shrink-0">{ch.rubric_count.toLocaleString()}</span>
                            </button>
                          ))
                        ) : (
                          <p className="pl-10 py-2 text-xs text-gray-400">No chapters</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Rubrics column */}
        <div className="w-96 border-r bg-white flex flex-col">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {isSearching
                ? `Search: ${searchScope === 'all' ? 'All books' : selectedBook?.name ?? '—'}`
                : selectedChapter
                  ? `${selectedChapter.chapter} — top-level`
                  : 'Top-level rubrics'}
            </p>
            {rubricsQ.data?.data && (
              <span className="text-xs text-gray-400">{rubricsQ.data.data.length}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!isSearching && !selectedChapter ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">
                Select a chapter from a book to begin
              </p>
            ) : rubricsQ.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : !(rubricsQ.data?.data?.length) ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">No rubrics found</p>
            ) : (
              rubricsQ.data.data.map((r) => (
                <RubricNode
                  key={r.rubric_id}
                  rubric={r}
                  showBook={isSearching && searchScope === 'all'}
                  expanded={expandedRubrics}
                  onToggle={toggleRubric}
                  selectedRubricId={selectedRubricId}
                  onSelect={setSelectedRubricId}
                  level={0}
                />
              ))
            )}
          </div>
        </div>

        {/* Rubric detail */}
        <div className="flex-1 bg-gray-50 overflow-y-auto">
          {!selectedRubricId ? (
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
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-emerald-100 text-emerald-800">
                  {detailQ.data.data.book_name}
                </span>
                <span className="text-xs uppercase tracking-wide text-gray-500 capitalize">
                  {detailQ.data.data.chapter}
                </span>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">{detailQ.data.data.full_path}</h2>
              <p className="text-sm text-gray-500 mb-6">
                {detailQ.data.data.remedy_count.toLocaleString()} remedies · rubric_id {detailQ.data.data.rubric_id}
              </p>

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
  rubric, showBook, expanded, onToggle, selectedRubricId, onSelect, level,
}: {
  rubric: RubricRow
  showBook: boolean
  expanded: Set<number>
  onToggle: (extId: number) => void
  selectedRubricId?: number
  onSelect: (rubricId: number) => void
  level: number
}) {
  const isOpen = expanded.has(rubric.ext_id)
  const hasChildren = rubric.child_count > 0

  const childrenQ = useQuery({
    queryKey: ['rep-children', rubric.book_id, rubric.ext_id],
    queryFn:  () => api<{ data: RubricRow[] }>(
      `/browse/rubrics?book=${rubric.book_code ?? 'complete'}&parent=${rubric.ext_id}&limit=500`,
    ),
    enabled:  isOpen && hasChildren && !!rubric.book_code,
  })

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 text-sm cursor-pointer transition-colors ${
          selectedRubricId === rubric.rubric_id
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
          onClick={() => onSelect(rubric.rubric_id)}
          className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
        >
          <span className="truncate flex items-center gap-2 min-w-0">
            {showBook && rubric.book_name && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-100 text-emerald-800 shrink-0">
                {rubric.book_name}
              </span>
            )}
            <span className="truncate">{rubric.rubric_text}</span>
          </span>
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
              key={child.rubric_id}
              rubric={child}
              showBook={false}
              expanded={expanded}
              onToggle={onToggle}
              selectedRubricId={selectedRubricId}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

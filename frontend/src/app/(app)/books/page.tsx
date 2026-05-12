'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { BookOpen, Check, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { api } from '@/lib/api'

interface LibraryCategory {
  id: number
  name: string
  sort_order: number
  book_count: number
}

interface LibraryBook {
  id: number
  title: string
  author: string | null
}

interface LibraryChapter {
  id: number
  name: string
  sort_order: number
}

interface BookDetailResponse {
  book: { id: number; title: string; author: string | null; category: string | null }
  chapters: LibraryChapter[]
}

interface ChapterContent {
  id: number
  name: string
  content: string
}

interface ParsedSection {
  heading: string | null
  paragraphs: string[]
}

interface ParsedChapter {
  chapterTitle: string | null
  chapterCode: string | null
  sections: ParsedSection[]
}

// Decoded .mat content uses the legacy delimiters:
//   `$ <Title> [<Code>]`  — chapter header (once at the top)
//   `#<Heading>`          — section header
//   blank line            — paragraph break
// Everything else is body text. This parser is intentionally tolerant:
// trailing/leading whitespace, missing chapter delim, and headings with
// inline body all degrade gracefully into "best effort" structured output.
function parseChapterContent(raw: string): ParsedChapter {
  let chapterTitle: string | null = null
  let chapterCode: string | null = null
  const sections: ParsedSection[] = []
  let cur: ParsedSection = { heading: null, paragraphs: [] }
  sections.push(cur)

  const blocks = raw
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean)

  for (const block of blocks) {
    if (chapterTitle === null && block.startsWith('$ ')) {
      // `[\s\S]` instead of `.` to span newlines without the ES2018 `s` flag.
      // Anything after the `]` (e.g. a subtitle line) becomes the first
      // paragraph rather than being dropped.
      const m = block.match(/^\$\s*(.+?)\s*\[(.+?)\]\s*\n?([\s\S]*)$/)
      if (m) {
        chapterTitle = m[1].trim()
        chapterCode = m[2].trim()
        const rest = m[3].trim()
        if (rest) cur.paragraphs.push(rest)
      }
      continue
    }
    if (block.startsWith('#')) {
      const nl = block.indexOf('\n')
      const heading = (nl >= 0 ? block.slice(1, nl) : block.slice(1)).trim()
      const rest = nl >= 0 ? block.slice(nl + 1).trim() : ''
      cur = { heading, paragraphs: [] }
      sections.push(cur)
      if (rest) cur.paragraphs.push(rest)
      continue
    }
    cur.paragraphs.push(block)
  }

  while (
    sections.length > 0 &&
    sections[0].heading === null &&
    sections[0].paragraphs.length === 0
  ) {
    sections.shift()
  }

  return { chapterTitle, chapterCode, sections }
}

// Many .mat sources break list items across blank lines, so they arrive as
// separate paragraphs. Merge consecutive single-line list items into one
// multi-line paragraph so `renderParagraph` can style them as <ol>/<ul>.
function groupListItems(paragraphs: string[]): string[] {
  const out: string[] = []
  const isNum = (s: string) => /^\s*\d+[.)]\s+/.test(s) && !s.includes('\n')
  const isBul = (s: string) => /^\s*[-*•]\s+/.test(s) && !s.includes('\n')
  let i = 0
  while (i < paragraphs.length) {
    const p = paragraphs[i]
    const sameKind = isNum(p) ? isNum : isBul(p) ? isBul : null
    if (sameKind) {
      const group: string[] = [p]
      while (i + 1 < paragraphs.length && sameKind(paragraphs[i + 1])) {
        group.push(paragraphs[i + 1])
        i++
      }
      out.push(group.length >= 2 ? group.join('\n') : p)
    } else {
      out.push(p)
    }
    i++
  }
  return out
}

function LibrarySidebar({
  selectedBookId,
  onSelectBook,
}: {
  selectedBookId: number | null
  onSelectBook: (bookId: number) => void
}) {
  const [expandedTypeId, setExpandedTypeId] = useState<number | null>(3)
  const [bookFilter, setBookFilter] = useState('')

  const { data: categories = [], isLoading: catsLoading } = useQuery({
    queryKey: ['library', 'categories'],
    queryFn: () => api.get<LibraryCategory[]>('/books/library/categories'),
  })

  const { data: booksRaw = [], isLoading: booksLoading } = useQuery({
    queryKey: ['library', 'categories', expandedTypeId, 'books'],
    queryFn: () =>
      api.get<LibraryBook[]>(`/books/library/categories/${expandedTypeId}/books`),
    enabled: expandedTypeId !== null,
  })

  const filterTerm = bookFilter.trim().toLowerCase()
  const books = filterTerm
    ? booksRaw.filter(
        b =>
          b.title.toLowerCase().includes(filterTerm) ||
          (b.author ?? '').toLowerCase().includes(filterTerm),
      )
    : booksRaw

  return (
    <div className="flex flex-col">
      {/* Header strip */}
      <div className="px-5 pt-5 pb-3 sticky top-0 bg-white z-10">
        <div className="text-[11px] font-semibold tracking-wider uppercase text-slate-400 mb-2">
          Library
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={bookFilter}
            onChange={e => setBookFilter(e.target.value)}
            placeholder="Search books or authors"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 border border-transparent rounded-md placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300"
          />
        </div>
      </div>

      {/* Categories */}
      <nav className="pb-6">
        {catsLoading && (
          <div className="px-5 py-2 text-xs text-slate-400">Loading…</div>
        )}
        {categories.map(cat => {
          const isExpanded = expandedTypeId === cat.id
          return (
            <div key={cat.id}>
              <button
                onClick={() => {
                  setExpandedTypeId(isExpanded ? null : cat.id)
                  setBookFilter('')
                }}
                className="w-full px-5 py-2 flex items-center gap-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                )}
                <span className="flex-1 font-medium text-slate-800 truncate">
                  {cat.name}
                </span>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {cat.book_count}
                </span>
              </button>
              {isExpanded && (
                <ul className="pb-1">
                  {booksLoading && (
                    <li className="px-9 py-1.5 text-xs text-slate-400 italic">
                      Loading…
                    </li>
                  )}
                  {!booksLoading && books.length === 0 && (
                    <li className="px-9 py-1.5 text-xs text-slate-400 italic">
                      {filterTerm ? 'No matches' : 'No books available'}
                    </li>
                  )}
                  {books.map(b => {
                    const active = selectedBookId === b.id
                    return (
                      <li key={b.id}>
                        <button
                          onClick={() => onSelectBook(b.id)}
                          title={b.title}
                          className={`w-full text-left pl-9 pr-5 py-1.5 text-[13px] leading-snug truncate transition-colors border-l-2 ${
                            active
                              ? 'border-emerald-500 bg-emerald-50/50 text-slate-900 font-medium'
                              : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                          }`}
                        >
                          {b.title}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>
    </div>
  )
}

// Split `text` into React nodes with literal (case-insensitive) substrings of
// `query` wrapped in <mark>. Returns the original string when query is empty
// or doesn't match. No regex injection risk — query is escaped.
function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim()
  if (!q) return text
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(re)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-yellow-100 text-slate-900 rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

// Right-rail navigation. Lists `#` section headings of the current chapter so
// the reader can jump around — fills what would otherwise be empty gutter on
// wide screens with useful navigation (Linear / Notion / GitBook pattern).
function ChapterToc({ content }: { content: string }) {
  const parsed = parseChapterContent(content)
  const items = parsed.sections
    .map((s, i) => ({ id: `sec-${i}`, heading: s.heading }))
    .filter((s): s is { id: string; heading: string } => Boolean(s.heading))

  if (items.length === 0) return null

  return (
    <nav className="sticky top-32 text-sm">
      <div className="text-[11px] font-semibold tracking-wider uppercase text-slate-400 mb-3">
        On this page
      </div>
      <ul className="space-y-1.5 border-l border-slate-200">
        {items.map(item => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="block -ml-px pl-3 py-1 border-l border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-400 transition-colors"
            >
              {item.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function ChapterSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-1/3 mx-auto bg-slate-200 rounded-md mb-8" />
      <div className="space-y-3">
        <div className="h-4 w-full bg-slate-200 rounded-md" />
        <div className="h-4 w-11/12 bg-slate-200 rounded-md" />
        <div className="h-4 w-9/12 bg-slate-200 rounded-md" />
      </div>
    </div>
  )
}

function ChapterBody({ content, highlight: q }: { content: string; highlight: string }) {
  const parsed = parseChapterContent(content)
  if (parsed.sections.length === 0 && !parsed.chapterTitle) {
    return <p className="text-slate-400 italic">No content available.</p>
  }
  // Local paragraph renderer — same shape as renderParagraph() above but
  // applies the in-chapter highlight to text nodes.
  const renderPara = (p: string, key: number): JSX.Element => {
    const lines = p.split('\n').map(l => l.replace(/\s+$/, ''))
    const numbered = lines.map(l => l.match(/^\s*(\d+)[.)]\s+(.*)$/))
    if (lines.length >= 2 && numbered.every(m => m !== null)) {
      const start = Number(numbered[0]![1])
      return (
        <ol
          key={key}
          start={Number.isFinite(start) ? start : 1}
          className="mb-5 pl-6 list-decimal space-y-2 text-slate-700"
        >
          {numbered.map((m, i) => (
            <li key={i}>{highlight(m![2], q)}</li>
          ))}
        </ol>
      )
    }
    const bullet = lines.map(l => l.match(/^\s*[-*•]\s+(.*)$/))
    if (lines.length >= 2 && bullet.every(m => m !== null)) {
      return (
        <ul key={key} className="mb-5 pl-6 list-disc space-y-2 text-slate-700">
          {bullet.map((m, i) => (
            <li key={i}>{highlight(m![1], q)}</li>
          ))}
        </ul>
      )
    }
    return (
      <p key={key} className="mb-5 whitespace-pre-wrap text-slate-700">
        {highlight(p, q)}
      </p>
    )
  }

  return (
    <article className="text-[16px] leading-[1.8] text-slate-700">
      {parsed.chapterTitle && (
        <>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 text-center mt-2 mb-3">
            {parsed.chapterTitle}
          </h1>
          <div className="border-b border-slate-200 mb-10" />
        </>
      )}
      {parsed.sections.map((s, i) => (
        <section key={i} id={`sec-${i}`} className="mb-2 scroll-mt-32">
          {s.heading && (
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 mt-10 mb-3">
              {s.heading}
            </h2>
          )}
          {groupListItems(s.paragraphs).map((p, j) => renderPara(p, j))}
        </section>
      ))}
    </article>
  )
}

function BookReader({
  bookId,
  selectedChapterId,
  onSelectChapter,
}: {
  bookId: number
  selectedChapterId: number | null
  onSelectChapter: (chapterId: number) => void
}) {
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [chapterFilter, setChapterFilter] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [inChapterQuery, setInChapterQuery] = useState('')

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['library', 'books', bookId, 'chapters'],
    queryFn: () => api.get<BookDetailResponse>(`/books/library/books/${bookId}/chapters`),
  })

  useEffect(() => {
    if (detail && detail.chapters.length > 0 && selectedChapterId === null) {
      onSelectChapter(detail.chapters[0].id)
    }
  }, [detail, selectedChapterId, onSelectChapter])

  const { data: chapter, isLoading: chapterLoading } = useQuery({
    queryKey: ['library', 'chapters', selectedChapterId],
    queryFn: () => api.get<ChapterContent>(`/books/library/chapters/${selectedChapterId}`),
    enabled: selectedChapterId !== null,
  })

  // Outside-click + Esc close for the chapter popover
  useEffect(() => {
    if (!chaptersOpen) return
    const onDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setChaptersOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChaptersOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [chaptersOpen])

  // Ctrl/Cmd+F focuses the in-chapter search instead of opening browser find.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const currentChapter = detail?.chapters.find(c => c.id === selectedChapterId)
  const filterTerm = chapterFilter.trim().toLowerCase()
  const filteredChapters = filterTerm
    ? (detail?.chapters ?? []).filter(c => c.name.toLowerCase().includes(filterTerm))
    : (detail?.chapters ?? [])
  const showChapterSearch = (detail?.chapters.length ?? 0) > 12

  if (detailLoading || !detail) {
    return (
      <div className="px-6 lg:px-10 py-10 max-w-7xl mx-auto">
        <ChapterSkeleton />
      </div>
    )
  }

  return (
    <div>
      {/* Sticky reader header */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-5 pb-3">
          {/* Breadcrumb */}
          <nav className="text-xs text-slate-500 mb-3">
            <span>Library</span>
            <span className="mx-2 text-slate-300">/</span>
            <span>{detail.book.category ?? '—'}</span>
            <span className="mx-2 text-slate-300">/</span>
            <span className="text-slate-900 font-medium truncate inline-block max-w-[60ch] align-bottom">
              {detail.book.title}
            </span>
          </nav>

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative">
              <button
                ref={triggerRef}
                onClick={() => {
                  setChaptersOpen(o => !o)
                  setChapterFilter('')
                }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-900 hover:text-slate-700 transition-colors"
              >
                {currentChapter?.name ?? 'Select chapter'}
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
              </button>
              {chaptersOpen && (
                <div
                  ref={popoverRef}
                  className="absolute left-0 top-full mt-2 w-72 bg-white rounded-lg border border-slate-200 shadow-lg z-30"
                >
                  {showChapterSearch && (
                    <div className="p-2 border-b border-slate-100">
                      <input
                        type="text"
                        autoFocus
                        value={chapterFilter}
                        onChange={e => setChapterFilter(e.target.value)}
                        placeholder="Search chapters"
                        className="w-full px-2 py-1 text-sm bg-slate-50 rounded-md placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-emerald-400"
                      />
                    </div>
                  )}
                  <ul className="max-h-80 overflow-y-auto py-1">
                    {filteredChapters.length === 0 && (
                      <li className="px-3 py-2 text-sm text-slate-400 italic">
                        No matches
                      </li>
                    )}
                    {filteredChapters.map(ch => {
                      const active = ch.id === selectedChapterId
                      return (
                        <li key={ch.id}>
                          <button
                            onClick={() => {
                              onSelectChapter(ch.id)
                              setChaptersOpen(false)
                            }}
                            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                              active
                                ? 'text-emerald-700 font-medium bg-emerald-50/60'
                                : 'text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span className="flex-1 truncate">{ch.name}</span>
                            {active && (
                              <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={inChapterQuery}
                onChange={e => setInChapterQuery(e.target.value)}
                placeholder="Search in chapter… (Ctrl+F)"
                className="pl-8 pr-3 py-1.5 text-sm bg-slate-100 rounded-md w-64 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-emerald-400"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Reading column + right-side section TOC */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-10 scroll-smooth lg:grid lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-12">
        <div className="min-w-0">
          {chapterLoading && <ChapterSkeleton />}
          {!chapterLoading && chapter && (
            <ChapterBody content={chapter.content} highlight={inChapterQuery} />
          )}
          {!chapterLoading && !chapter && selectedChapterId === null && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <BookOpen className="h-12 w-12 text-slate-300 mb-3" />
              <p className="text-base">Pick a chapter to start reading.</p>
            </div>
          )}
        </div>
        {!chapterLoading && chapter && (
          <aside className="hidden lg:block">
            <ChapterToc content={chapter.content} />
          </aside>
        )}
      </div>
    </div>
  )
}

export default function BooksPage() {
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null)

  return (
    <div className="flex min-h-[calc(100vh-var(--app-header,4rem))] bg-white">
      {/* Library rail (left zone) */}
      <aside className="hidden md:block w-72 shrink-0 border-r border-slate-200 bg-white sticky top-0 self-start h-[calc(100vh-var(--app-header,4rem))] overflow-y-auto">
        <LibrarySidebar
          selectedBookId={selectedBookId}
          onSelectBook={id => {
            setSelectedBookId(id)
            setSelectedChapterId(null)
          }}
        />
      </aside>

      {/* Content zone */}
      <main className="flex-1 min-w-0">
        {selectedBookId === null ? (
          <div className="flex items-center justify-center min-h-[60vh] text-slate-400 text-sm">
            Pick a book from the library to start reading.
          </div>
        ) : (
          <BookReader
            bookId={selectedBookId}
            selectedChapterId={selectedChapterId}
            onSelectChapter={setSelectedChapterId}
          />
        )}
      </main>
    </div>
  )
}

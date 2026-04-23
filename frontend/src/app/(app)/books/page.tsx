'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'

interface Book {
  id: string
  title: string
  author: string
  year: number
  category: string
}

interface SearchResult {
  heading: string
  content_text: string
  books: { title: string; author: string }
}

export default function BooksPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])

  const { data: books = [] } = useQuery({
    queryKey: ['books'],
    queryFn: () => api.get<Book[]>('/books'),
  })

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const data = await api.get<SearchResult[]>(`/books/search?q=${encodeURIComponent(searchQuery)}`)
      setResults(data)
    } finally {
      setSearching(false)
    }
  }

  const categoryColors: Record<string, string> = {
    materia_medica: 'bg-purple-100 text-purple-700',
    clinical: 'bg-blue-100 text-blue-700',
    philosophy: 'bg-amber-100 text-amber-700',
    specialty: 'bg-green-100 text-green-700',
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reference Library</h1>
        <p className="text-sm text-gray-500 mt-1">565+ books — AI-powered semantic search</p>
      </div>

      {/* Semantic Search */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 mb-8 border border-blue-100">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">AI Book Search</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search across all books... e.g. 'Arsenicum album in anxiety'"
            className="flex-1 px-4 py-2 rounded-lg border border-blue-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>

        {results.length > 0 && (
          <div className="mt-4 space-y-3">
            {results.map((r, i) => (
              <div key={i} className="bg-white rounded-lg p-4 border border-blue-100">
                <p className="text-xs text-blue-600 font-medium">{r.books?.title} — {r.books?.author}</p>
                <p className="text-sm font-semibold text-gray-900 mt-1">{r.heading}</p>
                <p className="text-sm text-gray-600 mt-1 line-clamp-3">{r.content_text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Book Library */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {books.map(book => (
          <div key={book.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 cursor-pointer transition-colors">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mb-2 ${categoryColors[book.category] || 'bg-gray-100 text-gray-600'}`}>
              {book.category.replace('_', ' ')}
            </span>
            <h3 className="font-semibold text-gray-900 text-sm line-clamp-2">{book.title}</h3>
            <p className="text-xs text-gray-500 mt-1">{book.author}</p>
            {book.year && <p className="text-xs text-gray-400">{book.year}</p>}
          </div>
        ))}
      </div>

      {books.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p>No books available for your plan.</p>
          <p className="text-sm mt-1">Upgrade to Professional or higher to access 565+ reference books.</p>
        </div>
      )}
    </div>
  )
}

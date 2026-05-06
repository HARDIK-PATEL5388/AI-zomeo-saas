'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Upload, CheckCircle2, AlertCircle, Database, FileText, Loader2, ArrowRight,
  RefreshCw, BookPlus, Library, History,
} from 'lucide-react'

const MAX_FILE_MB = 300
const DEFAULT_PARSER_ID = 'complete_tab'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

type Step = 0 | 1 | 2 | 3 | 4 // 0=Book, 1=Upload, 2=Validate, 3=Import, 4=Complete

interface ParserInfo {
  id: string
  name: string
  description: string
  fileCount: number
  requiredCount: number
}
interface ParserFileSpec {
  name: string
  required: boolean
  minColumns?: number
  description?: string
}
interface ParserSpec {
  parser: { id: string; name: string; description: string }
  files: string[]
  optionalFiles: string[]
  fileSpec: ParserFileSpec[]
  importOrder: string[]
}

interface Book {
  id: number
  code: string
  name: string
  description?: string | null
  parser_type?: string
  sort_order: number
  chapter_count: number
  rubric_count: number
  created_at?: string
}
interface ValidationIssue { file: string; problem: string }
interface FilePreview {
  file: string
  totalRows: number
  parsedRows: number
  newRows: number
  existingRows: number
  toUpdateRows: number
  unchangedRows: number
  skippedRows: number
}
interface PreviewTotals {
  totalRows: number; parsedRows: number; newRows: number; existingRows: number
  toUpdateRows: number; skippedRows: number
}
interface FileSummary {
  file: string
  status: 'SYNCED' | 'UNCHANGED' | 'MISSING' | 'FAILED'
  added?: number; updated?: number; skipped?: number
  error?: string; durationMs?: number; hash?: string
}
interface BookHistory {
  code: string
  name: string
  entries: Array<{
    id: number
    job_id: number
    file_name: string
    status: string
    error_msg?: string | null
    rows_added?: number
    rows_updated?: number
    rows_skipped?: number
    imported_at: string
    md5_hash: string
  }>
}

function normalizeCode(raw: string): string {
  // Mirrors backend: first token only → "Kent Repertory" becomes "kent".
  const first = raw.toLowerCase().trim().split(/\s+/)[0] ?? ''
  return first
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export default function RepertoryUploadPage() {
  const [step, setStep] = useState<Step>(0)

  // Step 0 — book selection
  const [books, setBooks] = useState<Book[]>([])
  const [booksLoading, setBooksLoading] = useState(true)
  const [parsers, setParsers] = useState<ParserInfo[]>([])
  const [parsersLoading, setParsersLoading] = useState(true)
  const [bookMode, setBookMode] = useState<'existing' | 'new'>('existing')
  const [selectedBookCode, setSelectedBookCode] = useState<string>('')
  const [newBookCode, setNewBookCode] = useState<string>('')
  const [newBookName, setNewBookName] = useState<string>('')
  const [newBookParser, setNewBookParser] = useState<string>(DEFAULT_PARSER_ID)
  const [bookSubmitting, setBookSubmitting] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)

  // Parser-driven file contract for the selected book
  const [parserSpec, setParserSpec] = useState<ParserSpec | null>(null)
  const [parserSpecLoading, setParserSpecLoading] = useState(false)

  // Step 1 — files
  const [files, setFiles] = useState<File[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Step 2 — validation
  const [validating, setValidating] = useState(false)
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [preview, setPreview] = useState<FilePreview[] | null>(null)
  const [previewTotals, setPreviewTotals] = useState<PreviewTotals | null>(null)

  // Step 3 — import
  const [importing, setImporting] = useState(false)
  const [jobId, setJobId] = useState<number | null>(null)
  const [logs, setLogs] = useState<{ file: string; message: string; time: string }[]>([])
  const [summary, setSummary] = useState<FileSummary[] | null>(null)
  const [importDurationMs, setImportDurationMs] = useState<number | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number>(0)

  // History
  const [history, setHistory] = useState<BookHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  useEffect(() => () => { sseRef.current?.close() }, [])

  const filesByName = useMemo(() => {
    const m = new Map<string, File>()
    for (const f of files) m.set(f.name, f)
    return m
  }, [files])

  const requiredFiles = parserSpec?.files ?? []
  const optionalFiles = parserSpec?.optionalFiles ?? []
  const allRequiredPresent =
    requiredFiles.length > 0 && requiredFiles.every(name => filesByName.has(name))

  const activeBook: Book | null = useMemo(() => {
    if (bookMode === 'existing') return books.find(b => b.code === selectedBookCode) ?? null
    if (newBookCode && newBookName) {
      return {
        id: -1,
        code: normalizeCode(newBookCode),
        name: newBookName,
        parser_type: newBookParser,
        sort_order: 999,
        chapter_count: 0,
        rubric_count: 0,
      }
    }
    return null
  }, [bookMode, books, selectedBookCode, newBookCode, newBookName, newBookParser])

  const targetBookCode = activeBook?.code ?? ''
  const targetBookName = activeBook?.name ?? ''
  const targetParserId =
    activeBook?.parser_type ||
    (bookMode === 'new' ? newBookParser : DEFAULT_PARSER_ID)

  async function loadBooks() {
    setBooksLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/repertory-upload/books`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const list: Book[] = data.data ?? []
      setBooks(list)
      if (list.length > 0 && !selectedBookCode) {
        setSelectedBookCode(list.find(b => b.code === 'complete')?.code ?? list[0].code)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBooksLoading(false)
    }
  }

  async function loadHistory() {
    setHistoryLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/repertory-upload/jobs/by-book?limit=200`)
      const data = await res.json()
      if (res.ok) setHistory(data.data ?? [])
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadParsers() {
    setParsersLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/repertory-upload/parsers`)
      const data = await res.json()
      if (res.ok) setParsers(data.data ?? [])
    } catch {/* non-fatal — wizard still works with the default */}
    finally {
      setParsersLoading(false)
    }
  }

  useEffect(() => { loadBooks(); loadHistory(); loadParsers() }, [])

  // Re-fetch the parser file contract whenever the target parser id changes.
  useEffect(() => {
    if (!targetParserId) { setParserSpec(null); return }
    let cancelled = false
    setParserSpecLoading(true)
    fetch(`${API_URL}/api/repertory-upload/required?parser=${encodeURIComponent(targetParserId)}`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok) { setParserSpec(null); setError(d?.error || 'Failed to load parser spec'); return }
        setParserSpec(d as ParserSpec)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setParserSpecLoading(false) })
    return () => { cancelled = true }
  }, [targetParserId])

  async function handleConfirmBook() {
    setBookError(null)

    if (bookMode === 'existing') {
      if (!selectedBookCode) { setBookError('Pick a book or switch to "Create new"'); return }
      setStep(1)
      return
    }

    const code = normalizeCode(newBookCode)
    if (!code || code.length < 2) { setBookError('Book code is required (≥2 chars after normalization)'); return }
    if (!newBookName.trim())     { setBookError('Book name is required'); return }
    if (books.some(b => b.code === code)) {
      setBookError(`Code "${code}" already exists. Pick the existing book instead.`)
      return
    }

    setBookSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/repertory-upload/books`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name: newBookName.trim(), parserType: newBookParser }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const created: Book = data.data
      setBooks(prev => [...prev, created].sort((a, b) => a.sort_order - b.sort_order))
      setSelectedBookCode(created.code)
      setBookMode('existing')
      setNewBookCode('')
      setNewBookName('')
      setNewBookParser(DEFAULT_PARSER_ID)
      setStep(1)
    } catch (e: any) {
      setBookError(e.message)
    } finally {
      setBookSubmitting(false)
    }
  }

  function buildFormData(extra: Record<string, string> = {}) {
    const fd = new FormData()
    for (const f of files) fd.append('files', f, f.name)
    fd.append('bookCode', targetBookCode)
    if (targetBookName) fd.append('bookName', targetBookName)
    if (targetParserId) fd.append('parserType', targetParserId)
    for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    return fd
  }

  // The parser tells us which extensions are acceptable. If we haven't loaded
  // the spec yet, fall back to the broadest set that the backend accepts.
  const allowedExtensions = useMemo(() => {
    const exts = new Set<string>()
    for (const name of [...requiredFiles, ...optionalFiles]) {
      const dot = name.lastIndexOf('.')
      if (dot >= 0) exts.add(name.slice(dot).toLowerCase())
    }
    if (exts.size === 0) { exts.add('.tab'); exts.add('.csv'); exts.add('.txt'); exts.add('.rtf') }
    return exts
  }, [requiredFiles, optionalFiles])

  function onPickFiles(picked: FileList | null) {
    if (!picked) return
    const accepted = Array.from(picked).filter(f => {
      const lower = f.name.toLowerCase()
      const dot = lower.lastIndexOf('.')
      return dot >= 0 && allowedExtensions.has(lower.slice(dot))
    })
    const oversized = accepted.filter(f => f.size > MAX_FILE_MB * 1024 * 1024)
    if (oversized.length > 0) {
      setError(`File(s) exceed ${MAX_FILE_MB} MB: ${oversized.map(f => f.name).join(', ')}`)
      return
    }
    setFiles(accepted)
    setError(null)
    setPreview(null)
    setPreviewTotals(null)
    setValidationIssues([])
  }

  async function handleValidate() {
    setValidating(true)
    setError(null)
    setValidationIssues([])
    setPreview(null)
    setPreviewTotals(null)
    try {
      const valRes = await fetch(`${API_URL}/api/repertory-upload/validate`, {
        method: 'POST', body: buildFormData(),
      })
      const valData = await valRes.json()
      if (!valRes.ok) throw new Error(valData.error || `HTTP ${valRes.status}`)
      if (!valData.valid) {
        setValidationIssues(valData.issues || [])
        setStep(2)
        return
      }
      const prevRes = await fetch(`${API_URL}/api/repertory-upload/preview`, {
        method: 'POST', body: buildFormData(),
      })
      const prevData = await prevRes.json()
      if (!prevRes.ok) throw new Error(prevData.error || `HTTP ${prevRes.status}`)
      setPreview(prevData.preview)
      setPreviewTotals(prevData.totals)
      setStep(2)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setValidating(false)
    }
  }

  async function handleImport() {
    setImporting(true)
    setError(null)
    setLogs([])
    setSummary(null)
    setImportDurationMs(null)
    setUploadProgress(0)
    setStep(3)

    const startedAt = Date.now()
    try {
      const newJobId = await uploadWithProgress(
        `${API_URL}/api/repertory-upload/import-async`,
        buildFormData(),
        (frac) => setUploadProgress(frac),
      )
      setJobId(newJobId)
      streamProgress(newJobId, startedAt)
    } catch (e: any) {
      setError(e.message)
      setImporting(false)
    }
  }

  function streamProgress(id: number, startedAt: number) {
    sseRef.current?.close()
    const ev = new EventSource(`${API_URL}/api/repertory-upload/jobs/${id}/stream`)
    sseRef.current = ev
    ev.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data)
        if (data.type === 'complete') {
          setSummary(data.summary || [])
          setImportDurationMs(Date.now() - startedAt)
          setImporting(false)
          setStep(4)
          ev.close()
          sseRef.current = null
          loadBooks()
          loadHistory()
          return
        }
        setLogs(prev => [...prev, data])
      } catch { /* ignore */ }
    }
    ev.onerror = () => {
      ev.close()
      sseRef.current = null
      setImporting(false)
    }
  }

  function reset() {
    sseRef.current?.close()
    sseRef.current = null
    setStep(0)
    setFiles([])
    setValidationIssues([])
    setPreview(null)
    setPreviewTotals(null)
    setLogs([])
    setSummary(null)
    setJobId(null)
    setError(null)
    setImportDurationMs(null)
    setUploadProgress(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  const importTotals = useMemo(() => {
    if (!summary) return null
    return summary.reduce(
      (a, s) => ({
        added:   a.added   + (s.added   ?? 0),
        updated: a.updated + (s.updated ?? 0),
        skipped: a.skipped + (s.skipped ?? 0),
        failed:  a.failed  + (s.status === 'FAILED' ? 1 : 0),
      }),
      { added: 0, updated: 0, skipped: 0, failed: 0 },
    )
  }, [summary])

  const codePreview = bookMode === 'new' ? normalizeCode(newBookCode) : ''

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Repertory Data Upload</h1>
          <p className="text-sm text-gray-500 mt-1">
            Import repertory <code>.tab</code> files into a target book.
          </p>
        </div>
        {activeBook && step > 0 && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-gray-500">Target book</p>
            <p className="text-sm font-medium text-gray-900">
              {activeBook.name} <span className="text-gray-400 font-normal">({activeBook.code})</span>
            </p>
          </div>
        )}
      </div>

      <Stepper current={step} />

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}

      {/* STEP 0: Select / Create Book */}
      {step === 0 && (
        <Card title="Step 1 — Select / Create Book" icon={<Library className="w-4 h-4" />}>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => { setBookMode('existing'); setBookError(null) }}
              className={`px-3 py-1.5 text-sm rounded border ${
                bookMode === 'existing' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-700'
              }`}
            >
              Use existing book
            </button>
            <button
              onClick={() => { setBookMode('new'); setBookError(null) }}
              className={`px-3 py-1.5 text-sm rounded border ${
                bookMode === 'new' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-700'
              }`}
            >
              <span className="inline-flex items-center gap-1.5"><BookPlus className="w-3.5 h-3.5" /> Create new book</span>
            </button>
          </div>

          {bookMode === 'existing' ? (
            <Field label="Existing book">
              {booksLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading books…
                </div>
              ) : books.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No books yet. Switch to “Create new book”.
                </p>
              ) : (
                <>
                  <select
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={selectedBookCode}
                    onChange={(e) => setSelectedBookCode(e.target.value)}
                  >
                    {books.map(b => (
                      <option key={b.code} value={b.code}>
                        {b.name} ({b.code}) — {b.chapter_count} chapters · {b.rubric_count.toLocaleString()} rubrics
                      </option>
                    ))}
                  </select>
                  {activeBook?.parser_type && (
                    <p className="text-xs text-gray-500 mt-1">
                      Parser: <code className="px-1 bg-gray-100 rounded">{activeBook.parser_type}</code>
                      {parserSpec && <> · {parserSpec.parser.name}</>}
                    </p>
                  )}
                </>
              )}
            </Field>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Book Code (required)">
                <input
                  type="text"
                  placeholder="e.g. kent"
                  className="w-full border rounded px-3 py-2 text-sm font-mono"
                  value={newBookCode}
                  onChange={(e) => setNewBookCode(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Normalized: <code className="px-1 bg-gray-100 rounded">{codePreview || '—'}</code>
                  {books.some(b => b.code === codePreview) && (
                    <span className="ml-2 text-red-600">(already exists)</span>
                  )}
                </p>
              </Field>
              <Field label="Book Name (required)">
                <input
                  type="text"
                  placeholder="e.g. Kent Repertory"
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={newBookName}
                  onChange={(e) => setNewBookName(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">Display name shown in browser.</p>
              </Field>
              <Field label="Parser type (required)">
                {parsersLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading parsers…
                  </div>
                ) : (
                  <select
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={newBookParser}
                    onChange={(e) => setNewBookParser(e.target.value)}
                  >
                    {parsers.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id}) — {p.requiredCount} required file{p.requiredCount === 1 ? '' : 's'}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Determines which files this book accepts.
                </p>
              </Field>
            </div>
          )}

          {bookError && (
            <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{bookError}</div>
          )}

          <div className="mt-6 flex justify-end">
            <PrimaryButton onClick={handleConfirmBook} disabled={bookSubmitting}>
              {bookSubmitting ? (<><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Creating…</>)
                : (<>Continue <ArrowRight className="w-4 h-4 ml-1" /></>)}
            </PrimaryButton>
          </div>

          <UploadHistory history={history} loading={historyLoading} />
        </Card>
      )}

      {/* STEP 1: Upload Files */}
      {step === 1 && (
        <Card title="Step 2 — Upload Files" icon={<Upload className="w-4 h-4" />}>
          <p className="text-sm text-gray-600 mb-3">
            Importing into <b>{targetBookName}</b> <span className="text-gray-500">({targetBookCode})</span>{' '}
            via <b>{parserSpec?.parser.name ?? targetParserId}</b>.
            {parserSpec && (
              <> Select all {requiredFiles.length} required file{requiredFiles.length === 1 ? '' : 's'}
                {optionalFiles.length > 0 && <> (and up to {optionalFiles.length} optional)</>}.
              </>
            )}
          </p>

          <div
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition"
          >
            <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
            <p className="text-sm text-gray-600">Click to choose files (multi-select)</p>
            <p className="text-xs text-gray-400 mt-1">
              Accepted: {Array.from(allowedExtensions).sort().join(', ')}
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={Array.from(allowedExtensions).sort().join(',')}
              hidden
              onChange={(e) => onPickFiles(e.target.files)}
            />
          </div>

          {parserSpecLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading parser file list…
            </div>
          ) : (
            <>
              {requiredFiles.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">Required</p>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {requiredFiles.map((name) => {
                      const f = filesByName.get(name)
                      const spec = parserSpec?.fileSpec.find(s => s.name === name)
                      return (
                        <div key={name} className={`flex items-center justify-between border rounded px-3 py-2 ${f ? 'bg-green-50 border-green-200' : 'bg-gray-50'}`}>
                          <div className="flex items-center gap-2 text-sm min-w-0">
                            {f
                              ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                              : <FileText className="w-4 h-4 text-gray-400 shrink-0" />}
                            <div className="min-w-0">
                              <div className="font-mono text-gray-800 truncate">{name}</div>
                              {spec?.description && (
                                <div className="text-[11px] text-gray-500 truncate">{spec.description}</div>
                              )}
                            </div>
                          </div>
                          <span className={`text-xs shrink-0 ${f ? 'text-green-700' : 'text-gray-400'}`}>
                            {f ? `${(f.size / 1024 / 1024).toFixed(2)} MB` : 'missing'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {optionalFiles.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">Optional</p>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {optionalFiles.map((name) => {
                      const f = filesByName.get(name)
                      const spec = parserSpec?.fileSpec.find(s => s.name === name)
                      return (
                        <div key={name} className={`flex items-center justify-between border rounded px-3 py-2 ${f ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'}`}>
                          <div className="flex items-center gap-2 text-sm min-w-0">
                            {f
                              ? <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                              : <FileText className="w-4 h-4 text-gray-300 shrink-0" />}
                            <div className="min-w-0">
                              <div className="font-mono text-gray-800 truncate">{name}</div>
                              {spec?.description && (
                                <div className="text-[11px] text-gray-500 truncate">{spec.description}</div>
                              )}
                            </div>
                          </div>
                          <span className="text-xs shrink-0 text-gray-400">
                            {f ? `${(f.size / 1024 / 1024).toFixed(2)} MB` : 'optional'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {!allRequiredPresent && files.length > 0 && (
            <div className="mt-3 text-xs text-amber-700">
              Missing {requiredFiles.filter(n => !filesByName.has(n)).length} required file(s).
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <SecondaryButton onClick={() => setStep(0)}>Back</SecondaryButton>
            <PrimaryButton
              disabled={!allRequiredPresent || validating || parserSpecLoading}
              onClick={handleValidate}
            >
              {validating ? (<><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Validating…</>) :
                (<>Validate <ArrowRight className="w-4 h-4 ml-1" /></>)}
            </PrimaryButton>
          </div>
        </Card>
      )}

      {/* STEP 2: Validation */}
      {step === 2 && (
        <Card title="Step 3 — Validate" icon={<CheckCircle2 className="w-4 h-4" />}>
          {validationIssues.length > 0 ? (
            <>
              <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
                <h3 className="font-medium text-red-700 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> Validation failed
                </h3>
                <ul className="text-sm text-red-700 space-y-1">
                  {validationIssues.map((i, idx) => (
                    <li key={idx}>• <b>{i.file}</b>: {i.problem}</li>
                  ))}
                </ul>
              </div>
              <div className="flex justify-between">
                <SecondaryButton onClick={() => setStep(1)}>Back</SecondaryButton>
                <PrimaryButton onClick={handleValidate} disabled={validating}>
                  <RefreshCw className="w-4 h-4 mr-1" /> Retry
                </PrimaryButton>
              </div>
            </>
          ) : preview && previewTotals ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Stat label="New records"      value={previewTotals.newRows}      tone="green" />
                <Stat label="Existing records" value={previewTotals.existingRows} tone="blue" />
                <Stat label="To update"        value={previewTotals.toUpdateRows} tone="amber" />
                <Stat label="Total parsed"     value={previewTotals.parsedRows}   tone="gray" />
              </div>

              <div className="bg-white border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">File</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">New</th>
                      <th className="px-3 py-2 text-right">Existing</th>
                      <th className="px-3 py-2 text-right">Will Update</th>
                      <th className="px-3 py-2 text-right">Skipped</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.map(p => (
                      <tr key={p.file}>
                        <td className="px-3 py-2 font-mono">{p.file}</td>
                        <td className="px-3 py-2 text-right">{p.totalRows.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-green-700">{p.newRows.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-blue-700">{p.existingRows.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-amber-700">{p.toUpdateRows.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{p.skippedRows.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-gray-500 mt-3">
                Target: <b>{targetBookName}</b> <span className="font-mono">({targetBookCode})</span>
              </p>

              <div className="mt-6 flex justify-between">
                <SecondaryButton onClick={() => setStep(1)}>Back</SecondaryButton>
                <PrimaryButton onClick={handleImport} disabled={importing}>
                  Confirm & Import <ArrowRight className="w-4 h-4 ml-1" />
                </PrimaryButton>
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading preview…
            </div>
          )}
        </Card>
      )}

      {/* STEP 3: Importing */}
      {step === 3 && (
        <Card title="Step 4 — Importing" icon={<Loader2 className="w-4 h-4 animate-spin" />}>
          <p className="text-sm text-gray-600 mb-3">
            Job <span className="font-mono">#{jobId ?? '...'}</span> · Importing into <b>{targetBookName}</b>{' '}
            <span className="text-gray-500 font-mono">({targetBookCode})</span>
          </p>

          {uploadProgress > 0 && uploadProgress < 1 && (
            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Uploading files…</span>
                <span>{Math.round(uploadProgress * 100)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${uploadProgress * 100}%` }}
                />
              </div>
            </div>
          )}

          <PerFileProgress files={parserSpec?.importOrder ?? requiredFiles} logs={logs} />

          <div className="mt-4 bg-black text-green-300 font-mono text-xs rounded p-3 max-h-48 overflow-y-auto">
            {logs.length === 0 && <div className="text-gray-500">Connecting to import job…</div>}
            {logs.map((l, i) => (
              <div key={i}>
                <span className="text-gray-500">[{new Date(l.time).toLocaleTimeString()}]</span>{' '}
                <span className="text-yellow-300">{l.file.padEnd(18, ' ')}</span> {l.message}
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 mt-3">
            Don't close this tab. Importing the largest file (Remlist) can take ~1 minute.
          </p>
        </Card>
      )}

      {/* STEP 4: Complete */}
      {step === 4 && summary && importTotals && (
        <Card
          title="Step 5 — Complete"
          icon={importTotals.failed > 0
            ? <AlertCircle className="w-4 h-4 text-red-600" />
            : <CheckCircle2 className="w-4 h-4 text-green-600" />}
        >
          <div className={`rounded-lg p-4 mb-4 border ${
            importTotals.failed > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
          }`}>
            <h3 className={`font-medium ${importTotals.failed > 0 ? 'text-red-700' : 'text-green-700'}`}>
              {importTotals.failed > 0 ? 'Import finished with errors' : 'Import successful'}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Job #{jobId} · Book <b>{targetBookName}</b> · Duration {importDurationMs ? `${(importDurationMs / 1000).toFixed(1)}s` : '—'}
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Total inserted" value={importTotals.added}   tone="green" />
            <Stat label="Total updated"  value={importTotals.updated} tone="blue" />
            <Stat label="Total skipped"  value={importTotals.skipped} tone="gray" />
            <Stat label="Failed files"   value={importTotals.failed}  tone={importTotals.failed > 0 ? 'red' : 'gray'} />
          </div>

          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Added</th>
                  <th className="px-3 py-2 text-right">Updated</th>
                  <th className="px-3 py-2 text-right">Skipped</th>
                  <th className="px-3 py-2 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summary.map(s => (
                  <tr key={s.file}>
                    <td className="px-3 py-2 font-mono">{s.file}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{s.added?.toLocaleString() ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{s.updated?.toLocaleString() ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{s.skipped?.toLocaleString() ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">
                      {s.durationMs != null ? `${(s.durationMs / 1000).toFixed(2)}s` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-between">
            {importTotals.failed > 0 && (
              <SecondaryButton onClick={handleImport}>
                <RefreshCw className="w-4 h-4 mr-1" /> Retry import
              </SecondaryButton>
            )}
            <div className="ml-auto">
              <PrimaryButton onClick={reset}>Finish</PrimaryButton>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

function uploadWithProgress(
  url: string,
  body: FormData,
  onProgress: (frac: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.upload.onload = () => onProgress(1)
    xhr.onload = () => {
      let parsed: any = null
      try { parsed = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && parsed?.jobId) {
        resolve(parsed.jobId as number)
      } else {
        reject(new Error(parsed?.error || `HTTP ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(body)
  })
}

// --- UI helpers --------------------------------------------------------------

function Stepper({ current }: { current: Step }) {
  const labels = ['Select / Create Book', 'Upload Files', 'Validate', 'Import', 'Complete']
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {labels.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={label} className="flex items-center gap-2 flex-shrink-0">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              done ? 'bg-green-600 text-white' :
              active ? 'bg-blue-600 text-white' :
              'bg-gray-200 text-gray-500'
            }`}>
              {done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
            </div>
            <span className={`text-sm whitespace-nowrap ${
              done ? 'text-gray-500' : active ? 'text-gray-900 font-medium' : 'text-gray-400'
            }`}>{label}</span>
            {i < labels.length - 1 && <div className={`w-8 h-px ${done ? 'bg-green-300' : 'bg-gray-300'}`} />}
          </div>
        )
      })}
    </div>
  )
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-6 bg-white border rounded-lg p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-blue-600">{icon}</div>
        <h2 className="font-medium text-gray-900">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

function PrimaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="inline-flex items-center px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  )
}

function SecondaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="inline-flex items-center px-4 py-2 rounded border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
    >
      {children}
    </button>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'green' | 'blue' | 'amber' | 'red' | 'gray' }) {
  const colors: Record<string, string> = {
    green: 'bg-green-50 border-green-200 text-green-700',
    blue:  'bg-blue-50 border-blue-200 text-blue-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red:   'bg-red-50 border-red-200 text-red-700',
    gray:  'bg-gray-50 border-gray-200 text-gray-700',
  }
  return (
    <div className={`border rounded-lg px-4 py-3 ${colors[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-75">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString()}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: FileSummary['status'] | string }) {
  const styles: Record<string, string> = {
    SYNCED:    'bg-green-100 text-green-700',
    UNCHANGED: 'bg-gray-100 text-gray-700',
    MISSING:   'bg-amber-100 text-amber-700',
    FAILED:    'bg-red-100 text-red-700',
    done:      'bg-green-100 text-green-700',
    failed:    'bg-red-100 text-red-700',
    processing:'bg-blue-100 text-blue-700',
  }
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[status] ?? 'bg-gray-100 text-gray-700'}`}>{status}</span>
}

function PerFileProgress({ files, logs }: { files: string[]; logs: { file: string; message: string }[] }) {
  const fileState = new Map<string, 'pending' | 'importing' | 'done' | 'unchanged' | 'failed'>()
  for (const f of files) fileState.set(f, 'pending')
  for (const l of logs) {
    if (l.message.startsWith('Importing')) fileState.set(l.file, 'importing')
    else if (l.message.startsWith('Done')) fileState.set(l.file, 'done')
    else if (l.message.startsWith('Skipped')) fileState.set(l.file, 'unchanged')
    else if (l.message.startsWith('FAILED')) fileState.set(l.file, 'failed')
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {files.map((file) => {
        const state = fileState.get(file)!
        return (
          <div key={file} className={`flex items-center justify-between border rounded px-3 py-2 text-sm ${
            state === 'done' || state === 'unchanged' ? 'bg-green-50 border-green-200' :
            state === 'importing' ? 'bg-blue-50 border-blue-200' :
            state === 'failed' ? 'bg-red-50 border-red-200' :
            'bg-gray-50'
          }`}>
            <span className="font-mono text-gray-800">{file}</span>
            <span className="text-xs flex items-center gap-1">
              {state === 'pending' && <span className="text-gray-400">waiting</span>}
              {state === 'importing' && (<><Loader2 className="w-3 h-3 animate-spin text-blue-600" /><span className="text-blue-700">importing</span></>)}
              {state === 'done' && (<><CheckCircle2 className="w-3 h-3 text-green-600" /><span className="text-green-700">done</span></>)}
              {state === 'unchanged' && (<><CheckCircle2 className="w-3 h-3 text-gray-500" /><span className="text-gray-600">unchanged</span></>)}
              {state === 'failed' && (<><AlertCircle className="w-3 h-3 text-red-600" /><span className="text-red-700">failed</span></>)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function UploadHistory({ history, loading }: { history: BookHistory[]; loading: boolean }) {
  return (
    <div className="mt-8 pt-6 border-t">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-medium text-gray-700">Upload history</h3>
      </div>
      {loading ? (
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : history.length === 0 ? (
        <p className="text-sm text-gray-400">No uploads yet.</p>
      ) : (
        <div className="space-y-3">
          {history.map(h => (
            <div key={h.code} className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-white border-b text-sm font-medium text-gray-800 flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-gray-500" />
                {h.name} <span className="text-xs text-gray-400 font-normal">({h.code})</span>
                <span className="ml-auto text-xs text-gray-500">{h.entries.length} files</span>
              </div>
              <table className="w-full text-xs">
                <thead className="text-left text-gray-500 bg-gray-50">
                  <tr>
                    <th className="px-3 py-1.5">File</th>
                    <th className="px-3 py-1.5">Status</th>
                    <th className="px-3 py-1.5 text-right">Added</th>
                    <th className="px-3 py-1.5 text-right">Updated</th>
                    <th className="px-3 py-1.5 text-right">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {h.entries.slice(0, 10).map(e => (
                    <tr key={e.id}>
                      <td className="px-3 py-1 font-mono">{e.file_name}</td>
                      <td className="px-3 py-1"><StatusBadge status={e.status} /></td>
                      <td className="px-3 py-1 text-right">{e.rows_added?.toLocaleString() ?? '—'}</td>
                      <td className="px-3 py-1 text-right">{e.rows_updated?.toLocaleString() ?? '—'}</td>
                      <td className="px-3 py-1 text-right text-gray-500">
                        {new Date(e.imported_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

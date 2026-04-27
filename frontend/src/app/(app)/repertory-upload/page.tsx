'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, CheckCircle2, AlertCircle, Database, FileText, Loader2, ArrowRight, RefreshCw } from 'lucide-react'

// FIX B18 — client-side file size sanity (matches backend MAX_FILE_BYTES)
const MAX_FILE_MB = 300

const REQUIRED = [
  'RemID.tab',
  'REPolar.tab',
  'Complete.tab',
  'Pagerefs.tab',
  'LibraryIndex.tab',
  'PapaSub.tab',
  'Remlist.tab',
  'Xrefs.tab',
] as const

const REPERTORY_SOURCES = [
  { id: 'complete-2024', name: 'Complete Repertory' },
  { id: 'kent', name: 'Kent Repertory' },
  { id: 'boericke', name: "Boericke's Repertory" },
  { id: 'synthesis', name: 'Synthesis Repertory' },
] as const

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

type Step = 0 | 1 | 2 | 3 | 4 // 0=Source, 1=Upload, 2=Validate, 3=Import, 4=Complete

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

export default function RepertoryUploadPage() {
  const [step, setStep] = useState<Step>(0)

  // Step 0
  const [source, setSource] = useState<string>(REPERTORY_SOURCES[0].id)
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [version, setVersion] = useState<string>('v1.0')

  // Step 1
  const [files, setFiles] = useState<File[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Step 2
  const [validating, setValidating] = useState(false)
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [preview, setPreview] = useState<FilePreview[] | null>(null)
  const [previewTotals, setPreviewTotals] = useState<PreviewTotals | null>(null)

  // Step 3
  const [importing, setImporting] = useState(false)
  const [jobId, setJobId] = useState<number | null>(null)
  const [logs, setLogs] = useState<{ file: string; message: string; time: string }[]>([])
  const [summary, setSummary] = useState<FileSummary[] | null>(null)
  const [importDurationMs, setImportDurationMs] = useState<number | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number>(0) // 0..1

  // Errors
  const [error, setError] = useState<string | null>(null)

  // FIX B16 — track open EventSource so we can close on unmount/reset
  const sseRef = useRef<EventSource | null>(null)
  useEffect(() => () => { sseRef.current?.close() }, [])

  const filesByName = useMemo(() => {
    const m = new Map<string, File>()
    for (const f of files) m.set(f.name, f)
    return m
  }, [files])

  const allRequiredPresent = REQUIRED.every(name => filesByName.has(name))

  function buildFormData(extra: Record<string, string> = {}) {
    const fd = new FormData()
    for (const f of files) fd.append('files', f, f.name)
    for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    return fd
  }

  function onPickFiles(picked: FileList | null) {
    if (!picked) return
    const onlyTab = Array.from(picked).filter(f => f.name.toLowerCase().endsWith('.tab'))
    // FIX B18 — reject oversized files client-side
    const oversized = onlyTab.filter(f => f.size > MAX_FILE_MB * 1024 * 1024)
    if (oversized.length > 0) {
      setError(`File(s) exceed ${MAX_FILE_MB} MB: ${oversized.map(f => f.name).join(', ')}`)
      return
    }
    setFiles(onlyTab)
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
      // 1. backend filename + format validation
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
      // 2. preview new/existing/update counts
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

    // Capture startedAt LOCALLY (FIX B15 — no React-state stale-closure trap)
    const startedAt = Date.now()

    try {
      // FIX B17 — XHR for real upload progress events (fetch can't report them)
      const newJobId = await uploadWithProgress(
        `${API_URL}/api/repertory-upload/import-async`,
        buildFormData({ source, year: String(year), version }),
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
    sseRef.current?.close() // FIX B16 — close any prior stream
    const ev = new EventSource(`${API_URL}/api/repertory-upload/jobs/${id}/stream`)
    sseRef.current = ev
    ev.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data)
        if (data.type === 'complete') {
          setSummary(data.summary || [])
          setImportDurationMs(Date.now() - startedAt) // FIX B15 — use local startedAt
          setImporting(false)
          setStep(4)
          ev.close()
          sseRef.current = null
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

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Repertory Data Upload</h1>
        <p className="text-sm text-gray-500 mt-1">
          Import Complete Repertory data from <code>.tab</code> files into PostgreSQL.
        </p>
      </div>

      <Stepper current={step} />

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}

      {/* STEP 0: Select Repertory */}
      {step === 0 && (
        <Card title="Step 1 — Select Repertory" icon={<Database className="w-4 h-4" />}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Repertory Source">
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                {REPERTORY_SOURCES.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Year">
              <input
                type="number"
                min={1900}
                max={2100}
                className="w-full border rounded px-3 py-2 text-sm"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value) || year)}
              />
            </Field>
            <Field label="Version">
              <input
                type="text"
                placeholder="e.g. v1.0"
                className="w-full border rounded px-3 py-2 text-sm"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-6 flex justify-end">
            <PrimaryButton onClick={() => setStep(1)}>
              Continue <ArrowRight className="w-4 h-4 ml-1" />
            </PrimaryButton>
          </div>
        </Card>
      )}

      {/* STEP 1: Upload Files */}
      {step === 1 && (
        <Card title="Step 2 — Upload TAB Files" icon={<Upload className="w-4 h-4" />}>
          <p className="text-sm text-gray-600 mb-3">
            Select all 7 required <code>.tab</code> files for the Complete Repertory.
          </p>

          <div
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition"
          >
            <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
            <p className="text-sm text-gray-600">Click to choose files (multi-select)</p>
            <p className="text-xs text-gray-400 mt-1">.tab only</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".tab"
              hidden
              onChange={(e) => onPickFiles(e.target.files)}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
            {REQUIRED.map((name) => {
              const f = filesByName.get(name)
              return (
                <div key={name} className={`flex items-center justify-between border rounded px-3 py-2 ${f ? 'bg-green-50 border-green-200' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-2 text-sm">
                    {f
                      ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                      : <FileText className="w-4 h-4 text-gray-400" />}
                    <span className="font-mono text-gray-800">{name}</span>
                  </div>
                  <span className={`text-xs ${f ? 'text-green-700' : 'text-gray-400'}`}>
                    {f ? `${(f.size / 1024 / 1024).toFixed(2)} MB` : 'missing'}
                  </span>
                </div>
              )
            })}
          </div>

          {!allRequiredPresent && files.length > 0 && (
            <div className="mt-3 text-xs text-amber-700">
              Missing {REQUIRED.filter(n => !filesByName.has(n)).length} required file(s).
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <SecondaryButton onClick={() => setStep(0)}>Back</SecondaryButton>
            <PrimaryButton
              disabled={!allRequiredPresent || validating}
              onClick={handleValidate}
            >
              {validating ? (<><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Validating…</>) :
                (<>Validate <ArrowRight className="w-4 h-4 ml-1" /></>)}
            </PrimaryButton>
          </div>
        </Card>
      )}

      {/* STEP 2: Validation Result */}
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
                Source: <b>{REPERTORY_SOURCES.find(s => s.id === source)?.name}</b> · Year: <b>{year}</b> · Version: <b>{version}</b>
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

      {/* STEP 3: Import Live */}
      {step === 3 && (
        <Card title="Step 4 — Importing to Database" icon={<Loader2 className="w-4 h-4 animate-spin" />}>
          <p className="text-sm text-gray-600 mb-3">
            Job <span className="font-mono">#{jobId ?? '...'}</span> · Source <b>{source}</b> · Year <b>{year}</b> · Version <b>{version}</b>
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

          <PerFileProgress logs={logs} />

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
              Job #{jobId} · Duration {importDurationMs ? `${(importDurationMs / 1000).toFixed(1)}s` : '—'}
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
              <PrimaryButton onClick={reset}>
                Finish
              </PrimaryButton>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

// FIX B17 — XHR-based POST that emits real upload-progress events
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
  const labels = ['Select Repertory', 'Upload Files', 'Validate', 'Import', 'Complete']
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

function StatusBadge({ status }: { status: FileSummary['status'] }) {
  const styles: Record<string, string> = {
    SYNCED:    'bg-green-100 text-green-700',
    UNCHANGED: 'bg-gray-100 text-gray-700',
    MISSING:   'bg-amber-100 text-amber-700',
    FAILED:    'bg-red-100 text-red-700',
  }
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[status]}`}>{status}</span>
}

function PerFileProgress({ logs }: { logs: { file: string; message: string }[] }) {
  const fileState = new Map<string, 'pending' | 'importing' | 'done' | 'unchanged' | 'failed'>()
  for (const f of REQUIRED) fileState.set(f, 'pending')
  for (const l of logs) {
    if (l.message.startsWith('Importing')) fileState.set(l.file, 'importing')
    else if (l.message.startsWith('Done')) fileState.set(l.file, 'done')
    else if (l.message.startsWith('Skipped')) fileState.set(l.file, 'unchanged')
    else if (l.message.startsWith('FAILED')) fileState.set(l.file, 'failed')
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {REQUIRED.map((file) => {
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

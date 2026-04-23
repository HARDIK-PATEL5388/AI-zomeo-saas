'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

type Step = 1 | 2 | 3 | 4 | 5

const STEPS = [
  'Select Repertory',
  'Upload TAB Files',
  'Validate',
  'Import to Database',
  'Complete',
]

const REQUIRED_FILES = [
  { name: 'RemID.tab', desc: 'Remedy IDs & abbreviations', size: '~95 KB' },
  { name: 'Remlist.tab', desc: 'Full remedy names & families', size: '~95 MB' },
  { name: 'REPolar.tab', desc: 'Polar remedy groups', size: '~63 KB' },
  { name: 'PapaSub.tab', desc: 'Rubric hierarchy & symptoms', size: '~3 MB' },
  { name: 'Pagerefs.tab', desc: 'Page references', size: '~1.7 MB' },
  { name: 'LibraryIndex.tab', desc: 'Literature references', size: '~1.1 MB' },
  { name: 'Complete.tab', desc: 'Rubric-remedy relationships', size: '~38 MB' },
]

interface RepertorySource {
  id: string
  name: string
  slug: string
  publisher: string
}

interface ValidationIssue {
  file: string
  type: string
  row?: number
  col?: number
  message: string
}

interface ImportSummary {
  file: string
  status: 'SYNCED' | 'UNCHANGED' | 'MISSING' | 'FAILED'
  hash?: string
  added?: number
  updated?: number
  skipped?: number
  error?: string
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('zomeo_access_token') || localStorage.getItem('admin_token')
}

export default function UploadWizardPage() {
  const [step, setStep] = useState<Step>(1)
  const [sources, setSources] = useState<RepertorySource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [versionTag, setVersionTag] = useState('v1')
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Validation
  const [validationResult, setValidationResult] = useState<{
    valid: boolean
    issues: ValidationIssue[]
    filesReceived: string[]
  } | null>(null)

  // Import
  const [jobId, setJobId] = useState('')
  const [importLogs, setImportLogs] = useState<Array<{ step: string; message: string; time: string }>>([])
  const [importSummary, setImportSummary] = useState<ImportSummary[] | null>(null)
  const [importStatus, setImportStatus] = useState<string>('')

  const logsEndRef = useRef<HTMLDivElement>(null)

  const next = () => setStep(s => Math.min(5, s + 1) as Step)
  const prev = () => setStep(s => Math.max(1, s - 1) as Step)

  // Load repertory sources
  useEffect(() => {
    fetch(`${API_URL}/api/upload/sources`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setSources(data)
      })
      .catch(() => {})
  }, [])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [importLogs])

  // File selection helpers
  const fileMap = new Map(files.map(f => [f.name, f]))
  const missingFiles = REQUIRED_FILES.filter(rf => !fileMap.has(rf.name))
  const matchedFiles = REQUIRED_FILES.filter(rf => fileMap.has(rf.name))
  const extraFiles = files.filter(f => !REQUIRED_FILES.some(rf => rf.name === f.name))

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || [])
    setFiles(prev => {
      const merged = new Map(prev.map(f => [f.name, f]))
      for (const f of newFiles) merged.set(f.name, f)
      return Array.from(merged.values())
    })
    setValidationResult(null)
    setError('')
  }

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name))
    setValidationResult(null)
  }

  // Step 3: Validate
  const handleValidate = async () => {
    setLoading(true)
    setError('')
    setValidationResult(null)

    try {
      const formData = new FormData()
      for (const f of files) formData.append('files', f)

      const res = await fetch(`${API_URL}/api/upload/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Validation request failed')
        return
      }

      setValidationResult(data)
    } catch (err: any) {
      setError(err.message || 'Validation failed')
    } finally {
      setLoading(false)
    }
  }

  // Step 4: Start import
  const handleStartImport = async () => {
    setLoading(true)
    setError('')
    setImportLogs([])
    setImportSummary(null)
    setImportStatus('importing')

    try {
      const formData = new FormData()
      formData.append('sourceId', sourceId)
      formData.append('year', String(year))
      formData.append('versionTag', versionTag)
      for (const f of files) formData.append('files', f)

      const res = await fetch(`${API_URL}/api/upload/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      })

      const data = await res.json()

      if (res.status === 422) {
        setValidationResult({ valid: false, issues: data.issues, filesReceived: [] })
        setError('Validation failed. Go back and fix issues.')
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError(data.error || 'Upload failed')
        setLoading(false)
        return
      }

      setJobId(data.jobId)
      next()

      // Start polling for progress
      pollJobProgress(data.jobId)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
      setLoading(false)
    }
  }

  const pollJobProgress = useCallback(async (id: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/api/upload/jobs/${id}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        })
        const data = await res.json()

        if (data.logs) {
          setImportLogs(data.logs)
        }

        if (data.status === 'done') {
          setImportStatus('done')
          setImportSummary(data.import_summary)
          setLoading(false)
          return
        }

        if (data.status === 'failed') {
          setImportStatus('failed')
          setImportSummary(data.import_summary)
          setError('Import failed. Check the summary below.')
          setLoading(false)
          return
        }

        // Keep polling
        setTimeout(poll, 2000)
      } catch {
        setTimeout(poll, 3000)
      }
    }

    poll()
  }, [])

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      SYNCED: 'bg-green-100 text-green-700',
      UNCHANGED: 'bg-gray-100 text-gray-600',
      MISSING: 'bg-yellow-100 text-yellow-700',
      FAILED: 'bg-red-100 text-red-700',
    }
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-gray-100'}`}>
        {status}
      </span>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Repertory Data Upload</h1>
      <p className="text-sm text-gray-500 mb-8">Upload, validate, and import Complete Repertory TAB files</p>

      {/* Progress bar */}
      <div className="flex items-center gap-1 mb-10">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0
              ${step > i + 1 ? 'bg-green-500 text-white' : step === i + 1 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {step > i + 1 ? '\u2713' : i + 1}
            </div>
            <span className={`text-xs font-medium truncate ${step === i + 1 ? 'text-primary-600' : 'text-gray-400'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 ${step > i + 1 ? 'bg-green-500' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600">x</button>
        </div>
      )}

      {/* ── Step 1: Select Repertory ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Repertory Source</label>
            <select value={sourceId} onChange={e => setSourceId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white">
              <option value="">Select repertory...</option>
              {sources.map(s => (
                <option key={s.id} value={s.id}>{s.name} — {s.publisher}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data Year</label>
              <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={2000} max={2035}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Version Tag</label>
              <input type="text" value={versionTag} onChange={e => setVersionTag(e.target.value)}
                placeholder="e.g. v1, v2-corrected"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" />
            </div>
          </div>

          {/* Show required files info when Complete Repertory selected */}
          {sourceId && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-blue-800 mb-2">Required TAB Files (7 files)</p>
              <div className="grid grid-cols-1 gap-1">
                {REQUIRED_FILES.map(rf => (
                  <div key={rf.name} className="flex items-center justify-between text-xs text-blue-700">
                    <span className="font-mono">{rf.name}</span>
                    <span className="text-blue-500">{rf.desc} ({rf.size})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={next} disabled={!sourceId}
            className="w-full py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
            Continue
          </button>
        </div>
      )}

      {/* ── Step 2: Upload Files ── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-primary-400 transition-colors">
            <input type="file" multiple onChange={handleFileSelect}
              accept=".tab"
              className="hidden" id="file-input" />
            <label htmlFor="file-input" className="cursor-pointer">
              <div className="text-4xl mb-2">+</div>
              <p className="text-sm font-medium text-gray-700">Click to select TAB files</p>
              <p className="text-xs text-gray-400 mt-1">Select all 7 required .tab files at once (multi-select)</p>
            </label>
          </div>

          {/* File checklist */}
          <div className="bg-white border border-gray-200 rounded-xl divide-y">
            <div className="px-4 py-2.5 bg-gray-50 rounded-t-xl">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                File Checklist — {matchedFiles.length}/{REQUIRED_FILES.length} ready
              </p>
            </div>
            {REQUIRED_FILES.map(rf => {
              const file = fileMap.get(rf.name)
              return (
                <div key={rf.name} className={`flex items-center justify-between px-4 py-2.5 ${file ? 'bg-green-50' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                      ${file ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                      {file ? '\u2713' : ''}
                    </div>
                    <div>
                      <p className="text-sm font-mono font-medium text-gray-800">{rf.name}</p>
                      <p className="text-xs text-gray-500">{rf.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {file && (
                      <>
                        <span className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                        <button onClick={() => removeFile(rf.name)} className="text-xs text-red-400 hover:text-red-600">remove</button>
                      </>
                    )}
                    {!file && <span className="text-xs text-amber-500 font-medium">Missing</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Extra files warning */}
          {extraFiles.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
              <span className="font-semibold">Extra files ignored:</span> {extraFiles.map(f => f.name).join(', ')}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={prev} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Back</button>
            <button onClick={next} disabled={matchedFiles.length === 0}
              className="flex-1 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              Continue ({matchedFiles.length} files ready)
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Validate ── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <p className="text-sm font-semibold text-blue-800">Pre-Import Validation</p>
            <p className="text-xs text-blue-600 mt-1">
              Checks encoding (Windows-1252), column counts, row minimums, data types, and required values across all {matchedFiles.length} files.
            </p>
          </div>

          {!validationResult && (
            <button onClick={handleValidate} disabled={loading}
              className="w-full py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {loading ? 'Validating...' : 'Run Validation'}
            </button>
          )}

          {validationResult && (
            <div className="space-y-3">
              {/* Result banner */}
              <div className={`rounded-xl p-4 border ${validationResult.valid
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'}`}>
                <p className={`text-sm font-semibold ${validationResult.valid ? 'text-green-800' : 'text-red-800'}`}>
                  {validationResult.valid ? 'All files passed validation' : `${validationResult.issues.length} issue(s) found`}
                </p>
                <p className="text-xs mt-1 text-gray-600">
                  Files checked: {validationResult.filesReceived?.join(', ')}
                </p>
              </div>

              {/* Issues list */}
              {validationResult.issues.length > 0 && (
                <div className="max-h-64 overflow-y-auto space-y-1.5">
                  {validationResult.issues.map((issue, i) => (
                    <div key={i} className="border border-red-200 bg-red-50 rounded-lg px-3 py-2 text-xs text-red-700">
                      <span className="font-mono font-bold">[{issue.type}]</span>{' '}
                      <span className="font-semibold">{issue.file}</span>
                      {issue.row && <span className="text-red-500"> row {issue.row}</span>}
                      {': '}{issue.message}
                    </div>
                  ))}
                </div>
              )}

              {/* Re-validate */}
              {!validationResult.valid && (
                <button onClick={() => { setValidationResult(null); prev() }}
                  className="w-full py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                  Go Back & Fix Files
                </button>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={prev} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Back</button>
            {validationResult?.valid && (
              <button onClick={handleStartImport} disabled={loading}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
                {loading ? 'Starting import...' : 'Start Import to Database'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Step 4: Import Progress ── */}
      {step === 4 && (
        <div className="space-y-4">
          <div className={`rounded-xl p-4 border ${
            importStatus === 'done' ? 'bg-green-50 border-green-200' :
            importStatus === 'failed' ? 'bg-red-50 border-red-200' :
            'bg-blue-50 border-blue-200'
          }`}>
            <p className={`text-sm font-semibold ${
              importStatus === 'done' ? 'text-green-800' :
              importStatus === 'failed' ? 'text-red-800' :
              'text-blue-800'
            }`}>
              {importStatus === 'done' ? 'Import Complete' :
               importStatus === 'failed' ? 'Import Failed' :
               'Importing data...'}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              Job ID: <code className="font-mono bg-white/50 px-1 rounded">{jobId}</code>
            </p>
          </div>

          {/* Live progress logs */}
          {importLogs.length > 0 && (
            <div className="bg-gray-900 rounded-xl p-4 max-h-64 overflow-y-auto font-mono text-xs">
              {importLogs.map((log, i) => (
                <div key={i} className="text-gray-300 py-0.5">
                  <span className="text-gray-500">[{new Date(log.time).toLocaleTimeString()}]</span>{' '}
                  <span className="text-cyan-400">{log.step}</span>{' '}
                  <span className="text-gray-200">{log.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}

          {/* Loading spinner */}
          {importStatus === 'importing' && (
            <div className="flex items-center justify-center gap-2 py-4">
              <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-600">Processing files in order...</span>
            </div>
          )}

          {/* Import summary table */}
          {importSummary && Array.isArray(importSummary) && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Import Summary</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b bg-gray-50">
                    <th className="text-left px-4 py-2 font-medium">File</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                    <th className="text-right px-4 py-2 font-medium">Added</th>
                    <th className="text-right px-4 py-2 font-medium">Updated</th>
                    <th className="text-right px-4 py-2 font-medium">Skipped</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {importSummary.map((s, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs font-medium">{s.file}</td>
                      <td className="px-4 py-2">{statusBadge(s.status)}</td>
                      <td className="px-4 py-2 text-right text-xs">{s.added ?? '—'}</td>
                      <td className="px-4 py-2 text-right text-xs">{s.updated ?? '—'}</td>
                      <td className="px-4 py-2 text-right text-xs">{s.skipped ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importStatus === 'done' && (
            <button onClick={next}
              className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700">
              Continue
            </button>
          )}
        </div>
      )}

      {/* ── Step 5: Complete ── */}
      {step === 5 && (
        <div className="space-y-4 text-center py-8">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl text-green-600">{'\u2713'}</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900">Upload Complete</h2>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            All repertory data has been validated and imported into the database.
            The data is now available for doctors to use in their repertorization.
          </p>
          <div className="flex gap-3 justify-center pt-4">
            <button onClick={() => { setStep(1); setFiles([]); setValidationResult(null); setImportSummary(null); setImportLogs([]); setJobId(''); setError('') }}
              className="px-6 py-2.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              Upload Another
            </button>
            <a href="/admin/repertory/jobs"
              className="px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700">
              View All Jobs
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

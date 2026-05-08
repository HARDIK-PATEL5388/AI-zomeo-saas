'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Calendar, Search, Eye, Pencil, Trash2, X, Save, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'

// ----------------------------------------------------------------------------
// Types — mirror the API shape from /api/followups
// ----------------------------------------------------------------------------
interface FollowupRow {
  id: string
  case_id: string
  patient_id: string
  patient_name?: string
  case_chief_complaint?: string | null
  visit_date?: string | null
  followup_date?: string | null
  complaints?: string | null
  remedy_name?: string | null
  remedy_code?: number | null
  potency?: string | null
  dosage?: string | null
  repetition?: string | null
  days?: string | null
  prescription_type?: string | null
  remedy_response?: string | null
  diagnosis?: string | null
  preferences?: string | null
  improvement_score?: number | null
  overall_improvement?: number | null
  next_visit_date?: string | null
  next_followup_date?: string | null
  action_taken?: string | null
  notes?: string | null
  created_at?: string
}

const ACTION_OPTIONS = [
  { v: 'continue', l: 'Continue same remedy' },
  { v: 'change_potency', l: 'Change potency' },
  { v: 'wait', l: 'Wait and watch' },
  { v: 'repeat', l: 'Repeat medicine' },
  { v: 'change_remedy', l: 'Change remedy' },
  { v: 'intercurrent', l: 'Intercurrent' },
]

function improvementBadge(score?: number | null) {
  if (score == null) return 'text-gray-500 bg-gray-50'
  if (score >= 7) return 'text-green-600 bg-green-50'
  if (score >= 4) return 'text-yellow-600 bg-yellow-50'
  return 'text-red-600 bg-red-50'
}

function fmtDate(v?: string | null) {
  if (!v) return '—'
  // Backend now returns DATE as a raw 'YYYY-MM-DD' string
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-')
    return `${d}/${m}/${y}`
  }
  const d = new Date(v)
  return isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

function fmtAction(a?: string | null) {
  if (!a) return '—'
  return a.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function FollowupsPage() {
  const [rows, setRows] = useState<FollowupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterRemedy, setFilterRemedy] = useState('')

  const [editing, setEditing] = useState<FollowupRow | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<{ data: FollowupRow[] }>('/followups')
      setRows(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load follow-ups')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const visitDate = r.visit_date ?? r.followup_date ?? ''
      if (search) {
        const q = search.toLowerCase()
        const hay = `${r.patient_name ?? ''} ${r.complaints ?? ''} ${r.remedy_name ?? ''} ${r.diagnosis ?? ''} ${r.case_chief_complaint ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filterRemedy) {
        const hay = (r.remedy_name ?? '').toLowerCase()
        if (!hay.includes(filterRemedy.toLowerCase())) return false
      }
      if (filterFrom && visitDate < filterFrom) return false
      if (filterTo && visitDate > filterTo) return false
      return true
    })
  }, [rows, search, filterFrom, filterTo, filterRemedy])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this follow-up? This cannot be undone.')) return
    try {
      await api.delete(`/followups/${id}`)
      setRows(prev => prev.filter(r => r.id !== id))
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const payload = {
        visit_date: editing.visit_date || undefined,
        complaints: editing.complaints,
        remedy_name: editing.remedy_name,
        potency: editing.potency,
        dosage: editing.dosage,
        repetition: editing.repetition,
        days: editing.days,
        prescription_type: editing.prescription_type,
        remedy_response: editing.remedy_response,
        diagnosis: editing.diagnosis,
        preferences: editing.preferences,
        improvement_score: editing.improvement_score,
        next_visit_date: editing.next_visit_date || undefined,
        notes: editing.notes,
        action_taken: editing.action_taken,
      }
      await api.put(`/followups/${editing.id}`, payload)
      setEditing(null)
      await reload()
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Follow-ups</h1>
          <p className="text-gray-500 text-sm mt-0.5">{filtered.length} of {rows.length} records</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-3 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient, complaint, remedy, diagnosis…"
            className="w-full pl-9 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <input
          type="text"
          value={filterRemedy}
          onChange={(e) => setFilterRemedy(e.target.value)}
          placeholder="Filter by remedy"
          className="px-3 py-2 border rounded-lg"
        />
        <div className="flex items-center gap-2">
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
            className="flex-1 px-2 py-2 border rounded-lg" />
          <span className="text-gray-400 text-xs">to</span>
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
            className="flex-1 px-2 py-2 border rounded-lg" />
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-gray-500 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              {rows.length === 0 ? 'No follow-ups recorded yet.' : 'No follow-ups match the current filters.'}
            </p>
            {rows.length === 0 && (
              <p className="text-gray-400 text-xs mt-1">
                Run an analysis and click <span className="font-medium">Generate Prescription</span> to record one.
              </p>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Complaint</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Visit Date</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Remedy</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Potency</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Repetition</th>
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Improvement</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Next Visit</th>
                <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">·</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((fu) => {
                const visit = fu.visit_date ?? fu.followup_date
                const next = fu.next_visit_date ?? fu.next_followup_date
                const improvement = fu.improvement_score ?? fu.overall_improvement
                const complaint = fu.complaints ?? fu.case_chief_complaint
                return (
                  <tr key={fu.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">
                      {fu.patient_name || '—'}
                    </td>
                    <td className="px-3 py-3 text-gray-600 max-w-[180px] truncate" title={complaint ?? ''}>
                      {complaint || '—'}
                    </td>
                    <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{fmtDate(visit)}</td>
                    <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{fu.remedy_name || '—'}</td>
                    <td className="px-3 py-3 font-mono text-emerald-700 whitespace-nowrap">{fu.potency || '—'}</td>
                    <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{fu.repetition || '—'}</td>
                    <td className="px-3 py-3 text-center">
                      {improvement != null ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${improvementBadge(improvement)}`}>
                          {improvement}/10
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{fmtAction(fu.action_taken)}</td>
                    <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{fmtDate(next)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          href={`/followups/${fu.id}`}
                          className="p-1.5 hover:bg-gray-100 rounded text-gray-600 hover:text-gray-900"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => setEditing({ ...fu })}
                          className="p-1.5 hover:bg-gray-100 rounded text-gray-600 hover:text-emerald-700"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(fu.id)}
                          className="p-1.5 hover:bg-red-50 rounded text-gray-600 hover:text-red-700"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h2 className="font-semibold text-gray-900">Edit Follow-up</h2>
              <button onClick={() => setEditing(null)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-2 gap-3 text-sm">
              <Field label="Visit Date">
                <input type="date" value={editing.visit_date ?? editing.followup_date ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, visit_date: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Next Visit">
                <input type="date" value={editing.next_visit_date ?? editing.next_followup_date ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, next_visit_date: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Remedy">
                <input type="text" value={editing.remedy_name ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, remedy_name: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Potency">
                <input type="text" value={editing.potency ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, potency: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Dosage">
                <input type="text" value={editing.dosage ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, dosage: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Repetition">
                <input type="text" value={editing.repetition ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, repetition: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Days">
                <input type="text" value={editing.days ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, days: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Prescription Type">
                <input type="text" value={editing.prescription_type ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, prescription_type: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Improvement (0-10)">
                <input type="number" min={0} max={10} value={editing.improvement_score ?? editing.overall_improvement ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, improvement_score: e.target.value === '' ? null : Number(e.target.value) })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Action Taken">
                <select value={editing.action_taken ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, action_taken: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 bg-white">
                  <option value="">—</option>
                  {ACTION_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </Field>
              <Field label="Complaints" wide>
                <textarea rows={2} value={editing.complaints ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, complaints: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Remedy Response" wide>
                <textarea rows={2} value={editing.remedy_response ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, remedy_response: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Diagnosis" wide>
                <textarea rows={2} value={editing.diagnosis ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, diagnosis: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Preferences" wide>
                <textarea rows={2} value={editing.preferences ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, preferences: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
              <Field label="Notes" wide>
                <textarea rows={2} value={editing.notes ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, notes: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-gray-50">
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 border rounded-md text-sm hover:bg-gray-100">Cancel</button>
              <button onClick={handleSaveEdit} disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm disabled:opacity-50">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

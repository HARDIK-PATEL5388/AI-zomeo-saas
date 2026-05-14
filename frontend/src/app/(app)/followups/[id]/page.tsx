'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, User, FileText, Pill, Stethoscope,
  TrendingUp, History, StickyNote, AlertCircle,
  Pencil, Trash2, X, Save, Printer,
} from 'lucide-react'
import { api } from '@/lib/api'
import { PrescriptionPrint, printPrescription, type PrintablePrescription } from '@/components/prescription/PrescriptionPrint'

interface FollowupDetail {
  id: string
  case_id: string
  patient_id: string
  patient_name?: string
  patient_first_name?: string | null
  patient_last_name?: string | null
  patient_phone?: string | null
  patient_email?: string | null
  patient_age?: number | null
  patient_gender?: string | null
  doctor_name?: string
  doctor_first_name?: string | null
  doctor_last_name?: string | null
  case_chief_complaint?: string | null
  case_history?: string | null
  case_status?: string | null
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
  investigations?: string | null
  examination?: string | null
  improvement_score?: number | null
  overall_improvement?: number | null
  next_visit_date?: string | null
  next_followup_date?: string | null
  action_taken?: string | null
  notes?: string | null
  created_at?: string
}

interface HistoryRow {
  id: string
  visit_date?: string | null
  followup_date?: string | null
  remedy_name?: string | null
  potency?: string | null
  remedy_response?: string | null
  complaints?: string | null
  case_chief_complaint?: string | null
}

const ACTION_OPTIONS = [
  { v: 'continue', l: 'Continue same remedy' },
  { v: 'change_potency', l: 'Change potency' },
  { v: 'wait', l: 'Wait and watch' },
  { v: 'repeat', l: 'Repeat medicine' },
  { v: 'change_remedy', l: 'Change remedy' },
  { v: 'intercurrent', l: 'Intercurrent' },
]

const DASH = '—'

function fmtDate(v?: string | null) {
  if (!v) return DASH
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-')
    return `${d}/${m}/${y}`
  }
  const d = new Date(v)
  return isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

function fmtAction(a?: string | null) {
  if (!a) return DASH
  return a.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function show(v: unknown): string {
  if (v == null || v === '') return DASH
  return String(v)
}

export default function FollowupDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [data, setData] = useState<FollowupDetail | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit modal
  const [editing, setEditing] = useState<FollowupDetail | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Print
  const [printData, setPrintData] = useState<PrintablePrescription | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)

  const reload = async () => {
    if (!id) return
    try {
      const res = await api.get<{ data: FollowupDetail }>(`/followups/${id}`)
      setData(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload follow-up')
    }
  }

  useEffect(() => {
    if (!id) return
    let alive = true
    ;(async () => {
      try {
        const res = await api.get<{ data: FollowupDetail }>(`/followups/${id}`)
        if (!alive) return
        setData(res.data)
        if (res.data?.patient_id) {
          try {
            const h = await api.get<{ data: HistoryRow[] }>(`/patients/${res.data.patient_id}/followups`)
            if (alive) setHistory((h.data ?? []).filter(r => r.id !== id))
          } catch {/* non-fatal */}
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load follow-up')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id])

  const handleDelete = async () => {
    if (!id) return
    if (!confirm('Delete this follow-up? This cannot be undone.')) return
    setDeleting(true)
    try {
      await api.delete(`/followups/${id}`)
      router.push('/followups')
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : err}`)
      setDeleting(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!editing || !id) return
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
        investigations: editing.investigations,
        examination: editing.examination,
        improvement_score: editing.improvement_score,
        next_visit_date: editing.next_visit_date || undefined,
        notes: editing.notes,
        action_taken: editing.action_taken,
      }
      await api.put(`/followups/${id}`, payload)
      setEditing(null)
      await reload()
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setSaving(false)
    }
  }

  const handlePrintPrescription = () => {
    if (!data) return
    setPrintError(null)
    try {
      const doctorName = data.doctor_name?.trim()
        || [data.doctor_first_name, data.doctor_last_name].filter(Boolean).join(' ').trim()
      const patientName = data.patient_name?.trim()
        || `${data.patient_first_name ?? ''} ${data.patient_last_name ?? ''}`.trim()
      const mapped: PrintablePrescription = {
        patient_name: patientName,
        patient_age: data.patient_age ?? null,
        patient_gender: data.patient_gender ?? null,
        doctor_name: doctorName ? `Dr. ${doctorName}` : 'Doctor',
        visit_date: data.visit_date ?? data.followup_date ?? null,
        next_visit_date: data.next_visit_date ?? data.next_followup_date ?? null,
        chief_complaint: data.case_chief_complaint ?? null,
        diagnosis: data.diagnosis ?? null,
        complaints: data.complaints ?? null,
        remedy_name: data.remedy_name ?? null,
        remedy_code: data.remedy_code ?? null,
        potency: data.potency ?? null,
        dosage: data.dosage ?? null,
        repetition: data.repetition ?? null,
        days: data.days ?? null,
        prescription_type: data.prescription_type ?? null,
        action_taken: data.action_taken ?? null,
        remedy_response: data.remedy_response ?? null,
        investigations: data.investigations ?? null,
        examination: data.examination ?? null,
        notes: data.notes ?? null,
        generated_at: new Date(),
      }
      setPrintData(mapped)
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Failed to prepare prescription')
    }
  }

  useEffect(() => {
    if (!printData) return
    const id = requestAnimationFrame(() => printPrescription())
    return () => cancelAnimationFrame(id)
  }, [printData])

  useEffect(() => {
    const onAfter = () => setPrintData(null)
    window.addEventListener('afterprint', onAfter)
    return () => window.removeEventListener('afterprint', onAfter)
  }, [])

  if (loading) {
    return <div className="p-6 max-w-5xl mx-auto text-sm text-gray-500">Loading…</div>
  }
  if (error || !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <Link href="/followups" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> Back to Follow-ups
        </Link>
        <div className="mt-6 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error ?? 'Follow-up not found.'}
        </div>
      </div>
    )
  }

  const visit = data.visit_date ?? data.followup_date
  const next = data.next_visit_date ?? data.next_followup_date
  const improvement = data.improvement_score ?? data.overall_improvement
  const complaint = data.complaints ?? data.case_chief_complaint

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header with quick actions */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <Link
            href="/followups"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Follow-ups
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Follow-up Details</h1>
          <p className="text-gray-500 text-sm mt-0.5">Visit {fmtDate(visit)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handlePrintPrescription}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm font-medium"
          >
            <Printer className="w-4 h-4" /> Print Prescription
          </button>
          <button
            onClick={() => setEditing({ ...data })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            <Pencil className="w-4 h-4" /> Edit Follow-up
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-md text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" /> {deleting ? 'Deleting…' : 'Delete Follow-up'}
          </button>
        </div>
      </div>
      {printError && (
        <div className="mb-3 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
          {printError}
        </div>
      )}

      <div className="space-y-4">
        {/* 1. Patient Information */}
        <Section title="Patient Information" icon={<User className="w-4 h-4" />}>
          <Grid>
            <Field label="Name" value={data.patient_name} />
            <Field label="Age" value={data.patient_age != null ? `${data.patient_age} yrs` : DASH} />
            <Field label="Gender" value={data.patient_gender} />
            <Field label="Phone" value={data.patient_phone} />
          </Grid>
        </Section>

        {/* 2. Case Information */}
        <Section title="Case Information" icon={<FileText className="w-4 h-4" />}>
          <Field label="Chief Complaint" value={data.case_chief_complaint} />
          <Block label="Case History" value={data.case_history} />
        </Section>

        {/* 3. Follow-up Information */}
        <Section title="Follow-up Information" icon={<Pill className="w-4 h-4" />}>
          <Grid>
            <Field label="Visit Date" value={fmtDate(visit)} />
            <Field label="Remedy" value={data.remedy_name} />
            <Field label="Potency" value={data.potency} mono />
            <Field label="Dosage" value={data.dosage} />
            <Field label="Repetition" value={data.repetition} />
            <Field label="Days" value={data.days} />
            <Field label="Prescription Type" value={data.prescription_type} />
          </Grid>
          <Block label="Complaint" value={complaint} />
          <Block label="Remedy Response" value={data.remedy_response} />
        </Section>

        {/* 4. Clinical Data */}
        <Section title="Clinical Data" icon={<Stethoscope className="w-4 h-4" />}>
          <Block label="Diagnosis" value={data.diagnosis} />
          <Block label="Preferences" value={data.preferences} />
          <Block label="Investigations" value={data.investigations} />
          <Block label="Examination" value={data.examination} />
        </Section>

        {/* 5. Improvement Tracking */}
        <Section title="Improvement Tracking" icon={<TrendingUp className="w-4 h-4" />}>
          <Grid>
            <Field
              label="Improvement Score"
              value={improvement != null ? `${improvement} / 10` : DASH}
            />
            <Field label="Action Taken" value={fmtAction(data.action_taken)} />
            <Field label="Next Visit" value={fmtDate(next)} />
          </Grid>
        </Section>

        {/* 6. Previous Follow-ups (newest first) */}
        <Section title="Previous Follow-ups" icon={<History className="w-4 h-4" />}>
          {history.length === 0 ? (
            <p className="text-xs text-gray-400">No previous follow-ups for this patient.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500 border-b">
                  <tr>
                    <th className="text-left py-1.5 pr-3">Date</th>
                    <th className="text-left pr-3">Complaint</th>
                    <th className="text-left pr-3">Remedy</th>
                    <th className="text-left pr-3">Potency</th>
                    <th className="text-left pr-3">Response</th>
                    <th className="text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map(h => {
                    const v = h.visit_date ?? h.followup_date
                    const cmp = h.complaints ?? h.case_chief_complaint
                    return (
                      <tr key={h.id} className="hover:bg-gray-50 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(v)}</td>
                        <td className="py-2 pr-3 max-w-[180px] truncate" title={cmp ?? ''}>{show(cmp)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{show(h.remedy_name)}</td>
                        <td className="py-2 pr-3 font-mono text-emerald-700 whitespace-nowrap">{show(h.potency)}</td>
                        <td className="py-2 pr-3 max-w-[260px] truncate" title={h.remedy_response ?? ''}>
                          {show(h.remedy_response)}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <Link href={`/followups/${h.id}`} className="text-emerald-700 hover:underline">
                            View
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* 7. Notes */}
        <Section title="Notes" icon={<StickyNote className="w-4 h-4" />}>
          {data.notes ? (
            <div className="text-sm text-gray-800 whitespace-pre-wrap">{data.notes}</div>
          ) : (
            <p className="text-sm text-gray-400">{DASH}</p>
          )}
        </Section>
      </div>

      {printData && <PrescriptionPrint data={printData} />}

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
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <EditField label="Visit Date">
                <input type="date" value={editing.visit_date ?? editing.followup_date ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, visit_date: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Next Visit">
                <input type="date" value={editing.next_visit_date ?? editing.next_followup_date ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, next_visit_date: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Remedy">
                <input type="text" value={editing.remedy_name ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, remedy_name: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Potency">
                <input type="text" value={editing.potency ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, potency: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Dosage">
                <input type="text" value={editing.dosage ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, dosage: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Repetition">
                <input type="text" value={editing.repetition ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, repetition: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Days">
                <input type="text" value={editing.days ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, days: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Prescription Type">
                <input type="text" value={editing.prescription_type ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, prescription_type: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Improvement (0-10)">
                <input type="number" min={0} max={10}
                  value={editing.improvement_score ?? editing.overall_improvement ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, improvement_score: e.target.value === '' ? null : Number(e.target.value) })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Action Taken">
                <select value={editing.action_taken ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, action_taken: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 bg-white">
                  <option value="">—</option>
                  {ACTION_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </EditField>
              <EditField label="Complaint" wide>
                <textarea rows={2} value={editing.complaints ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, complaints: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Remedy Response" wide>
                <textarea rows={2} value={editing.remedy_response ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, remedy_response: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Diagnosis" wide>
                <textarea rows={2} value={editing.diagnosis ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, diagnosis: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Preferences" wide>
                <textarea rows={2} value={editing.preferences ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, preferences: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Investigations" wide>
                <textarea rows={2} value={editing.investigations ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, investigations: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Examination" wide>
                <textarea rows={2} value={editing.examination ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, examination: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
              <EditField label="Notes" wide>
                <textarea rows={2} value={editing.notes ?? ''}
                  onChange={(e) => setEditing(s => s && { ...s, notes: e.target.value })}
                  className="w-full border rounded px-2 py-1.5" />
              </EditField>
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t bg-gray-50">
              <button
                type="button"
                onClick={handlePrintPrescription}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-sm text-gray-700 hover:bg-gray-50"
                title="Prints the last saved data — save first to print recent edits"
              >
                <Printer className="w-4 h-4" /> Print Prescription
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditing(null)} className="px-3 py-1.5 border rounded-md text-sm hover:bg-gray-100">Cancel</button>
                <button onClick={handleSaveEdit} disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm disabled:opacity-50">
                  <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Layout primitives
// ----------------------------------------------------------------------------
function Section({
  title, icon, children,
}: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border p-4">
      <h2 className="flex items-center gap-1.5 mb-3 text-sm font-semibold text-gray-900">
        {icon}<span>{title}</span>
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
      {children}
    </div>
  )
}

function Field({
  label, value, mono,
}: { label: string; value?: string | number | null; mono?: boolean }) {
  const display = value == null || value === '' ? DASH : value
  return (
    <div className="text-xs">
      <div className="text-gray-500 mb-0.5">{label}</div>
      <div className={`text-sm text-gray-900 font-medium ${mono ? 'font-mono text-emerald-700' : ''}`}>
        {display}
      </div>
    </div>
  )
}

function Block({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      {value ? (
        <div className="text-sm text-gray-800 whitespace-pre-wrap">{value}</div>
      ) : (
        <div className="text-sm text-gray-400">{DASH}</div>
      )}
    </div>
  )
}

function EditField({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

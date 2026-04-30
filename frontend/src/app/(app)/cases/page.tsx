'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Plus, X } from 'lucide-react'
import { api } from '@/lib/api'

interface CaseRow {
  id: string
  patient_id: string
  chief_complaint: string
  status: 'active' | 'closed' | 'archived'
  created_at: string
  updated_at: string
  patient_name?: string
  first_name?: string
  last_name?: string
}

interface PatientLite {
  id: string
  first_name: string
  last_name?: string | null
}

const statusStyles: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
  archived: 'bg-yellow-100 text-yellow-700',
}

export default function CasesPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ patient_id: '', chief_complaint: '', history: '' })
  const [formError, setFormError] = useState('')

  const { data: casesResp, isLoading: casesLoading } = useQuery({
    queryKey: ['cases'],
    queryFn: () => api.get<{ data: CaseRow[] }>('/cases?limit=50'),
  })
  const cases = casesResp?.data ?? []

  const { data: patientsResp } = useQuery({
    queryKey: ['patients-lite'],
    queryFn: () => api.get<{ data: PatientLite[] }>('/patients?limit=200'),
  })
  const patients = patientsResp?.data ?? []

  const createCase = useMutation({
    mutationFn: (vars: { patient_id: string; chief_complaint: string; history?: string }) =>
      api.post<{ data: CaseRow }>('/cases', vars),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] })
      setShowModal(false)
      setForm({ patient_id: '', chief_complaint: '', history: '' })
      router.push(`/analysis?caseId=${resp.data.id}`)
    },
    onError: (err: Error) => setFormError(err.message),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.patient_id) { setFormError('Please select a patient.'); return }
    if (!form.chief_complaint.trim()) { setFormError('Chief complaint is required.'); return }
    if (form.chief_complaint.trim().length < 3) { setFormError('Chief complaint must be at least 3 characters.'); return }
    createCase.mutate({
      patient_id: form.patient_id,
      chief_complaint: form.chief_complaint.trim(),
      history: form.history.trim() || undefined,
    })
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cases</h1>
          <p className="text-gray-500 text-sm mt-0.5">{cases.length} total cases</p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Case
        </button>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        {casesLoading ? (
          <div className="text-center py-16 text-sm text-gray-400">Loading cases…</div>
        ) : cases.length === 0 ? (
          <div className="text-center py-16">
            <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No cases yet. Create the first case.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Chief Complaint</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {cases.map((c) => {
                const name = c.patient_name ?? [c.first_name, c.last_name].filter(Boolean).join(' ') ?? '—'
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{name}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{c.chief_complaint}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => router.push(`/analysis?caseId=${c.id}`)}
                        className="text-xs px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                      >
                        Analyse
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-semibold text-gray-900">New Case</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Patient *</label>
                <select
                  value={form.patient_id}
                  onChange={(e) => setForm(f => ({ ...f, patient_id: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Select patient…</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name}{p.last_name ? ` ${p.last_name}` : ''}
                    </option>
                  ))}
                </select>
                {patients.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No patients yet. Add one from the Patients page first.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chief Complaint *</label>
                <input
                  value={form.chief_complaint}
                  onChange={(e) => setForm(f => ({ ...f, chief_complaint: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g. Anxiety with restlessness, worse at night"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">History / Notes</label>
                <textarea
                  value={form.history}
                  onChange={(e) => setForm(f => ({ ...f, history: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  placeholder="Past history, medications, relevant details…"
                />
              </div>
              {formError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >Cancel</button>
                <button
                  type="submit"
                  disabled={createCase.isPending}
                  className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  {createCase.isPending ? 'Creating…' : 'Create & Analyse'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { Pill } from 'lucide-react'
import { mockPrescriptions } from '@/lib/mockData'

export default function PrescriptionsPage() {
  const prescriptions = mockPrescriptions

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Prescriptions</h1>
        <p className="text-gray-500 text-sm mt-0.5">{prescriptions.length} total prescriptions</p>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        {prescriptions.length === 0 ? (
          <div className="text-center py-16">
            <Pill className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No prescriptions yet.</p>
            <p className="text-gray-400 text-xs mt-1">Prescriptions are created from the Analysis page.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Complaint</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Remedy</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Potency</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dose · Frequency</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {prescriptions.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.patient_name}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate">{p.chief_complaint}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{p.abbreviation}</span>
                    <span className="text-xs text-gray-400 ml-1">({p.remedy_name})</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-emerald-700">{p.potency}</td>
                  <td className="px-4 py-3 text-gray-600">{[p.dose, p.frequency].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{p.duration ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

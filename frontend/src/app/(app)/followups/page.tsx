'use client'

import { Calendar } from 'lucide-react'
import { mockFollowups } from '@/lib/mockData'

function improvementBadge(score: number) {
  if (score >= 7) return 'text-green-600 bg-green-50'
  if (score >= 4) return 'text-yellow-600 bg-yellow-50'
  return 'text-red-600 bg-red-50'
}

export default function FollowupsPage() {
  const followups = mockFollowups

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Follow-ups</h1>
        <p className="text-gray-500 text-sm mt-0.5">{followups.length} records</p>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        {followups.length === 0 ? (
          <div className="text-center py-16">
            <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No follow-ups recorded yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Complaint</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Visit Date</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Improvement</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action Taken</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Next Visit</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {followups.map((fu) => (
                <tr key={fu.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{fu.patient_name}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate">{fu.chief_complaint}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(fu.followup_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${improvementBadge(fu.overall_improvement)}`}>
                      {fu.overall_improvement}/10
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{fu.action_taken.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {fu.next_followup_date ? new Date(fu.next_followup_date).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

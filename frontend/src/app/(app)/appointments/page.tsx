'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'

interface Appointment {
  id: string
  datetime: string
  status: 'scheduled' | 'completed' | 'cancelled' | 'no-show'
  notes?: string
  patients?: { name: string }
}

export default function AppointmentsPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const today = new Date().toISOString().split('T')[0]

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointments'],
    queryFn: () => api.get<Appointment[]>(`/appointments?from=${today}`),
  })

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.put<{ data: any }>(`/appointments/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] }),
  })

  const statusColors: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
    'no-show': 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your schedule and patient visits</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + New Appointment
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading appointments...</div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg">No upcoming appointments</p>
          <p className="text-sm mt-1">Schedule your first appointment to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.map((appt) => (
            <div key={appt.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">{appt.patients?.name || 'Unknown Patient'}</p>
                <p className="text-sm text-gray-500">
                  {new Date(appt.datetime).toLocaleString('en-IN', {
                    weekday: 'short', month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </p>
                {appt.notes && <p className="text-xs text-gray-400 mt-1">{appt.notes}</p>}
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[appt.status]}`}>
                  {appt.status}
                </span>
                {appt.status === 'scheduled' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateStatus.mutate({ id: appt.id, status: 'completed' })}
                      className="text-xs px-3 py-1 bg-green-50 text-green-700 rounded-lg hover:bg-green-100"
                    >
                      Complete
                    </button>
                    <button
                      onClick={() => updateStatus.mutate({ id: appt.id, status: 'cancelled' })}
                      className="text-xs px-3 py-1 bg-red-50 text-red-700 rounded-lg hover:bg-red-100"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// frontend/src/app/dashboard/page.tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { Users, FileText, FlaskConical, TrendingUp, Calendar, Clock, Activity } from 'lucide-react'
import { api } from '@/lib/api'

export default function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/admin/stats'),
  })

  const { data: recentCases } = useQuery({
    queryKey: ['recent-cases'],
    queryFn: () => api.get('/cases?limit=5&sort_by=created_at&sort_order=desc'),
  })

  const { data: upcomingFollowups } = useQuery({
    queryKey: ['upcoming-followups'],
    queryFn: () => api.get('/followups?upcoming=true&limit=5'),
  })

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Welcome back. Here's what's happening today.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-5 mb-8">
        {[
          { label: 'Total Patients', value: stats?.data?.patients || '—', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Active Cases', value: stats?.data?.active_cases || '—', icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Prescriptions', value: stats?.data?.prescriptions || '—', icon: FlaskConical, color: 'text-violet-600', bg: 'bg-violet-50' },
          { label: 'Follow-ups Due', value: stats?.data?.followups_due || '—', icon: Calendar, color: 'text-orange-600', bg: 'bg-orange-50' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">{stat.label}</p>
              <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center`}>
                <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
              </div>
            </div>
            <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Recent Cases */}
        <div className="col-span-2 bg-white rounded-xl border">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Cases</h2>
            <a href="/cases" className="text-sm text-emerald-600 hover:underline">View all</a>
          </div>
          <div className="divide-y">
            {recentCases?.data?.length === 0 ? (
              <p className="px-6 py-8 text-center text-gray-400 text-sm">No cases yet</p>
            ) : (
              recentCases?.data?.map((case_: any) => (
                <div key={case_.id} className="px-6 py-4 hover:bg-gray-50 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-medium text-emerald-700">
                    {case_.patient_name?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{case_.patient_name}</p>
                    <p className="text-sm text-gray-500 truncate">{case_.chief_complaint}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      case_.status === 'active' ? 'bg-green-100 text-green-700' :
                      case_.status === 'closed' ? 'bg-gray-100 text-gray-600' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {case_.status}
                    </span>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(case_.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Upcoming Follow-ups */}
        <div className="bg-white rounded-xl border">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Follow-ups Due</h2>
            <Calendar className="w-4 h-4 text-gray-400" />
          </div>
          <div className="divide-y">
            {upcomingFollowups?.data?.length === 0 ? (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">No upcoming follow-ups</p>
            ) : (
              upcomingFollowups?.data?.map((fu: any) => (
                <div key={fu.id} className="px-5 py-3.5">
                  <p className="font-medium text-gray-900 text-sm">{fu.patient_name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Clock className="w-3 h-3 text-orange-500" />
                    <p className="text-xs text-orange-600">
                      {new Date(fu.next_followup_date).toLocaleDateString()}
                    </p>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{fu.chief_complaint}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

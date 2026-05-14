'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Users, FileText, FlaskConical, Calendar, Clock, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'

interface DashboardStats {
  patients: number
  active_cases: number
  prescriptions: number
  followups_due: number
}

interface RecentCase {
  id: string
  patient_id: string
  patient_name: string
  chief_complaint: string
  status: 'active' | 'closed' | 'archived'
  created_at: string
}

interface UpcomingFollowup {
  id: string
  case_id: string
  patient_id: string
  patient_name: string
  chief_complaint: string | null
  next_followup_date: string
  overall_improvement: number | null
  action_taken: string | null
}

interface DashboardSummary {
  stats: DashboardStats
  recent_cases: RecentCase[]
  upcoming_followups: UpcomingFollowup[]
}

const ZERO_STATS: DashboardStats = { patients: 0, active_cases: 0, prescriptions: 0, followups_due: 0 }

export default function DashboardPage() {
  const router = useRouter()

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => api.get<{ data: DashboardSummary }>('/dashboard/summary'),
  })

  const stats = data?.data.stats ?? ZERO_STATS
  const recentCases = data?.data.recent_cases ?? []
  const upcomingFollowups = data?.data.upcoming_followups ?? []

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Welcome back. Here's what's happening today.</p>
      </div>

      {/* Error banner */}
      {isError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-red-900 text-sm">Couldn't load dashboard</p>
            <p className="text-sm text-red-700 mt-0.5 truncate">{(error as Error)?.message ?? 'Unknown error'}</p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="px-3 py-1.5 text-sm font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            {isFetching ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-5 mb-8">
        {[
          { label: 'Total Patients', value: stats.patients, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Active Cases', value: stats.active_cases, icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Prescriptions', value: stats.prescriptions, icon: FlaskConical, color: 'text-violet-600', bg: 'bg-violet-50' },
          { label: 'Follow-ups Due', value: stats.followups_due, icon: Calendar, color: 'text-orange-600', bg: 'bg-orange-50' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">{stat.label}</p>
              <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
            </div>
            {isLoading ? (
              <div className="h-9 w-16 bg-gray-100 rounded animate-pulse" />
            ) : (
              <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
            )}
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
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="px-6 py-4 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-gray-100 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-100 rounded animate-pulse w-1/3" />
                    <div className="h-3 bg-gray-100 rounded animate-pulse w-2/3" />
                  </div>
                </div>
              ))
            ) : recentCases.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No cases yet.</p>
                <a href="/cases" className="text-sm text-emerald-600 hover:underline mt-1 inline-block">
                  Create your first case
                </a>
              </div>
            ) : (
              recentCases.map((case_) => (
                <button
                  type="button"
                  key={case_.id}
                  onClick={() => router.push(`/analysis?caseId=${case_.id}`)}
                  className="w-full px-6 py-4 hover:bg-gray-50 flex items-center gap-4 text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-medium text-emerald-700">
                    {case_.patient_name?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{case_.patient_name || 'Unnamed patient'}</p>
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
                </button>
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
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="px-5 py-3.5 space-y-2">
                  <div className="h-4 bg-gray-100 rounded animate-pulse w-2/3" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-1/2" />
                </div>
              ))
            ) : upcomingFollowups.length === 0 ? (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">No upcoming follow-ups</p>
            ) : (
              upcomingFollowups.map((fu) => (
                <div key={fu.id} className="px-5 py-3.5">
                  <p className="font-medium text-gray-900 text-sm">{fu.patient_name || 'Unnamed patient'}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Clock className="w-3 h-3 text-orange-500" />
                    <p className="text-xs text-orange-600">
                      {new Date(fu.next_followup_date).toLocaleDateString()}
                    </p>
                  </div>
                  {fu.chief_complaint && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{fu.chief_complaint}</p>
                  )}
                  {fu.action_taken && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">Action: {fu.action_taken}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

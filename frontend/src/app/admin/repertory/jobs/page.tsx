'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

interface Job {
  id: string
  status: string
  year: number
  version_tag: string
  created_at: string
  repertories?: { name: string }
  users?: { email: string }
}

interface Stage {
  stage_name: string
  status: string
  records_processed: number
  started_at: string
  completed_at: string
}

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  validating: 'bg-primary-100 text-primary-700',
  approved: 'bg-cyan-100 text-cyan-700',
  ingesting: 'bg-amber-100 text-amber-700',
  live: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
}

function JobProgress({ jobId }: { jobId: string }) {
  const [stages, setStages] = useState<Stage[]>([])
  const [status, setStatus] = useState('')
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('zomeo_access_token')
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const es = new EventSource(`${API_URL}/admin/jobs/${jobId}/status`)
    esRef.current = es

    es.onmessage = (e) => {
      if (e.data === '[DONE]') { es.close(); return }
      try {
        const { stages: s, status: st } = JSON.parse(e.data)
        setStages(s || [])
        setStatus(st || '')
      } catch {}
    }

    return () => es.close()
  }, [jobId])

  return (
    <div className="mt-3 space-y-1">
      {stages.map(s => (
        <div key={s.stage_name} className="flex items-center gap-3 text-xs">
          <span className={`w-2 h-2 rounded-full ${
            s.status === 'completed' ? 'bg-green-500' :
            s.status === 'running' ? 'bg-primary-500 animate-pulse' :
            s.status === 'failed' ? 'bg-red-500' : 'bg-gray-300'
          }`} />
          <span className="font-mono text-gray-600 w-32">{s.stage_name}</span>
          <span className={s.status === 'failed' ? 'text-red-600' : 'text-gray-500'}>{s.status}</span>
          {s.records_processed > 0 && <span className="text-gray-400">{s.records_processed.toLocaleString()} rows</span>}
        </div>
      ))}
    </div>
  )
}

export default function JobsPage() {
  const [expandedJob, setExpandedJob] = useState<string | null>(null)

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['admin', 'jobs'],
    queryFn: () => api.get<Job[]>('/admin/jobs'),
    refetchInterval: 15000,
  })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Ingestion Jobs</h1>
        <p className="text-sm text-gray-500 mt-1">Live status of repertory validation and ingestion pipelines</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No jobs yet. Use the Upload Wizard to add repertory data.</div>
      ) : (
        <div className="space-y-4">
          {jobs.map(job => (
            <div key={job.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-gray-900">{job.repertories?.name || 'Unknown'}</h3>
                    <span className="text-sm text-gray-500">{job.year} · {job.version_tag}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[job.status]}`}>
                      {job.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    By {job.users?.email} · {new Date(job.created_at).toLocaleString('en-IN')}
                  </p>
                  <p className="text-xs font-mono text-gray-300 mt-0.5">{job.id}</p>
                </div>
                <button
                  onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                  className="text-xs text-primary-600 hover:underline"
                >
                  {expandedJob === job.id ? 'Hide' : 'View Progress'}
                </button>
              </div>
              {expandedJob === job.id && <JobProgress jobId={job.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

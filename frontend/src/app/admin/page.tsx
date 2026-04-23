'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { api } from '@/lib/api'

interface Stats {
  totalTenants?: number
  totalPatients?: number
  totalJobs?: number
  liveRepertories?: number
}

export default function AdminDashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get<Stats>('/admin/stats'),
  })

  const cards = [
    { label: 'Active Tenants', value: stats?.totalTenants ?? '—', href: '/admin/licences' },
    { label: 'Total Patients', value: stats?.totalPatients ?? '—', href: '/admin/licences' },
    { label: 'Ingestion Jobs', value: stats?.totalJobs ?? '—', href: '/admin/repertory/jobs' },
    { label: 'Live Repertories', value: stats?.liveRepertories ?? '—', href: '/admin/repertory/versions' },
  ]

  const quickLinks = [
    { label: '📤 Upload Repertory', desc: '6-step wizard for all 26 repertories', href: '/admin/repertory/upload' },
    { label: '⚙️ Ingestion Jobs', desc: 'Live pipeline status with SSE', href: '/admin/repertory/jobs' },
    { label: '📋 Version History', desc: 'View diffs and rollback versions', href: '/admin/repertory/versions' },
    { label: '💊 Remedy Master', desc: 'Manage remedy codes and map unknowns', href: '/admin/remedies' },
    { label: '🔑 Licences', desc: 'Assign plan-to-content licences', href: '/admin/licences' },
  ]

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Zomeo.ai Super Admin — Hompath Technologies Pvt. Ltd.</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-10">
        {cards.map(card => (
          <Link key={card.label} href={card.href}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-primary-300 transition-colors">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{card.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {quickLinks.map(link => (
          <Link key={link.href} href={link.href}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-primary-300 hover:bg-primary-50 transition-colors flex items-start gap-4">
            <div>
              <h3 className="font-semibold text-gray-900">{link.label}</h3>
              <p className="text-sm text-gray-500 mt-0.5">{link.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '@/lib/api'

export default function ReportsPage() {
  const { data: revenue = [], isLoading } = useQuery({
    queryKey: ['reports', 'revenue'],
    queryFn: () => api.get<Array<{ amount: number; created_at: string }>>('/reports/revenue'),
  })

  // Group revenue by month
  const monthly = revenue.reduce((acc: Record<string, number>, item) => {
    const month = new Date(item.created_at).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
    acc[month] = (acc[month] || 0) + item.amount
    return acc
  }, {})

  const chartData = Object.entries(monthly).map(([month, amount]) => ({ month, amount }))
  const totalRevenue = revenue.reduce((sum, r) => sum + r.amount, 0)

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Revenue, patient, and diagnosis reports</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Revenue (30d)</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">₹{totalRevenue.toLocaleString('en-IN')}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Consultations (30d)</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{revenue.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Avg per Consultation</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            ₹{revenue.length ? Math.round(totalRevenue / revenue.length).toLocaleString('en-IN') : 0}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Revenue</h2>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-gray-400">Loading...</div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-400">No data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v: number) => [`₹${v.toLocaleString('en-IN')}`, 'Revenue']} />
              <Bar dataKey="amount" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

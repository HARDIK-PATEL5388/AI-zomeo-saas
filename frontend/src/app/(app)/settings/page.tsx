'use client'

import { useState, useEffect } from 'react'
import { FlaskConical } from 'lucide-react'

export default function SettingsPage() {
  const [email, setEmail] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('user_email')
    if (stored) setEmail(stored)
  }, [])

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage your clinic and account preferences</p>
      </div>

      {/* Account */}
      <div className="bg-white rounded-xl border p-6 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">Account</h2>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
            <span className="text-xl font-bold text-emerald-600">{email?.[0]?.toUpperCase() ?? '?'}</span>
          </div>
          <div>
            <p className="font-medium text-gray-900">{email || 'Not signed in'}</p>
            <p className="text-sm text-gray-500">Administrator</p>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={email} disabled
            className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-500 cursor-not-allowed" />
        </div>
      </div>

      {/* Subscription */}
      <div className="bg-white rounded-xl border p-6 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">Subscription</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Current Plan</p>
            <p className="text-lg font-bold text-emerald-600 mt-0.5">Trial</p>
            <p className="text-xs text-gray-400 mt-0.5">Up to 1 doctor · 50 patients · No AI search</p>
          </div>
          <button className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
            Upgrade Plan
          </button>
        </div>
      </div>

      {/* About */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">HomeoRepertory SaaS</p>
            <p className="text-xs text-gray-400">Version 1.0.0 · AI-powered homeopathy platform</p>
          </div>
        </div>
      </div>
    </div>
  )
}

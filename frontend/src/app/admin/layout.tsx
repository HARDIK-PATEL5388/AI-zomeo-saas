'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Shield, LayoutDashboard, Upload, Activity, History,
  BookOpen, Key, LogOut, ChevronRight, FlaskConical,
} from 'lucide-react'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, exact: true },
  { label: 'Upload Repertory', href: '/admin/repertory/upload', icon: Upload },
  { label: 'Ingestion Jobs', href: '/admin/repertory/jobs', icon: Activity },
  { label: 'Version History', href: '/admin/repertory/versions', icon: History },
  { label: 'Remedy Master', href: '/admin/remedies', icon: BookOpen },
  { label: 'Licences', href: '/admin/licences', icon: Key },
]

function AdminSidebar({ identifier }: { identifier: string }) {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = () => {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_identifier')
    router.replace('/admin/login')
  }

  return (
    <aside className="w-60 shrink-0 bg-gray-900 text-gray-300 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-800 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center shrink-0">
          <FlaskConical className="w-4 h-4 text-white" />
        </div>
        <div>
          <div className="text-sm font-bold text-white">Zomeo<span className="text-primary-400">.ai</span></div>
          <div className="text-xs text-gray-500">Master Admin</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
              {active && <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
            </Link>
          )
        })}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-gray-800 px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            A
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-white truncate">{identifier || 'Admin'}</div>
            <div className="text-xs text-gray-500">Master Admin</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-red-400 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)
  const [identifier, setIdentifier] = useState('')

  const isLoginPage = pathname === '/admin/login'

  useEffect(() => {
    if (isLoginPage) {
      setChecked(true)
      return
    }
    const token = localStorage.getItem('admin_token')
    if (!token) {
      router.replace('/admin/login')
      return
    }
    setIdentifier(localStorage.getItem('admin_identifier') ?? '')
    setChecked(true)
  }, [isLoginPage, router])

  // Prevent flash of content before auth check
  if (!checked) return null

  // Login page — render without sidebar
  if (isLoginPage) return <>{children}</>

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AdminSidebar identifier={identifier} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}

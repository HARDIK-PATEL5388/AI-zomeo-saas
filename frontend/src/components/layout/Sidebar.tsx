'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, FolderOpen, BookOpen, BarChart2,
  Pill, Calendar, Settings, LogOut, Sparkles, BookMarked,
  FileText, ShieldCheck,
} from 'lucide-react'
import clsx from 'clsx'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/patients', label: 'Patients', icon: Users },
  { href: '/cases', label: 'Cases', icon: FolderOpen },
  { href: '/repertory', label: 'Repertory', icon: BookOpen },
  { href: '/analysis', label: 'Analysis', icon: BarChart2 },
  { href: '/ai-assistant', label: 'AI Assistant', icon: Sparkles },
  { href: '/prescriptions', label: 'Prescriptions', icon: Pill },
  { href: '/followups', label: 'Follow-ups', icon: Calendar },
  { href: '/appointments', label: 'Appointments', icon: Calendar },
  { href: '/books', label: 'Books', icon: BookMarked },
  { href: '/reports', label: 'Reports', icon: FileText },
]

export default function Sidebar() {
  const pathname = usePathname()

  const handleLogout = () => {
    localStorage.removeItem('zomeo_access_token')
    window.location.href = '/login'
  }

  const isAdmin = typeof window !== 'undefined' && !!localStorage.getItem('zomeo_is_admin')

  return (
    <aside className="w-58 bg-white border-r flex flex-col h-full shrink-0" style={{ width: 232 }}>
      {/* Logo */}
      <div className="px-4 py-4 border-b">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-bold text-gray-900 text-sm leading-tight">Zomeo.ai</span>
            <p className="text-xs text-gray-400 leading-none">AI Homeopathy Platform</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <Icon className={clsx('w-4 h-4 shrink-0', active ? 'text-primary-600' : 'text-gray-400')} />
              {label}
            </Link>
          )
        })}

        {/* Admin section */}
        {isAdmin && (
          <>
            <div className="pt-3 pb-1 px-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Admin</p>
            </div>
            <Link href="/admin"
              className={clsx('flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname.startsWith('/admin') ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50')}>
              <ShieldCheck className={clsx('w-4 h-4 shrink-0', pathname.startsWith('/admin') ? 'text-purple-600' : 'text-gray-400')} />
              Admin Portal
            </Link>
          </>
        )}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-3 border-t space-y-0.5">
        <Link
          href="/settings"
          className={clsx(
            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            pathname === '/settings' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          )}
        >
          <Settings className={clsx('w-4 h-4 shrink-0', pathname === '/settings' ? 'text-primary-600' : 'text-gray-400')} />
          Settings
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0 text-gray-400" />
          Log out
        </button>
      </div>
    </aside>
  )
}

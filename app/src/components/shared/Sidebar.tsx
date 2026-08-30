'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronsLeft, ChevronsRight, ClipboardCheck, MoreHorizontal, WalletCards } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/recommendations', label: 'Recommendations', icon: ClipboardCheck },
  { href: '/positions', label: 'Positions', icon: WalletCards },
  { href: '/more', label: 'More', icon: MoreHorizontal },
] as const

/**
 * Persistent on desktop (≥1024px), user-collapsible icon-only from tablet
 * width up (≥640px); hidden below that in favor of MobileTabBar.
 */
export default function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border/80 bg-card/40 backdrop-blur-xl transition-[width] duration-200 sm:flex',
        collapsed ? 'w-[4.5rem]' : 'w-64',
      )}
    >
      <div className={cn('flex items-center px-5 py-6', collapsed && 'justify-center px-0')}>
        {!collapsed && <span className="text-lg font-semibold tracking-[-0.03em] text-foreground">Artisan</span>}
      </div>

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                collapsed && 'justify-center px-0',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-card hover:text-foreground',
              )}
            >
              <Icon size={20} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </nav>

      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn(
          'mx-3 mb-6 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium text-muted-foreground transition hover:bg-card hover:text-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  )
}

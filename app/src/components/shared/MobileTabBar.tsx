'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardCheck, LayoutDashboard, Newspaper, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/recommendations', label: 'Recs', icon: ClipboardCheck },
  { href: '/briefing', label: 'Briefing', icon: Newspaper },
  { href: '/strategy', label: 'Strategy', icon: Settings2 },
] as const

/** Exactly 4 items, mobile only (<640px) — Sidebar takes over from there. */
export default function MobileTabBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-4 sm:hidden"
    >
      <div className="mx-auto flex max-w-xl items-center justify-between gap-2 rounded-[1.75rem] border border-border/80 bg-[#0e0e13]/88 px-3 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl pointer-events-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[0.68rem] font-medium tracking-[0.02em] transition',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-full transition',
                  active ? 'bg-primary text-primary-foreground shadow-[0_10px_30px_rgba(255,255,255,0.16)]' : 'bg-transparent',
                )}
              >
                <Icon size={20} />
              </span>
              <span className="truncate">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

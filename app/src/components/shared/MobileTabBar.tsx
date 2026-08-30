'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardCheck, MoreHorizontal, WalletCards } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/recommendations', label: 'Recommendations', icon: ClipboardCheck },
  { href: '/positions', label: 'Positions', icon: WalletCards },
  { href: '/more', label: 'More', icon: MoreHorizontal },
] as const

/** Exactly 4 items, mobile only (<640px) — Sidebar takes over from there. */
export default function MobileTabBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-ink px-2 pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <div className="mx-auto flex max-w-xl items-center justify-between">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-1 px-2 py-3 text-[0.6rem] uppercase tracking-[0.08em] transition',
                active ? 'text-amber' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span
                className={cn(
                  'flex h-5 items-center justify-center transition',
                  active ? 'text-amber' : 'text-muted-foreground',
                )}
              >
                <Icon size={20} />
              </span>
              <span className={cn('h-1 w-1 rounded-full bg-current', !active && 'opacity-0')} />
              <span className="truncate">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

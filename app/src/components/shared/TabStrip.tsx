'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export type TabItem = { href: string; label: string }

/**
 * Section-level tab strip, directly under the page header, on every
 * breakpoint (not a second nav layer). URL-driven (Link + usePathname),
 * not Radix Tabs state — real nested routes stay the source of truth so
 * every tab is deep-linkable and the browser back button works.
 */
export default function TabStrip({ tabs }: { tabs: TabItem[] }) {
  const pathname = usePathname()

  return (
    <div className="mb-6 flex items-center gap-1 overflow-x-auto border-b border-border/70 pb-px" role="tablist">
      {tabs.map(({ href, label }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            role="tab"
            aria-selected={active}
            className={cn(
              'shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}

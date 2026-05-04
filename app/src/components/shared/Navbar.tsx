import Link from 'next/link'
import { BarChart3, TrendingUp, Zap, FileText, Settings, ClipboardCheck, Newspaper } from 'lucide-react'

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { href: '/trades', label: 'Trades', icon: TrendingUp },
  { href: '/trades/queue', label: 'Queue', icon: ClipboardCheck },
  { href: '/signals', label: 'Signals', icon: Zap },
  { href: '/briefings', label: 'Briefings', icon: Newspaper },
  { href: '/logs', label: 'Logs', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export default function Navbar() {
  return (
    <nav className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-50">
      <div className="container mx-auto px-4 flex items-center justify-between h-14">
        <Link href="/dashboard" className="font-bold text-foreground tracking-tight">
          artisan
        </Link>
        <div className="flex items-center gap-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}

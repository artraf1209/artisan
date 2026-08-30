import Link from 'next/link'

const links = [
  { href: '/recommendations/shortlist', label: 'History', detail: 'Shortlist, orders, and prior recommendations' },
  { href: '/briefing', label: 'Briefing', detail: 'Daily digest and per-agent logs' },
  { href: '/strategy', label: 'Strategy', detail: 'Configuration and risk parameters' },
]

export default function MorePage() {
  return <div className="space-y-4"><header><p className="font-[family-name:var(--font-display)] text-sm tracking-[0.14em] text-amber">ARTISAN</p><p className="mt-2 text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">Workspace</p></header><nav className="border-y border-border">{links.map((link) => <Link key={link.href} href={link.href} className="flex items-center justify-between border-b border-border py-4 last:border-0"><span><strong className="text-sm uppercase tracking-[0.06em] text-paper">{link.label}</strong><span className="mt-1 block text-xs text-muted-foreground">{link.detail}</span></span><span className="text-amber">→</span></Link>)}</nav></div>
}

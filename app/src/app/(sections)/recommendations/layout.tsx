import { Suspense } from 'react'
import Link from 'next/link'
import DetailView from '@/components/recommendations/DetailView'
import RealtimeRefresher from '@/components/shared/RealtimeRefresher'

export default function RecommendationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mb-5">
        <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.14em] text-amber">ARTISAN</p>
        <p className="mt-2 text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">Recommendations · updated after the latest pipeline run</p>
      </header>
      <nav className="mb-4 grid grid-cols-2 gap-px rounded bg-muted p-0.5 text-center text-[0.68rem] uppercase tracking-[0.08em]">
        <Link href="/recommendations" className="rounded bg-ink px-3 py-2 text-amber">New</Link>
        <Link href="/recommendations/actions" className="rounded px-3 py-2 text-muted-foreground hover:text-paper">Manage</Link>
      </nav>
      <section className="space-y-4">{children}</section>
      <RealtimeRefresher tables={['recommendations', 'position_reviews', 'trade_executions']} />
      <Suspense fallback={null}>
        <DetailView />
      </Suspense>
    </>
  )
}

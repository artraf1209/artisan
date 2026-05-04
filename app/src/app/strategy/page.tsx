export const dynamic = 'force-dynamic'

import GoalPanel from '@/components/strategy/GoalPanel'
import UniverseThesis from '@/components/strategy/UniverseThesis'
import TradePipeline from '@/components/strategy/TradePipeline'

async function fetchOverview() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/strategy/overview`, {
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

async function fetchTrades() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/strategy/trades`, {
    cache: 'no-store',
  })
  if (!res.ok) return { waiting: [], in_market: [], closed: [] }
  return res.json()
}

export default async function StrategyPage() {
  const [overview, trades] = await Promise.all([fetchOverview(), fetchTrades()])

  if (!overview) {
    return (
      <main className="min-h-screen px-4 pb-32 pt-8">
        <p className="text-sm text-muted-foreground">Unable to load strategy data.</p>
      </main>
    )
  }

  const { strategy, account, universe } = overview
  const currentEquity: number | null = account?.equity ?? null

  return (
    <main className="min-h-screen px-4 pb-32 pt-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <GoalPanel strategy={strategy} currentEquity={currentEquity} />
        <UniverseThesis rows={universe} />
        <TradePipeline
          waiting={trades.waiting}
          in_market={trades.in_market}
          closed={trades.closed}
        />
      </div>
    </main>
  )
}

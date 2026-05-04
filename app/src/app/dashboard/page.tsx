import { createServerClient } from '@/lib/supabase/server'
import { ClipboardCheck, Newspaper } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import PortfolioCard from '@/components/dashboard/PortfolioCard'
import ActivePositions from '@/components/dashboard/ActivePositions'
import RecentTrades from '@/components/dashboard/RecentTrades'
import ActivityHeatmapCard from '@/components/dashboard/ActivityHeatmapCard'
import SignalOverviewCard from '@/components/dashboard/SignalOverviewCard'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createServerClient()

  const [{ data: positions }, { data: trades }, { data: signals }, { count: pendingApprovals }] = await Promise.all([
    supabase.from('positions').select('*').order('updated_at', { ascending: false }),
    supabase.from('trades').select('*').order('created_at', { ascending: false }).limit(10),
    supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(5),
    supabase
      .from('signal_events')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ])

  return (
    <PageShell
      eyebrow="Artisan PWA"
      title="Dashboard"
      subtitle="A mobile-first control room for signals, approvals, and live trading context."
      actions={[
        { href: '/trades/queue', label: 'Approval Queue', icon: ClipboardCheck },
        { href: '/briefings', label: 'Briefings', icon: Newspaper },
      ]}
    >
      <div className="page-grid xl:auto-rows-[minmax(0,1fr)]">
        <PortfolioCard positions={positions ?? []} />
        <SignalOverviewCard
          signals={signals ?? []}
          pendingApprovals={pendingApprovals ?? 0}
        />
        <ActivityHeatmapCard
          tradeCount={(trades ?? []).length}
          signalCount={(signals ?? []).length}
        />
        <ActivePositions positions={positions ?? []} />
        <RecentTrades trades={trades ?? []} />
      </div>
    </PageShell>
  )
}

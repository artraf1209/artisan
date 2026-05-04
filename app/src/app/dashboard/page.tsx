import { createServerClient } from '@/lib/supabase/server'
import { ClipboardCheck, Newspaper } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import PortfolioCard from '@/components/dashboard/PortfolioCard'
import ActivePositions from '@/components/dashboard/ActivePositions'
import RecentTrades from '@/components/dashboard/RecentTrades'
import ActivityHeatmapCard from '@/components/dashboard/ActivityHeatmapCard'
import SignalOverviewCard from '@/components/dashboard/SignalOverviewCard'

export const dynamic = 'force-dynamic'

const ACTIVITY_DAY_COUNT = 30

type ActivityRow = {
  created_at?: string | null
  reviewed_at?: string | null
}

function toUtcDayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function buildEmptyActivityDays() {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - (ACTIVITY_DAY_COUNT - 1))

  return Array.from({ length: ACTIVITY_DAY_COUNT }, (_, index) => {
    const day = new Date(start)
    day.setUTCDate(start.getUTCDate() + index)
    return {
      date: toUtcDayKey(day),
      count: 0,
    }
  })
}

function countActivityByDay(rows: ActivityRow[], field: 'created_at' | 'reviewed_at') {
  const days = buildEmptyActivityDays()
  const counts = new Map(days.map((day) => [day.date, 0]))

  for (const row of rows) {
    const value = row[field]
    if (!value) continue
    const key = value.slice(0, 10)
    if (!counts.has(key)) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return days.map((day) => ({
    ...day,
    count: counts.get(day.date) ?? 0,
  }))
}

export default async function DashboardPage() {
  const supabase = await createServerClient()
  const activitySince = new Date()
  activitySince.setUTCHours(0, 0, 0, 0)
  activitySince.setUTCDate(activitySince.getUTCDate() - (ACTIVITY_DAY_COUNT - 1))

  const [
    { data: positions },
    { data: trades },
    { data: signals },
    { count: pendingApprovals },
    { data: signalEvents },
    { data: reviewedSignals },
    { data: tradeIntents },
  ] = await Promise.all([
    supabase.from('positions').select('*').order('updated_at', { ascending: false }),
    supabase.from('trades').select('*').order('created_at', { ascending: false }).limit(10),
    supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(5),
    supabase
      .from('signal_events')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('signal_events')
      .select('created_at')
      .gte('created_at', activitySince.toISOString()),
    supabase
      .from('signal_events')
      .select('reviewed_at')
      .not('reviewed_at', 'is', null)
      .gte('reviewed_at', activitySince.toISOString()),
    supabase
      .from('trade_intents')
      .select('created_at')
      .gte('created_at', activitySince.toISOString()),
  ])

  const activityLanes = [
    {
      label: 'Flow',
      noun: 'flow events',
      days: countActivityByDay((tradeIntents ?? []) as ActivityRow[], 'created_at'),
    },
    {
      label: 'Queue',
      noun: 'queue decisions',
      days: countActivityByDay((reviewedSignals ?? []) as ActivityRow[], 'reviewed_at'),
    },
    {
      label: 'Signals',
      noun: 'signals',
      days: countActivityByDay((signalEvents ?? []) as ActivityRow[], 'created_at'),
    },
  ].map((lane) => ({
    ...lane,
    total: lane.days.reduce((sum, day) => sum + day.count, 0),
  }))

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
        <ActivityHeatmapCard lanes={activityLanes} />
        <ActivePositions positions={positions ?? []} />
        <RecentTrades trades={trades ?? []} />
      </div>
    </PageShell>
  )
}

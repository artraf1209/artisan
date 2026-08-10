import { BarChart3, ClipboardCheck } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import AccountCharts, { type AccountChartPoint } from '@/components/account/AccountCharts'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAlpacaAccountState, type AlpacaAccountState } from '@/lib/alpaca'
import { DEFAULT_ACCOUNT_ID } from '@/lib/queue'
import { formatCurrency, formatPercent } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type SnapshotRow = {
  account_id: string
  snapshot_date: string
  equity: number | string
  drawdown_from_high_pct: number | string | null
}

type BenchmarkBarRow = {
  bar_time: string
  close: number | string
}

type StrategyConfigRow = {
  risk_params?: {
    max_drawdown_tolerance_pct?: number
  } | null
  performance_goals?: {
    benchmark_symbol?: string
    max_drawdown_tolerance_pct?: number
  } | null
}

type DecisionOutcomeRow = {
  mode: string | null
  resolution: string | null
  r_multiple: number | string | null
  days_to_resolution: number | string | null
}

type OutcomeStats = {
  count: number
  win_rate: number | null
  avg_r_multiple: number | null
  avg_days_to_resolution: number | null
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function computeOutcomeStats(rows: DecisionOutcomeRow[]): OutcomeStats {
  const resolved = rows.filter((row) => row.resolution && row.resolution !== 'still_open')
  const hitTarget = resolved.filter((row) => row.resolution === 'hit_target').length
  const hitStop = resolved.filter((row) => row.resolution === 'hit_stop').length
  const winDenominator = hitTarget + hitStop
  const rMultiples = resolved
    .map((row) => toNumber(row.r_multiple))
    .filter((value): value is number => value != null)
  const days = resolved
    .map((row) => toNumber(row.days_to_resolution))
    .filter((value): value is number => value != null)

  return {
    count: resolved.length,
    win_rate: winDenominator > 0 ? round(hitTarget / winDenominator, 4) : null,
    avg_r_multiple:
      rMultiples.length > 0 ? round(rMultiples.reduce((sum, value) => sum + value, 0) / rMultiples.length, 4) : null,
    avg_days_to_resolution:
      days.length > 0 ? round(days.reduce((sum, value) => sum + value, 0) / days.length, 2) : null,
  }
}

function buildChartData(
  snapshots: SnapshotRow[],
  benchmarkBars: BenchmarkBarRow[],
  drawdownLimitPct: number,
): AccountChartPoint[] {
  if (snapshots.length === 0) {
    return []
  }

  const benchmarkByDate = new Map<string, number>()
  for (const row of benchmarkBars) {
    const date = row.bar_time.slice(0, 10)
    const close = toNumber(row.close)
    if (close != null) {
      benchmarkByDate.set(date, close)
    }
  }

  let firstEquity: number | null = null
  let firstBenchmarkClose: number | null = null
  let rollingBenchmarkClose: number | null = null

  return snapshots.map((snapshot) => {
    const equity = toNumber(snapshot.equity)
    if (firstEquity == null && equity != null) {
      firstEquity = equity
    }

    const benchmarkClose = benchmarkByDate.get(snapshot.snapshot_date) ?? rollingBenchmarkClose
    if (benchmarkClose != null) {
      rollingBenchmarkClose = benchmarkClose
      if (firstBenchmarkClose == null) {
        firstBenchmarkClose = benchmarkClose
      }
    }

    return {
      date: snapshot.snapshot_date,
      equity,
      benchmark:
        firstEquity != null && firstBenchmarkClose != null && benchmarkClose != null
          ? round(firstEquity * (benchmarkClose / firstBenchmarkClose), 2)
          : null,
      drawdown_pct:
        toNumber(snapshot.drawdown_from_high_pct) != null
          ? round((toNumber(snapshot.drawdown_from_high_pct) ?? 0) * 100, 2)
          : null,
      drawdown_limit_pct: round(drawdownLimitPct * -100, 2),
    }
  })
}

export default async function AccountPage() {
  const supabase = (await createServerClient()) as any
  const accountStatePromise = fetchAlpacaAccountState()
    .then((value) => ({ data: value as AlpacaAccountState | null, error: null }))
    .catch((error) => ({
      data: null,
      error: error instanceof Error ? error.message : 'Failed to load Alpaca account state.',
    }))

  const [{ data: latestSnapshot }, { data: latestStrategy }] = await Promise.all([
    supabase
      .from('portfolio_snapshots')
      .select('account_id, snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('strategies')
      .select('risk_params, performance_goals')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const accountId = latestSnapshot?.account_id ?? DEFAULT_ACCOUNT_ID
  const strategyConfig = (latestStrategy ?? null) as StrategyConfigRow | null
  const benchmarkSymbol = strategyConfig?.performance_goals?.benchmark_symbol ?? 'SPY'
  const drawdownTolerancePct =
    Number(
      strategyConfig?.performance_goals?.max_drawdown_tolerance_pct ??
        strategyConfig?.risk_params?.max_drawdown_tolerance_pct ??
        0.18,
    )

  const [
    accountStateResult,
    { data: snapshotsData },
    { data: decisionOutcomesData },
  ] = await Promise.all([
    accountStatePromise,
    supabase
      .from('portfolio_snapshots')
      .select('account_id, snapshot_date, equity, drawdown_from_high_pct')
      .eq('account_id', accountId)
      .order('snapshot_date', { ascending: true }),
    supabase
      .from('decision_outcomes')
      .select('mode, resolution, r_multiple, days_to_resolution')
      .neq('resolution', 'still_open')
      .order('created_at', { ascending: false })
      .limit(1000),
  ])

  const snapshots = (snapshotsData ?? []) as SnapshotRow[]
  const firstSnapshotDate = snapshots[0]?.snapshot_date
  const lastSnapshotDate = snapshots[snapshots.length - 1]?.snapshot_date

  const { data: benchmarkBarsData } =
    firstSnapshotDate && lastSnapshotDate
      ? await supabase
          .from('price_bars')
          .select('bar_time, close')
          .eq('symbol', benchmarkSymbol)
          .gte('bar_time', firstSnapshotDate)
          .lte('bar_time', `${lastSnapshotDate}T23:59:59Z`)
          .order('bar_time', { ascending: true })
      : { data: [] }

  const chartData = buildChartData(
    snapshots,
    (benchmarkBarsData ?? []) as BenchmarkBarRow[],
    drawdownTolerancePct,
  )

  const outcomeRows = (decisionOutcomesData ?? []) as DecisionOutcomeRow[]
  const realStats = computeOutcomeStats(outcomeRows.filter((row) => row.mode === 'real'))
  const shadowStats = computeOutcomeStats(outcomeRows.filter((row) => row.mode === 'shadow'))
  const latestDrawdownPct =
    snapshots.length > 0 ? (toNumber(snapshots[snapshots.length - 1]?.drawdown_from_high_pct) ?? 0) * 100 : null

  return (
    <PageShell
      eyebrow="Account lens"
      title="Account"
      subtitle="Monitor live buying power, the portfolio equity curve, and how taken versus untaken decisions have actually resolved."
      actions={[
        { href: '/positions', label: 'Positions', icon: BarChart3 },
        { href: '/trades/queue', label: 'Queue', icon: ClipboardCheck },
      ]}
    >
      {accountStateResult.error ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {accountStateResult.error}
        </p>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-4">
        <MetricCard label="Equity" value={formatCurrency(accountStateResult.data?.equity)} />
        <MetricCard label="Cash" value={formatCurrency(accountStateResult.data?.cash)} />
        <MetricCard label="Buying power" value={formatCurrency(accountStateResult.data?.buying_power)} />
        <MetricCard
          label="Day P/L"
          value={formatCurrency(accountStateResult.data?.day_pnl)}
          detail={formatPercent(accountStateResult.data?.day_pnl_pct)}
          tone={(accountStateResult.data?.day_pnl ?? 0) >= 0 ? 'positive' : 'negative'}
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <MetricCard
          label="Current drawdown"
          value={latestDrawdownPct == null ? 'N/A' : `${latestDrawdownPct.toFixed(2)}%`}
          detail={`Tolerance line: ${(drawdownTolerancePct * 100).toFixed(1)}%`}
        />
        <MetricCard
          label="Snapshot days"
          value={String(snapshots.length)}
          detail={snapshots.length > 0 ? `${snapshots[0].snapshot_date} through ${snapshots[snapshots.length - 1].snapshot_date}` : 'No daily snapshots yet.'}
        />
        <MetricCard
          label="Benchmark"
          value={benchmarkSymbol}
          detail="Rebased to the first portfolio equity point for chart comparison."
        />
      </section>

      <AccountCharts data={chartData} benchmarkLabel={benchmarkSymbol} />

      <section className="grid gap-4 xl:grid-cols-2">
        <PerformanceBlock
          title="Real trades"
          subtitle="Resolved outcomes from decisions that actually became live trades."
          stats={realStats}
        />
        <PerformanceBlock
          title="Decisions you didn't take"
          subtitle="Resolved shadow outcomes from recommendations that stayed hypothetical."
          stats={shadowStats}
        />
      </section>
    </PageShell>
  )
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'positive' | 'negative'
}) {
  const valueClassName =
    tone === 'positive' ? 'text-profit' : tone === 'negative' ? 'text-loss' : 'text-foreground'

  return (
    <article className="rounded-[1.5rem] border border-border bg-card/90 p-4 shadow-[0_16px_35px_rgba(0,0,0,0.22)]">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-[-0.04em] ${valueClassName}`}>{value}</p>
      {detail ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p> : null}
    </article>
  )
}

function PerformanceBlock({
  title,
  subtitle,
  stats,
}: {
  title: string
  subtitle: string
  stats: OutcomeStats
}) {
  return (
    <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{subtitle}</p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Resolved count" value={String(stats.count)} />
        <MetricCard
          label="Win rate"
          value={stats.win_rate == null ? 'N/A' : `${(stats.win_rate * 100).toFixed(1)}%`}
        />
        <MetricCard
          label="Average R"
          value={stats.avg_r_multiple == null ? 'N/A' : `${stats.avg_r_multiple.toFixed(2)}R`}
        />
        <MetricCard
          label="Average days"
          value={stats.avg_days_to_resolution == null ? 'N/A' : `${stats.avg_days_to_resolution.toFixed(1)}d`}
        />
      </div>
    </section>
  )
}

export const dynamic = 'force-dynamic'

import { ClipboardCheck, History, Newspaper } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import StatusBadge from '@/components/shared/StatusBadge'
import { createServerClient } from '@/lib/supabase/server'
import { enterEligibleRankCutoff } from '@/lib/strategy'
import { formatCurrency } from '@/lib/utils'

type StrategySearchParams = {
  strategy?: string | string[]
}

type StrategyRow = {
  id: string
  name: string
  screening_params?: {
    shortlist_size?: number
  } | null
}

type RegimeRow = {
  run_id: string
  date: string
  regime: string
  spy_close: number | string | null
  spy_sma50: number | string | null
  spy_sma200: number | string | null
  spy_adx14: number | string | null
  spy_vol_percentile_252d: number | string | null
  spy_drawdown_from_high_pct: number | string | null
}

type FactorRow = {
  symbol: string
  sector: string | null
  rank: number | null
  composite_z: number | null
  value_z: number | null
  value_prev: number | null
  quality_z: number | null
  quality_prev: number | null
  momentum_z: number | null
  momentum_prev: number | null
  low_vol_z: number | null
  low_vol_prev: number | null
  growth_z: number | null
  growth_prev: number | null
  hard_filter_pass: boolean
}

type EntrySignalRow = {
  symbol: string
  gate_market: boolean | null
  gate_trend: boolean | null
  gate_confirmed: boolean
  setup_type: string | null
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  r_multiple: number | null
  effective_horizon_days: number | null
  actionable: boolean
}

function firstValue(value: string | string[] | undefined) {
  if (typeof value === 'string') {
    return value
  }

  return value?.[0]
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function delta(current: number | null, previous: number | null) {
  if (current == null || previous == null) {
    return null
  }

  return current - previous
}

function formatSigned(value: number | null) {
  if (value == null) {
    return 'N/A'
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function gateLabel(active: boolean | null, label: string) {
  if (active == null) {
    return `${label}: n/a`
  }

  return `${label}: ${active ? 'on' : 'off'}`
}

export default async function StrategyPage({
  searchParams,
}: {
  searchParams?: Promise<StrategySearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const requestedStrategyId = firstValue(params?.strategy)
  const supabase = (await createServerClient()) as any

  const [{ data: strategiesData }, { data: latestRegimeData }] = await Promise.all([
    supabase
      .from('strategies')
      .select('id, name, screening_params')
      .order('created_at', { ascending: false }),
    supabase
      .from('regime_snapshots')
      .select(
        'run_id, date, regime, spy_close, spy_sma50, spy_sma200, spy_adx14, spy_vol_percentile_252d, spy_drawdown_from_high_pct',
      )
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const strategies = (strategiesData ?? []) as StrategyRow[]
  const selectedStrategy =
    strategies.find((strategy) => strategy.id === requestedStrategyId) ??
    strategies[0] ??
    null
  const latestRegime = (latestRegimeData ?? null) as RegimeRow | null

  const shortlistSize = Number(selectedStrategy?.screening_params?.shortlist_size ?? 30)
  const cutoff = enterEligibleRankCutoff(latestRegime?.regime ?? 'neutral', shortlistSize)

  const [factorRowsData, entryRowsData] =
    selectedStrategy && latestRegime?.run_id
      ? await Promise.all([
          supabase
            .from('factor_scores')
            .select(
              'symbol, sector, rank, composite_z, value_z, value_prev, quality_z, quality_prev, momentum_z, momentum_prev, low_vol_z, low_vol_prev, growth_z, growth_prev, hard_filter_pass',
            )
            .eq('strategy_id', selectedStrategy.id)
            .eq('run_id', latestRegime.run_id)
            .order('composite_z', { ascending: false }),
          supabase
            .from('entry_signals')
            .select(
              'symbol, gate_market, gate_trend, gate_confirmed, setup_type, entry_price, stop_price, target_price, r_multiple, effective_horizon_days, actionable',
            )
            .eq('strategy_id', selectedStrategy.id)
            .eq('run_id', latestRegime.run_id)
            .order('symbol'),
        ])
      : [{ data: [] }, { data: [] }]

  const factorRows = ((factorRowsData.data ?? []) as Array<Record<string, unknown>>)
    .slice(0, shortlistSize)
    .map((row) => ({
      symbol: String(row.symbol),
      sector: (row.sector as string | null) ?? null,
      rank: toNumber(row.rank),
      composite_z: toNumber(row.composite_z),
      value_z: toNumber(row.value_z),
      value_prev: toNumber(row.value_prev),
      quality_z: toNumber(row.quality_z),
      quality_prev: toNumber(row.quality_prev),
      momentum_z: toNumber(row.momentum_z),
      momentum_prev: toNumber(row.momentum_prev),
      low_vol_z: toNumber(row.low_vol_z),
      low_vol_prev: toNumber(row.low_vol_prev),
      growth_z: toNumber(row.growth_z),
      growth_prev: toNumber(row.growth_prev),
      hard_filter_pass: Boolean(row.hard_filter_pass),
    } satisfies FactorRow))

  const eligibleSymbols = new Set(
    factorRows
      .filter((row) => row.rank != null && row.rank <= cutoff)
      .map((row) => row.symbol),
  )
  const factorBySymbol = new Map(factorRows.map((row) => [row.symbol, row]))

  const entryRows = ((entryRowsData.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      symbol: String(row.symbol),
      gate_market: row.gate_market as boolean | null,
      gate_trend: row.gate_trend as boolean | null,
      gate_confirmed: Boolean(row.gate_confirmed),
      setup_type: (row.setup_type as string | null) ?? null,
      entry_price: toNumber(row.entry_price),
      stop_price: toNumber(row.stop_price),
      target_price: toNumber(row.target_price),
      r_multiple: toNumber(row.r_multiple),
      effective_horizon_days: toNumber(row.effective_horizon_days),
      actionable: Boolean(row.actionable),
    } satisfies EntrySignalRow))
    .filter((row) => eligibleSymbols.has(row.symbol))
    .sort((left, right) => {
      const leftRank = factorBySymbol.get(left.symbol)?.rank ?? 999
      const rightRank = factorBySymbol.get(right.symbol)?.rank ?? 999
      return leftRank - rightRank
    })

  return (
    <PageShell
      eyebrow="Factor engine"
      title="Strategy"
      subtitle="Inspect the current market regime, the latest factor shortlist, and the entry-gate readout for the names still eligible to become ENTER ideas."
      actions={[
        { href: '/trades/queue', label: 'Queue', icon: ClipboardCheck },
        { href: '/history', label: 'History', icon: History },
        { href: '/briefings', label: 'Briefings', icon: Newspaper },
      ]}
    >
      {strategies.length > 1 ? (
        <section className="rounded-[1.5rem] border border-border bg-card/95 p-4 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
          <form action="/strategy" className="flex flex-wrap items-end gap-3">
            <label className="space-y-2 text-sm text-foreground">
              <span className="font-medium">Strategy</span>
              <select
                name="strategy"
                defaultValue={selectedStrategy?.id ?? ''}
                className="rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
              >
                {strategies.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Load
            </button>
          </form>
        </section>
      ) : null}

      <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Market Regime</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                {latestRegime?.regime ?? 'No regime snapshot'}
              </h2>
              {latestRegime?.regime ? <StatusBadge status={latestRegime.regime} /> : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {latestRegime?.date ?? 'No run date'} · cutoff rank {cutoff}
            </p>
          </div>

          <div className="grid min-w-full grid-cols-2 gap-3 sm:min-w-[28rem] sm:grid-cols-3">
            <Metric label="SPY close" value={formatCurrency(toNumber(latestRegime?.spy_close))} />
            <Metric label="SMA50" value={formatCurrency(toNumber(latestRegime?.spy_sma50))} />
            <Metric label="SMA200" value={formatCurrency(toNumber(latestRegime?.spy_sma200))} />
            <Metric label="ADX" value={toNumber(latestRegime?.spy_adx14)?.toFixed(2) ?? 'N/A'} />
            <Metric
              label="Vol percentile"
              value={toNumber(latestRegime?.spy_vol_percentile_252d) != null ? `${(toNumber(latestRegime?.spy_vol_percentile_252d)! * 100).toFixed(1)}%` : 'N/A'}
            />
            <Metric
              label="Drawdown"
              value={toNumber(latestRegime?.spy_drawdown_from_high_pct) != null ? `${(toNumber(latestRegime?.spy_drawdown_from_high_pct)! * 100).toFixed(2)}%` : 'N/A'}
            />
          </div>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
              Shortlist + Factor Scores
            </h2>
            <p className="text-sm text-muted-foreground">
              Latest factor snapshot, sorted by composite score, with delta vs the prior run.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {factorRows.length} rows · shortlist size {shortlistSize}
          </p>
        </div>

        {factorRows.length === 0 ? (
          <EmptyState description="No factor_scores rows were found for the latest pipeline run." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left">
                  <th className="pb-3 pr-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">Rank</th>
                  <th className="pb-3 pr-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">Symbol</th>
                  <th className="pb-3 pr-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">Sector</th>
                  <th className="pb-3 pr-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">Value</th>
                  <th className="pb-3 pr-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">Quality</th>
                  <th className="pb-3 pr-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">Momentum</th>
                  <th className="pb-3 pr-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">Low vol</th>
                  <th className="pb-3 pr-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">Growth</th>
                  <th className="pb-3 pr-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">Composite</th>
                  <th className="pb-3 pr-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">Hard filter</th>
                  <th className="pb-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">ENTER eligible</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {factorRows.map((row) => (
                  <tr key={row.symbol} className="align-top">
                    <td className="py-4 pr-4 font-semibold text-foreground">{row.rank ?? 'N/A'}</td>
                    <td className="py-4 pr-4">
                      <div className="space-y-2">
                        <p className="font-semibold text-foreground">{row.symbol}</p>
                        <p className="text-xs text-muted-foreground">{selectedStrategy?.name ?? 'Strategy'}</p>
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-muted-foreground">{row.sector ?? 'Unknown'}</td>
                    <td className="py-4 pr-4"><ScoreWithDelta value={row.value_z} delta={delta(row.value_z, row.value_prev)} /></td>
                    <td className="py-4 pr-4"><ScoreWithDelta value={row.quality_z} delta={delta(row.quality_z, row.quality_prev)} /></td>
                    <td className="py-4 pr-4"><ScoreWithDelta value={row.momentum_z} delta={delta(row.momentum_z, row.momentum_prev)} /></td>
                    <td className="py-4 pr-4"><ScoreWithDelta value={row.low_vol_z} delta={delta(row.low_vol_z, row.low_vol_prev)} /></td>
                    <td className="py-4 pr-4"><ScoreWithDelta value={row.growth_z} delta={delta(row.growth_z, row.growth_prev)} /></td>
                    <td className="py-4 pr-4"><ScoreWithDelta value={row.composite_z} delta={null} /></td>
                    <td className="py-4 pr-4">
                      <StatusBadge status={row.hard_filter_pass ? 'approved' : 'rejected'} />
                    </td>
                    <td className="py-4">
                      <StatusBadge
                        status={row.rank != null && row.rank <= cutoff ? 'approved' : 'pending'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
              Entry Gates
            </h2>
            <p className="text-sm text-muted-foreground">
              Only the current regime&apos;s ENTER-eligible names appear here.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">{entryRows.length} eligible symbols</p>
        </div>

        {entryRows.length === 0 ? (
          <EmptyState description="No ENTER-eligible entry signals were found for the latest run." />
        ) : (
          <div className="space-y-4">
            {entryRows.map((row) => (
              <article key={row.symbol} className="rounded-[1.25rem] border border-border bg-background/35 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
                        {row.symbol}
                      </h3>
                      <StatusBadge status={row.actionable ? 'approved' : 'pending'} />
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Rank {factorBySymbol.get(row.symbol)?.rank ?? 'N/A'} · setup {row.setup_type ?? 'N/A'}
                    </p>
                  </div>

                  <div className="grid min-w-full grid-cols-2 gap-3 sm:min-w-[25rem] sm:grid-cols-4">
                    <Metric label="Entry" value={formatCurrency(row.entry_price)} />
                    <Metric label="Stop" value={formatCurrency(row.stop_price)} />
                    <Metric label="Target" value={formatCurrency(row.target_price)} />
                    <Metric label="R multiple" value={row.r_multiple != null ? `${row.r_multiple.toFixed(2)}R` : 'N/A'} />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <GatePill active={row.gate_market} label="Market" />
                  <GatePill active={row.gate_trend} label="Trend" />
                  <GatePill active={Boolean(row.setup_type)} label="Setup" />
                  <GatePill active={row.gate_confirmed} label="Confirm" />
                </div>

                <div className="mt-4 text-sm text-muted-foreground">
                  {gateLabel(row.gate_market, 'Market')} · {gateLabel(row.gate_trend, 'Trend')} ·{' '}
                  {gateLabel(Boolean(row.setup_type), 'Setup')} · {gateLabel(row.gate_confirmed, 'Confirm')} · horizon{' '}
                  {row.effective_horizon_days ?? 'N/A'}d
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/50 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function ScoreWithDelta({
  value,
  delta,
}: {
  value: number | null
  delta: number | null
}) {
  return (
    <div className="space-y-1">
      <p className="font-semibold text-foreground">{formatSigned(value)}</p>
      <p className="text-xs text-muted-foreground">Delta {formatSigned(delta)}</p>
    </div>
  )
}

function GatePill({
  active,
  label,
}: {
  active: boolean | null
  label: string
}) {
  if (active == null) {
    return (
      <span className="rounded-full border border-border bg-accent/50 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label} n/a
      </span>
    )
  }

  return (
    <span
      className={`rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${
        active
          ? 'border-profit/30 bg-profit/10 text-profit'
          : 'border-loss/30 bg-loss/10 text-loss'
      }`}
    >
      {label} {active ? 'on' : 'off'}
    </span>
  )
}

function EmptyState({ description }: { description: string }) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-border bg-background/35 px-5 py-10 text-center">
      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  )
}

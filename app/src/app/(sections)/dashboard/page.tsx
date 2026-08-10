import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAlpacaAccountState, type AlpacaAccountState } from '@/lib/alpaca'
import { loadOpenPositions } from '@/lib/positions'
import { computeSectorExposure, formatPauseStatus } from '@/lib/dashboard-overview'
import { formatCurrency, formatPercent } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type StrategyConfigRow = {
  paused_until: string | null
  risk_params?: {
    max_sector_exposure_pct?: number
    max_drawdown_tolerance_pct?: number
  } | null
  performance_goals?: {
    max_drawdown_tolerance_pct?: number
  } | null
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export default async function DashboardOverviewPage() {
  const supabase = (await createServerClient()) as any

  const accountStatePromise = fetchAlpacaAccountState()
    .then((value) => ({ data: value as AlpacaAccountState | null, error: null }))
    .catch((error) => ({
      data: null,
      error: error instanceof Error ? error.message : 'Failed to load Alpaca account state.',
    }))

  const [accountStateResult, positions, { data: latestStrategy }, { data: latestSnapshot }] = await Promise.all([
    accountStatePromise,
    loadOpenPositions(supabase),
    supabase
      .from('strategies')
      .select('paused_until, risk_params, performance_goals')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('portfolio_snapshots')
      .select('drawdown_from_high_pct')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const symbols = [...new Set(positions.map((position) => position.symbol))]
  const { data: assetsData } =
    symbols.length > 0
      ? await supabase.from('assets').select('symbol, sector').in('symbol', symbols)
      : { data: [] }

  const sectorBySymbol = new Map(
    ((assetsData ?? []) as Array<{ symbol: string; sector: string | null }>).map((asset) => [
      asset.symbol,
      asset.sector,
    ]),
  )

  const strategyConfig = (latestStrategy ?? null) as StrategyConfigRow | null
  const drawdownTolerancePct = Number(
    strategyConfig?.performance_goals?.max_drawdown_tolerance_pct ??
      strategyConfig?.risk_params?.max_drawdown_tolerance_pct ??
      0.18,
  )
  const maxSectorExposurePct = Number(strategyConfig?.risk_params?.max_sector_exposure_pct ?? 0.25)
  const currentDrawdownPct = toNumber(latestSnapshot?.drawdown_from_high_pct)
  const drawdownBreached = currentDrawdownPct != null && Math.abs(currentDrawdownPct) >= drawdownTolerancePct

  const pauseStatus = formatPauseStatus(strategyConfig?.paused_until ?? null)
  const killSwitchActive = pauseStatus.paused || drawdownBreached

  const equity = accountStateResult.data?.equity ?? null
  const sectorExposure = computeSectorExposure(
    positions.map((position) => ({
      symbol: position.symbol,
      quantity: position.quantity,
      avg_entry_price: position.avg_entry_price,
    })),
    sectorBySymbol,
    equity,
  )

  const totalUnrealizedPnl = positions.reduce((sum, position) => sum + (position.unrealized_pnl ?? 0), 0)
  const needsAttentionCount = positions.filter((position) => position.needs_attention).length

  return (
    <>
      {killSwitchActive ? (
        <div className="rounded-[1.5rem] border border-loss/40 bg-loss/10 px-5 py-4">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-loss">Kill switch active</p>
          <div className="mt-2 space-y-1 text-sm text-loss/90">
            {pauseStatus.paused ? <p>Engine is {pauseStatus.label.toLowerCase()} (set via the Telegram bot).</p> : null}
            {drawdownBreached ? (
              <p>
                Current drawdown {formatPercent((currentDrawdownPct ?? 0) * 100)} exceeds the{' '}
                {(drawdownTolerancePct * 100).toFixed(1)}% tolerance line.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

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

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Open positions</h2>
            <Link
              href="/dashboard/positions"
              className="text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition hover:decoration-foreground"
            >
              View all
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Metric label="Open" value={String(positions.length)} />
            <Metric
              label="Unrealized P/L"
              value={formatCurrency(totalUnrealizedPnl)}
              tone={totalUnrealizedPnl >= 0 ? 'positive' : 'negative'}
            />
            <Metric label="Needs attention" value={String(needsAttentionCount)} />
          </div>
        </article>

        <article className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Drawdown</h2>
          <div className="mt-4">
            <div className="h-3 w-full overflow-hidden rounded-full bg-background/60">
              <div
                className={`h-full rounded-full ${drawdownBreached ? 'bg-loss' : 'bg-primary'}`}
                style={{
                  width: `${Math.min(100, Math.abs((currentDrawdownPct ?? 0) / drawdownTolerancePct) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {currentDrawdownPct != null ? formatPercent(currentDrawdownPct * 100) : 'N/A'} current · tolerance line{' '}
              {(drawdownTolerancePct * 100).toFixed(1)}%
            </p>
          </div>
        </article>
      </section>

      <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Sector exposure</h2>
          <p className="text-sm text-muted-foreground">Cap {(maxSectorExposurePct * 100).toFixed(0)}% of equity</p>
        </div>

        {sectorExposure.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No open positions to compute sector exposure from.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {sectorExposure.map((row) => {
              const breach = row.pctOfEquity != null && row.pctOfEquity / 100 > maxSectorExposurePct
              return (
                <div key={row.sector}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{row.sector}</span>
                    <span className={breach ? 'text-loss' : 'text-muted-foreground'}>
                      {formatCurrency(row.dollarValue)} · {row.pctOfEquity != null ? `${row.pctOfEquity.toFixed(1)}%` : 'N/A'}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-background/60">
                    <div
                      className={`h-full rounded-full ${breach ? 'bg-loss' : 'bg-primary'}`}
                      style={{
                        width: `${Math.min(100, ((row.pctOfEquity ?? 0) / 100 / maxSectorExposurePct) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </>
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

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'positive' | 'negative'
}) {
  const valueClassName =
    tone === 'positive' ? 'text-profit' : tone === 'negative' ? 'text-loss' : 'text-foreground'

  return (
    <div className="rounded-2xl border border-border bg-background/50 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-medium ${valueClassName}`}>{value}</p>
    </div>
  )
}

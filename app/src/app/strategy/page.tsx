export const dynamic = 'force-dynamic'

import { ClipboardCheck, Newspaper, Zap } from 'lucide-react'
import { createServerClient } from '@/lib/supabase/server'
import PageShell from '@/components/shared/PageShell'
import StrategySummary from '@/components/strategy/StrategySummary'
import StocksToTrade from '@/components/strategy/StocksToTrade'
import WhenToTrade from '@/components/strategy/WhenToTrade'
import TradePipeline from '@/components/strategy/TradePipeline'
import type { WaitingTrade, InMarketTrade, ClosedTrade } from '@/app/api/strategy/trades/route'

const DEFAULT_STRATEGY = {
  id: '00000000-0000-0000-0000-000000000010',
  name: 'long_term_v0',
  horizon: 'long',
  threshold: 0.55,
  max_positions: 10,
  position_frac: 0.05,
  goal_growth_pct: 25,
  goal_months: 12,
  risk_level: 'moderate',
}

type StrategyView = typeof DEFAULT_STRATEGY

type StrategySearchParams = {
  strategy?: string | string[]
}

function dedupeBySymbol<T extends { symbol: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.symbol)) return false
    seen.add(row.symbol)
    return true
  })
}

export default async function StrategyPage({
  searchParams,
}: {
  searchParams?: Promise<StrategySearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const requestedStrategyId =
    typeof params?.strategy === 'string'
      ? params.strategy
      : Array.isArray(params?.strategy)
        ? params?.strategy[0]
        : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServerClient()) as any

  const strategiesRes = await supabase
    .from('strategies')
    .select('*')
    .order('created_at', { ascending: false })

  const strategies: StrategyView[] = ((strategiesRes.data ?? []) as Record<string, unknown>[])
    .map((strategy) => ({
      ...DEFAULT_STRATEGY,
      ...strategy,
    }))

  const selected =
    strategies.find((strategy) => strategy.id === requestedStrategyId) ??
    strategies[0] ??
    DEFAULT_STRATEGY

  const [
    universeRes,
    factorHistoryRes,
    entryHistoryRes,
    signalHistoryRes,
    waitingRes,
    portfolioRes,
    executionsRes,
    legacyPositionsRes,
    legacyTradesRes,
  ] = await Promise.all([
    supabase
      .from('universes')
      .select('symbol, active, added_at, screened_at')
      .eq('strategy_id', selected.id)
      .order('symbol'),
    supabase
      .from('factor_scores')
      .select('*')
      .eq('strategy_id', selected.id)
      .order('scored_at', { ascending: false })
      .limit(200),
    supabase
      .from('entry_signals')
      .select('*')
      .eq('strategy_id', selected.id)
      .order('evaluated_at', { ascending: false })
      .limit(200),
    supabase
      .from('signal_events')
      .select('symbol, status, created_at')
      .eq('strategy_id', selected.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('signal_events')
      .select('id, symbol, direction, composite_score, f_score, t_score, s_score, stop_price, target_price, status, created_at, trade_intents(id, status)')
      .eq('strategy_id', selected.id)
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('portfolio_positions')
      .select('*')
      .order('opened_at', { ascending: false }),
    supabase
      .from('trade_executions')
      .select('id, status, filled_qty, filled_price, filled_at, intent_id, trade_intents(symbol, side, quantity, dollar_value, stop_price)')
      .eq('status', 'filled')
      .order('filled_at', { ascending: false })
      .limit(50),
    supabase
      .from('positions')
      .select('*')
      .order('updated_at', { ascending: false }),
    supabase
      .from('trades')
      .select('*')
      .eq('status', 'filled')
      .order('filled_at', { ascending: false })
      .limit(50),
  ])

  const universeRows = ((universeRes.data ?? []) as Record<string, unknown>[]).filter(
    (row) => row.active !== false,
  )

  const factorHistory = (factorHistoryRes.data ?? []) as Record<string, unknown>[]
  const latestFactorAt = factorHistory[0]?.scored_at as string | undefined
  const factorRows = latestFactorAt
    ? factorHistory.filter((row) => row.scored_at === latestFactorAt)
    : []

  const entryHistory = (entryHistoryRes.data ?? []) as Record<string, unknown>[]
  const latestEntryAt = entryHistory[0]?.evaluated_at as string | undefined
  const entryRows = latestEntryAt
    ? entryHistory.filter((row) => row.evaluated_at === latestEntryAt)
    : []

  const latestSignals = dedupeBySymbol(
    ((signalHistoryRes.data ?? []) as { symbol: string; status: string; created_at: string }[]),
  )
  const latestSignalBySymbol = Object.fromEntries(latestSignals.map((row) => [row.symbol, row]))
  const entryBySymbol = Object.fromEntries(
    entryRows.map((row) => [row.symbol as string, row]),
  )
  const factorBySymbol = Object.fromEntries(
    factorRows.map((row) => [row.symbol as string, row]),
  )

  const symbolSet = new Set<string>([
    ...universeRows.map((row) => row.symbol as string),
    ...factorRows.map((row) => row.symbol as string),
    ...entryRows.map((row) => row.symbol as string),
  ])

  const assetsRes =
    symbolSet.size > 0
      ? await supabase
          .from('assets')
          .select('symbol, name, sector')
          .in('symbol', [...symbolSet])
      : { data: [] }

  const assetsBySymbol = Object.fromEntries(
    ((assetsRes.data ?? []) as { symbol: string; name: string | null; sector: string | null }[]).map(
      (asset) => [asset.symbol, asset],
    ),
  )

  const stockRows = factorRows.map((row) => ({
    symbol: row.symbol as string,
    name: (assetsBySymbol[row.symbol as string] as { name?: string | null } | undefined)?.name ?? null,
    sector:
      (assetsBySymbol[row.symbol as string] as { sector?: string | null } | undefined)?.sector ??
      (row.sector as string | null) ??
      null,
    rank: row.rank as number | null,
    composite_z: row.composite_z as number | null,
    value_z: row.value_z as number | null,
    quality_z: row.quality_z as number | null,
    momentum_z: row.momentum_z as number | null,
    low_vol_z: row.low_vol_z as number | null,
    growth_z: row.growth_z as number | null,
    hard_filter_pass: Boolean(row.hard_filter_pass),
    is_new: Boolean(row.is_new),
    setup_type: (entryBySymbol[row.symbol as string] as { setup_type?: string | null } | undefined)?.setup_type ?? null,
    signal_status:
      (latestSignalBySymbol[row.symbol as string] as { status?: string } | undefined)?.status ?? null,
  }))

  const timingRows = entryRows.map((row) => ({
    symbol: row.symbol as string,
    name: (assetsBySymbol[row.symbol as string] as { name?: string | null } | undefined)?.name ?? null,
    rank: (factorBySymbol[row.symbol as string] as { rank?: number | null } | undefined)?.rank ?? null,
    gate_market: row.gate_market as boolean | null,
    gate_trend: row.gate_trend as boolean | null,
    setup_type: row.setup_type as string | null,
    gate_confirmed: Boolean(row.gate_confirmed),
    entry_price: row.entry_price as number | null,
    stop_price: row.stop_price as number | null,
    target_price: row.target_price as number | null,
    atr: row.atr as number | null,
    r_multiple: row.r_multiple as number | null,
    shares: row.shares as number | null,
    dollar_risk: row.dollar_risk as number | null,
    actionable: Boolean(row.actionable),
  }))

  const waiting: WaitingTrade[] = ((waitingRes.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    symbol: row.symbol as string,
    direction: row.direction as string,
    composite_score: row.composite_score as number,
    f_score: row.f_score as number,
    t_score: row.t_score as number,
    s_score: row.s_score as number,
    stop_price: row.stop_price as number | null,
    target_price: row.target_price as number | null,
    status: row.status as string,
    created_at: row.created_at as string,
    has_intent: Array.isArray(row.trade_intents)
      ? (row.trade_intents as unknown[]).length > 0
      : Boolean(row.trade_intents),
  }))

  const hybridPositions = (portfolioRes.data ?? []) as Record<string, unknown>[]
  const legacyPositions = (legacyPositionsRes.data ?? []) as Record<string, unknown>[]

  const inMarket: InMarketTrade[] =
    hybridPositions.length > 0
      ? hybridPositions.map((row) => ({
          id: row.id as string,
          symbol: row.symbol as string,
          quantity: row.quantity as number,
          avg_entry_price: row.avg_entry_price as number,
          current_price: row.current_price as number | null,
          unrealized_pnl: row.unrealized_pnl as number | null,
          unrealized_pnl_pct:
            row.unrealized_pnl != null && row.avg_entry_price
              ? ((row.unrealized_pnl as number) / ((row.avg_entry_price as number) * (row.quantity as number))) * 100
              : null,
          stop_price: row.stop_price as number | null,
          target_price: row.target_price as number | null,
          opened_at: row.opened_at as string,
          source: 'hybrid' as const,
        }))
      : legacyPositions.map((row) => ({
          id: row.id as string,
          symbol: row.symbol as string,
          quantity: row.quantity as number,
          avg_entry_price: row.avg_entry_price as number,
          current_price: row.current_price as number | null,
          unrealized_pnl: row.unrealized_pnl as number | null,
          unrealized_pnl_pct:
            row.unrealized_pnl != null && row.avg_entry_price
              ? ((row.unrealized_pnl as number) / ((row.avg_entry_price as number) * (row.quantity as number))) * 100
              : null,
          stop_price: null,
          target_price: null,
          opened_at: row.updated_at as string,
          source: 'legacy' as const,
        }))

  const hybridExecutions = (executionsRes.data ?? []) as Record<string, unknown>[]
  const legacyTrades = (legacyTradesRes.data ?? []) as Record<string, unknown>[]

  const closed: ClosedTrade[] =
    hybridExecutions.length > 0
      ? hybridExecutions.map((row) => {
          const intentRaw = row.trade_intents
          const intent = (Array.isArray(intentRaw) ? intentRaw[0] : intentRaw) as
            | Record<string, unknown>
            | null
          const entryPrice =
            intent?.dollar_value && intent?.quantity
              ? (intent.dollar_value as number) / (intent.quantity as number)
              : 0
          const filledPrice = row.filled_price as number | null
          const filledQty = row.filled_qty as number | null
          const pnl =
            filledPrice != null && entryPrice && filledQty != null
              ? (filledPrice - entryPrice) * filledQty
              : null

          return {
            id: row.id as string,
            symbol: (intent?.symbol as string) ?? '—',
            side: (intent?.side as string) ?? 'buy',
            quantity: filledQty ?? (intent?.quantity as number) ?? 0,
            entry_price: entryPrice,
            exit_price: filledPrice,
            pnl,
            pnl_pct: pnl != null && entryPrice ? (pnl / (entryPrice * (filledQty ?? 1))) * 100 : null,
            closed_at: row.filled_at as string | null,
            source: 'hybrid' as const,
          }
        })
      : legacyTrades.map((row) => ({
          id: row.id as string,
          symbol: row.symbol as string,
          side: row.side as string,
          quantity: row.quantity as number,
          entry_price: row.price as number,
          exit_price: row.price as number,
          pnl: null,
          pnl_pct: null,
          closed_at: row.filled_at as string | null,
          source: 'legacy' as const,
        }))

  const funnel = {
    screened: universeRows.length || symbolSet.size,
    hard_filtered: stockRows.filter((row) => row.hard_filter_pass).length,
    scored: stockRows.filter((row) => row.composite_z != null).length,
    in_portfolio: inMarket.length,
  }

  return (
    <PageShell
      eyebrow="Factor Engine"
      title="Strategy"
      subtitle="See the current factor funnel, the best-ranked names, the latest entry timing readout, and where every trade sits in the pipeline."
      actions={[
        { href: '/signals', label: 'Signals', icon: Zap },
        { href: '/trades/queue', label: 'Approval Queue', icon: ClipboardCheck },
        { href: '/briefings', label: 'Briefings', icon: Newspaper },
      ]}
    >
      <StrategySummary strategies={strategies} selected={selected} funnel={funnel} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <StocksToTrade rows={stockRows} />
        <WhenToTrade rows={timingRows} />
      </div>

      <TradePipeline waiting={waiting} in_market={inMarket} closed={closed} />
    </PageShell>
  )
}

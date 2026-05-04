export const dynamic = 'force-dynamic'

import { createServerClient } from '@/lib/supabase/server'
import PageShell from '@/components/shared/PageShell'
import GoalPanel from '@/components/strategy/GoalPanel'
import UniverseThesis from '@/components/strategy/UniverseThesis'
import TradePipeline from '@/components/strategy/TradePipeline'
import type { WaitingTrade, InMarketTrade, ClosedTrade } from '@/app/api/strategy/trades/route'

const STRATEGY_ID = '00000000-0000-0000-0000-000000000010'
const FALLBACK_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'JPM', 'UNH', 'V', 'XOM']

function dedupeBySymbol<T extends { symbol: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    if (seen.has(r.symbol)) return false
    seen.add(r.symbol)
    return true
  })
}

export default async function StrategyPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServerClient()) as any

  // ── Overview ──────────────────────────────────────────────────────────────
  const [strategyRes, accountRes, universeRes, scoresRes] = await Promise.all([
    supabase.from('strategies').select('*').eq('id', STRATEGY_ID).single(),
    supabase.from('accounts').select('equity, cash').eq('paper', true).limit(1).single(),
    supabase.from('universes').select('symbol, added_at').eq('strategy_id', STRATEGY_ID),
    supabase
      .from('composite_scores')
      .select('symbol, f_score, t_score, s_score, composite, pillars_passed, scored_at')
      .eq('strategy_id', STRATEGY_ID)
      .order('scored_at', { ascending: false })
      .limit(200),
  ])

  const strategy = strategyRes.data ?? {
    id: STRATEGY_ID,
    name: 'long_term_v0',
    horizon: 'long',
    f_weight: 0.5,
    t_weight: 0.25,
    s_weight: 0.25,
    threshold: 0.55,
    max_positions: 10,
    position_frac: 0.05,
    active: true,
    goal_growth_pct: 25,
    goal_months: 12,
    risk_level: 'moderate',
    start_equity: null,
    created_at: new Date().toISOString(),
  }

  const symbols: string[] = universeRes.data?.map((u: { symbol: string }) => u.symbol) ?? FALLBACK_SYMBOLS
  const universeRows: { symbol: string; added_at: string }[] =
    universeRes.data ?? FALLBACK_SYMBOLS.map((s: string) => ({ symbol: s, added_at: strategy.created_at }))

  const latestScores = dedupeBySymbol<{
    symbol: string; f_score: number; t_score: number; s_score: number
    composite: number; pillars_passed: number; scored_at: string
  }>(scoresRes.data ?? [])
  const scoresBySymbol = Object.fromEntries(latestScores.map(s => [s.symbol, s]))

  const { data: indicatorData } = await supabase
    .from('indicator_values')
    .select('symbol, rsi_14, macd_hist, atr_14, sma_50, sma_200, computed_at')
    .in('symbol', symbols)
    .order('computed_at', { ascending: false })
    .limit(symbols.length * 2)

  const latestIndicators = dedupeBySymbol<{
    symbol: string; rsi_14: number | null; macd_hist: number | null
    atr_14: number | null; sma_50: number | null; sma_200: number | null; computed_at: string
  }>(indicatorData ?? [])
  const indicatorsBySymbol = Object.fromEntries(latestIndicators.map(i => [i.symbol, i]))

  const since = new Date()
  since.setDate(since.getDate() - 35)

  const { data: bars } = await supabase
    .from('price_bars')
    .select('symbol, bar_time, close')
    .in('symbol', symbols)
    .gte('bar_time', since.toISOString())
    .order('bar_time', { ascending: true })
    .limit(symbols.length * 40)

  const trendBySymbol: Record<string, { current_price: number | null; trend_pct: number | null }> = {}
  if (bars && bars.length > 0) {
    const grouped: Record<string, { symbol: string; close: number }[]> = {}
    for (const bar of bars as { symbol: string; close: number }[]) {
      if (!grouped[bar.symbol]) grouped[bar.symbol] = []
      grouped[bar.symbol].push(bar)
    }
    for (const [sym, symBars] of Object.entries(grouped)) {
      const oldest = symBars[0].close
      const latest = symBars[symBars.length - 1].close
      trendBySymbol[sym] = {
        current_price: latest,
        trend_pct: oldest ? ((latest - oldest) / oldest) * 100 : null,
      }
    }
  }

  const { data: signalData } = await supabase
    .from('signal_events')
    .select('symbol, status, composite_score, created_at')
    .in('symbol', symbols)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .limit(symbols.length * 2)

  const latestSignals = dedupeBySymbol<{
    symbol: string; status: string; composite_score: number; created_at: string
  }>(signalData ?? [])
  const signalsBySymbol = Object.fromEntries(latestSignals.map(s => [s.symbol, s]))

  const { data: assetData } = await supabase
    .from('assets')
    .select('symbol, sector, name')
    .in('symbol', symbols)

  const assetsBySymbol = Object.fromEntries(
    ((assetData ?? []) as { symbol: string; sector: string | null; name: string | null }[])
      .map(a => [a.symbol, a])
  )

  const universe = universeRows.map(u => ({
    symbol: u.symbol,
    added_at: u.added_at,
    sector: (assetsBySymbol[u.symbol] as { sector: string | null } | undefined)?.sector ?? null,
    score: scoresBySymbol[u.symbol] ?? null,
    indicators: indicatorsBySymbol[u.symbol] ?? null,
    current_price: trendBySymbol[u.symbol]?.current_price ?? null,
    trend_pct: trendBySymbol[u.symbol]?.trend_pct ?? null,
    active_signal: signalsBySymbol[u.symbol] ?? null,
  }))

  // ── Trades ────────────────────────────────────────────────────────────────
  const [waitingRes, portfolioRes, executionsRes, legacyPositionsRes, legacyTradesRes] =
    await Promise.all([
      supabase
        .from('signal_events')
        .select('id, symbol, direction, composite_score, f_score, t_score, s_score, stop_price, target_price, status, created_at, trade_intents(id, status)')
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('portfolio_positions').select('*').order('opened_at', { ascending: false }),
      supabase
        .from('trade_executions')
        .select('id, status, filled_qty, filled_price, filled_at, intent_id, trade_intents(symbol, side, quantity, dollar_value, stop_price)')
        .eq('status', 'filled')
        .order('filled_at', { ascending: false })
        .limit(50),
      supabase.from('positions').select('*').order('updated_at', { ascending: false }),
      supabase.from('trades').select('*').eq('status', 'filled').order('filled_at', { ascending: false }).limit(50),
    ])

  const waiting: WaitingTrade[] = ((waitingRes.data ?? []) as Record<string, unknown>[]).map(s => ({
    id: s.id as string,
    symbol: s.symbol as string,
    direction: s.direction as string,
    composite_score: s.composite_score as number,
    f_score: s.f_score as number,
    t_score: s.t_score as number,
    s_score: s.s_score as number,
    stop_price: s.stop_price as number | null,
    target_price: s.target_price as number | null,
    status: s.status as string,
    created_at: s.created_at as string,
    has_intent: Array.isArray(s.trade_intents)
      ? (s.trade_intents as unknown[]).length > 0
      : !!s.trade_intents,
  }))

  let inMarket: InMarketTrade[]
  const hybridPositions = (portfolioRes.data ?? []) as Record<string, unknown>[]
  if (hybridPositions.length > 0) {
    inMarket = hybridPositions.map(p => ({
      id: p.id as string,
      symbol: p.symbol as string,
      quantity: p.quantity as number,
      avg_entry_price: p.avg_entry_price as number,
      current_price: p.current_price as number | null,
      unrealized_pnl: p.unrealized_pnl as number | null,
      unrealized_pnl_pct:
        p.unrealized_pnl != null && p.avg_entry_price
          ? ((p.unrealized_pnl as number) / ((p.avg_entry_price as number) * (p.quantity as number))) * 100
          : null,
      stop_price: p.stop_price as number | null,
      target_price: p.target_price as number | null,
      opened_at: p.opened_at as string,
      source: 'hybrid' as const,
    }))
  } else {
    inMarket = ((legacyPositionsRes.data ?? []) as Record<string, unknown>[]).map(p => ({
      id: p.id as string,
      symbol: p.symbol as string,
      quantity: p.quantity as number,
      avg_entry_price: p.avg_entry_price as number,
      current_price: p.current_price as number | null,
      unrealized_pnl: p.unrealized_pnl as number | null,
      unrealized_pnl_pct:
        p.unrealized_pnl != null && p.avg_entry_price
          ? ((p.unrealized_pnl as number) / ((p.avg_entry_price as number) * (p.quantity as number))) * 100
          : null,
      stop_price: null,
      target_price: null,
      opened_at: p.updated_at as string,
      source: 'legacy' as const,
    }))
  }

  let closed: ClosedTrade[]
  const hybridExecutions = (executionsRes.data ?? []) as Record<string, unknown>[]
  if (hybridExecutions.length > 0) {
    closed = hybridExecutions.map(e => {
      const intentRaw = e.trade_intents
      const intent = (Array.isArray(intentRaw) ? intentRaw[0] : intentRaw) as Record<string, unknown> | null
      const entryPrice = intent?.dollar_value && intent?.quantity
        ? (intent.dollar_value as number) / (intent.quantity as number) : 0
      const filledPrice = e.filled_price as number | null
      const filledQty = e.filled_qty as number | null
      const pnl = filledPrice != null && entryPrice && filledQty != null
        ? (filledPrice - entryPrice) * filledQty : null
      return {
        id: e.id as string,
        symbol: (intent?.symbol as string) ?? '—',
        side: (intent?.side as string) ?? 'buy',
        quantity: filledQty ?? (intent?.quantity as number) ?? 0,
        entry_price: entryPrice,
        exit_price: filledPrice,
        pnl,
        pnl_pct: pnl != null && entryPrice ? (pnl / (entryPrice * (filledQty ?? 1))) * 100 : null,
        closed_at: e.filled_at as string | null,
        source: 'hybrid' as const,
      }
    })
  } else {
    closed = ((legacyTradesRes.data ?? []) as Record<string, unknown>[]).map(t => ({
      id: t.id as string,
      symbol: t.symbol as string,
      side: t.side as string,
      quantity: t.quantity as number,
      entry_price: t.price as number,
      exit_price: t.price as number,
      pnl: null,
      pnl_pct: null,
      closed_at: t.filled_at as string | null,
      source: 'legacy' as const,
    }))
  }

  return (
    <PageShell title="Strategy">
      <GoalPanel strategy={strategy} currentEquity={accountRes.data?.equity ?? null} />
      <UniverseThesis rows={universe} />
      <TradePipeline waiting={waiting} in_market={inMarket} closed={closed} />
    </PageShell>
  )
}

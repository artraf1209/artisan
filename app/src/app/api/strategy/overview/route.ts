import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServerClient()) as any

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
    universeRes.data ?? FALLBACK_SYMBOLS.map(s => ({ symbol: s, added_at: strategy.created_at }))

  // Latest composite score per symbol
  const latestScores = dedupeBySymbol<{
    symbol: string; f_score: number; t_score: number; s_score: number
    composite: number; pillars_passed: number; scored_at: string
  }>(scoresRes.data ?? [])
  const scoresBySymbol = Object.fromEntries(latestScores.map(s => [s.symbol, s]))

  // Latest indicator values per symbol
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

  // Price trend: last 35 calendar days of daily bars
  const since = new Date()
  since.setDate(since.getDate() - 35)

  const { data: bars } = await supabase
    .from('price_bars')
    .select('symbol, bar_time, close')
    .in('symbol', symbols)
    .gte('bar_time', since.toISOString())
    .order('bar_time', { ascending: true })
    .limit(symbols.length * 40)

  // Group bars by symbol → compute trend
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

  // Latest signal per symbol
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

  // Assets metadata (sector)
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
    name: (assetsBySymbol[u.symbol] as { name: string | null } | undefined)?.name ?? null,
    score: scoresBySymbol[u.symbol] ?? null,
    indicators: indicatorsBySymbol[u.symbol] ?? null,
    current_price: trendBySymbol[u.symbol]?.current_price ?? null,
    trend_pct: trendBySymbol[u.symbol]?.trend_pct ?? null,
    active_signal: signalsBySymbol[u.symbol] ?? null,
  }))

  return NextResponse.json({
    strategy,
    account: accountRes.data ?? null,
    universe,
  })
}

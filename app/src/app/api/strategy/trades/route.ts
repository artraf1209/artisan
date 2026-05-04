import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export interface WaitingTrade {
  id: string
  symbol: string
  direction: string
  composite_score: number
  f_score: number
  t_score: number
  s_score: number
  stop_price: number | null
  target_price: number | null
  status: string
  created_at: string
  has_intent: boolean
}

export interface InMarketTrade {
  id: string
  symbol: string
  quantity: number
  avg_entry_price: number
  current_price: number | null
  unrealized_pnl: number | null
  unrealized_pnl_pct: number | null
  stop_price: number | null
  target_price: number | null
  opened_at: string
  source: 'hybrid' | 'legacy'
}

export interface ClosedTrade {
  id: string
  symbol: string
  side: string
  quantity: number
  entry_price: number
  exit_price: number | null
  pnl: number | null
  pnl_pct: number | null
  closed_at: string | null
  source: 'hybrid' | 'legacy'
}

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServerClient()) as any

  const [waitingRes, portfolioRes, executionsRes, legacyPositionsRes, legacyTradesRes] =
    await Promise.all([
      supabase
        .from('signal_events')
        .select('id, symbol, direction, composite_score, f_score, t_score, s_score, stop_price, target_price, status, created_at, trade_intents(id, status)')
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

  // Waiting
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

  // In Market — prefer hybrid portfolio_positions, fall back to legacy positions
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

  // Closed — prefer hybrid trade_executions, fall back to legacy trades
  let closed: ClosedTrade[]
  const hybridExecutions = (executionsRes.data ?? []) as Record<string, unknown>[]
  if (hybridExecutions.length > 0) {
    closed = hybridExecutions.map(e => {
      const intentRaw = e.trade_intents
      const intent = (Array.isArray(intentRaw) ? intentRaw[0] : intentRaw) as Record<string, unknown> | null
      const entryPrice =
        intent?.dollar_value && intent?.quantity
          ? (intent.dollar_value as number) / (intent.quantity as number)
          : 0
      const filledPrice = e.filled_price as number | null
      const filledQty = e.filled_qty as number | null
      const pnl =
        filledPrice != null && entryPrice && filledQty != null
          ? (filledPrice - entryPrice) * filledQty
          : null
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

  return NextResponse.json({ waiting, in_market: inMarket, closed })
}

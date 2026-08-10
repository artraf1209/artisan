export interface RiskParams {
  risk_per_trade_pct: number
  max_position_pct: number
  max_concurrent_positions: number
  max_sector_exposure_pct: number
  max_portfolio_heat_pct: number
  daily_drawdown_kill_switch_pct?: number
  max_drawdown_tolerance_pct?: number
}

export type QueueType = 'recommendation' | 'position_review'

export interface RecommendationQueueItem {
  id: string
  run_id: string | null
  strategy_id: string | null
  symbol: string
  action: 'enter' | 'watch'
  conviction: string | null
  thesis: string | null
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  atr_at_signal: number | null
  effective_horizon_days: number | null
  historical_precedent: string | null
  shares: number | null
  dollar_risk: number | null
  status: string
  created_at: string
}

export interface PositionSummary {
  id: string
  symbol: string
  quantity: number
  avg_entry_price: number
  stop_price: number | null
  target_price: number | null
  signal_id: string | null
  opened_at: string
}

export interface OriginalRecommendationSummary {
  id: string
  thesis: string | null
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  strategy_id: string | null
  effective_horizon_days?: number | null
  setup_type?: string | null
  regime?: string | null
}

export interface PositionActionQueueItem {
  id: string
  position_id: string
  symbol: string
  recommended_action: string
  reasoning: string | null
  historical_precedent: string | null
  new_stop_price: number | null
  new_target_price: number | null
  review_note: string | null
  status: string
  created_at: string
  position: PositionSummary | null
  original_recommendation: OriginalRecommendationSummary | null
}

export interface SizePreview {
  shares: number
  max_shares: number
  dollar_risk: number
  entry_price: number
  stop_price: number
  target_price: number | null
  allowed: boolean
}

export const DEFAULT_ADMIN_USER_ID = (process.env.ADMIN_USER_ID ?? '00000000-0000-0000-0000-000000000001').trim()
export const DEFAULT_ACCOUNT_ID = (process.env.ACCOUNT_ID ?? '00000000-0000-0000-0000-000000000002').trim()

export function toNumber(value: unknown, fallback: number | null = null): number | null {
  if (value == null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function computePositionSize(equity: number, entryPrice: number, stopPrice: number, params: RiskParams) {
  if (entryPrice <= 0 || entryPrice <= stopPrice) {
    return { shares: 0, dollarRisk: 0 }
  }

  const stopDistance = entryPrice - stopPrice
  const dollarRiskBudget = equity * params.risk_per_trade_pct
  const sharesByRisk = Math.floor(dollarRiskBudget / stopDistance)
  const sharesByCap = Math.floor((equity * params.max_position_pct) / entryPrice)
  const shares = Math.max(0, Math.min(sharesByRisk, sharesByCap))

  return {
    shares,
    dollarRisk: round(shares * stopDistance, 2),
  }
}

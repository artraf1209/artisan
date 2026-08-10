import type { StrategySettingsValues } from '@/lib/settings'

export type StrategyGroupDisclosure = {
  summary: string
  badges?: string[]
  formulaLines?: string[]
  detailsLabel?: string
  detailsLines?: string[]
  footnote?: string
}

type BuildStrategyGroupDisclosureInput = {
  config: StrategySettingsValues
  currentRegime: string | null
  latestEquity: number | null
  latestDrawdownFromHighPct: number | null
}

function formatCurrency(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatPercent(value: number | null, decimals = 2) {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }

  return `${(value * 100).toFixed(decimals)}%`
}

function formatMultiple(value: number | null, decimals = 2) {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }

  return `${value.toFixed(decimals)}x`
}

function computePerformanceMultiplier(
  drawdownFromHighPct: number | null,
  maxDrawdownTolerancePct: number,
) {
  if (drawdownFromHighPct == null) {
    return 1
  }

  const threshold = -Math.abs(maxDrawdownTolerancePct) / 2
  return drawdownFromHighPct <= threshold ? 0.8 : 1
}

export function buildStrategyGroupDisclosures({
  config,
  currentRegime,
  latestEquity,
  latestDrawdownFromHighPct,
}: BuildStrategyGroupDisclosureInput): Record<string, StrategyGroupDisclosure> {
  const riskBudget =
    latestEquity == null ? null : latestEquity * config.risk_params.risk_per_trade_pct
  const maxPositionNotional =
    latestEquity == null ? null : latestEquity * config.risk_params.max_position_pct
  const activeRegimeMultiplier =
    currentRegime && currentRegime in config.timing_params.regime_multipliers
      ? config.timing_params.regime_multipliers[
          currentRegime as keyof typeof config.timing_params.regime_multipliers
        ]
      : null
  const performanceMultiplier = computePerformanceMultiplier(
    latestDrawdownFromHighPct,
    config.performance_goals.max_drawdown_tolerance_pct,
  )

  return {
    'risk-sizing': {
      summary:
        'The sizing engine budgets risk from current equity first, then caps notional exposure before any sector, heat, or drawdown vetoes are checked.',
      formulaLines: [
        `dollar_risk_budget = ${formatCurrency(latestEquity)} × ${formatPercent(config.risk_params.risk_per_trade_pct)} = ${formatCurrency(riskBudget)}`,
        `shares_by_risk    = floor(dollar_risk_budget / (entry_price - stop_price))`,
        `shares_by_cap     = floor((${formatCurrency(latestEquity)} × ${formatPercent(config.risk_params.max_position_pct)}) / entry_price) = floor(${formatCurrency(maxPositionNotional)} / entry_price)`,
        'final_shares      = min(shares_by_risk, shares_by_cap)',
      ],
      badges: [
        `Heat cap ${formatPercent(config.risk_params.max_portfolio_heat_pct)}`,
        `Sector cap ${formatPercent(config.risk_params.max_sector_exposure_pct)}`,
        `Kill switch ${formatPercent(config.risk_params.daily_drawdown_kill_switch_pct)}`,
      ],
      footnote:
        'If latest equity is unavailable, the formulas still hold — the dollar substitutions will populate again on the next portfolio snapshot.',
    },
    'screening-shortlisting': {
      summary:
        'Every factor score is sector-neutralized first, then entry gates identify actionable names across the hard-pass set before the top actionable shortlist is ranked by composite score.',
      formulaLines: [
        `composite_z = ${config.screening_params.factor_weights.value.toFixed(2)}×Value + ${config.screening_params.factor_weights.quality.toFixed(2)}×Quality + ${config.screening_params.factor_weights.momentum.toFixed(2)}×Momentum + ${config.screening_params.factor_weights.low_vol.toFixed(2)}×LowVol + ${config.screening_params.factor_weights.growth.toFixed(2)}×Growth`,
        `actionable_shortlist = top ${config.screening_params.shortlist_size} actionable symbols ranked by composite_z, capped at ${config.screening_params.daily_recommendation_cap} new recommendations`,
      ],
      detailsLabel: 'Show factor methodology',
      detailsLines: [
        'Value = mean(z(net_income / market_cap), z(book_equity / market_cap), z(revenue / market_cap), z(fcf / EV), z(ebitda / EV))',
        'Quality = mean(z(gross_profit / assets), z(net_income / assets), z(ROE), z(operating_cash_flow / revenue), z(-(net_income - operating_cash_flow) / assets), z(-debt / assets), z(ebitda / interest_expense), z(-(debt - cash) / ebitda))',
        'Momentum = z((close[t-21] / close[t-252]) - 1), which keeps the 12-month trend but skips the most recent month',
        'Low Vol = mean(-z(realized_vol_252), -z(beta_60m)) so quieter names score better',
        'Growth = mean(z(revenue CAGR 3y), z(EPS CAGR 3y), z(FCF CAGR 3y)) using the latest row plus three prior annual observations',
      ],
    },
    'timing-horizon': {
      summary:
        'Setup-specific baseline holding windows are compressed by both the market regime and a drawdown-aware performance multiplier, then capped by the hard max-hold ceiling.',
      badges: [
        `Current regime ${currentRegime ?? 'unknown'}`,
        `Regime multiplier ${formatMultiple(activeRegimeMultiplier)}`,
        `Performance multiplier ${formatMultiple(performanceMultiplier)}`,
      ],
      formulaLines: [
        'effective_horizon_days = min(baseline_days[setup] × regime_multiplier × performance_multiplier, max_holding_period_days)',
        `Pullback ${config.timing_params.horizon_baseline_days.pullback}d · Breakout ${config.timing_params.horizon_baseline_days.breakout}d · Squeeze ${config.timing_params.horizon_baseline_days.squeeze}d`,
        `Earnings blackout = ${config.timing_params.earnings_blackout_pre_days} day(s) before to ${config.timing_params.earnings_blackout_post_days} day(s) after earnings`,
      ],
      footnote:
        'The performance multiplier drops to 0.80 once drawdown reaches half of max drawdown tolerance; it never extends horizons beyond baseline.',
    },
    'position-management': {
      summary:
        'Position reviews tighten risk in two steps: first by moving stops to breakeven once enough R is earned, then by trailing with ATR once a trend keeps working.',
      formulaLines: [
        `breakeven_trigger = ${config.position_mgmt_params.breakeven_trigger_r.toFixed(2)}R`,
        `trail_stop = max(current_stop, current_price - ${config.position_mgmt_params.trailing_stop_atr_multiple.toFixed(2)} × ATR_14)`,
      ],
      badges: [
        config.position_mgmt_params.auto_apply_stop_tightening
          ? 'Risk-reducing stop tightens auto-apply'
          : 'Stop tightens require review',
      ],
    },
    'performance-goals': {
      summary:
        'Performance goals provide context for reporting and agent narration, but they never loosen risk, sizing, or eligibility rules when the system is behind target.',
      formulaLines: [
        `YTD target line = ${formatPercent(config.performance_goals.target_annual_return_pct)} × (days_elapsed_in_year / 365)`,
        `Benchmark = ${config.performance_goals.benchmark_symbol} · Drawdown tolerance = ${formatPercent(config.performance_goals.max_drawdown_tolerance_pct)}`,
      ],
      footnote:
        'Performance context does not change position sizing or eligibility. See Risk & Sizing for the parameters that do.',
    },
    'cost-control': {
      summary:
        'The daily LLM budget caps agent spend for a run day; once the limit is hit, downstream agent work should refuse additional calls instead of silently degrading behavior.',
      formulaLines: [
        `daily_agent_budget = ${formatCurrency(config.performance_goals.llm_daily_cost_cap_usd)}`,
      ],
    },
  }
}

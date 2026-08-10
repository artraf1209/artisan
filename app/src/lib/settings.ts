export const FACTOR_WEIGHTS_SUM_TOLERANCE = 0.01

export type StrategyConfigColumn =
  | 'risk_params'
  | 'screening_params'
  | 'timing_params'
  | 'position_mgmt_params'
  | 'performance_goals'

type ScalarFieldType = 'decimal' | 'integer' | 'boolean' | 'string'

type MirrorTarget = {
  column: StrategyConfigColumn
  path: string[]
}

export type ScalarFieldDefinition = {
  key: string
  column: StrategyConfigColumn
  path: string[]
  label: string
  description: string
  type: ScalarFieldType
  hint: string
  min?: number
  max?: number
  step?: string
  placeholder?: string
  pattern?: RegExp
  transform?: (value: string) => string
  mirrorTargets?: MirrorTarget[]
}

export type SettingsRowDefinition = {
  id: string
  label: string
  description: string
  hint: string
  fields: ScalarFieldDefinition[]
}

export type SettingsGroupDefinition = {
  id: string
  title: string
  column: StrategyConfigColumn
  rows: SettingsRowDefinition[]
}

export type StrategySettingsRow = {
  id?: string
  name?: string | null
  risk_params?: Record<string, unknown> | null
  screening_params?: Record<string, unknown> | null
  timing_params?: Record<string, unknown> | null
  position_mgmt_params?: Record<string, unknown> | null
  performance_goals?: Record<string, unknown> | null
}

export type StrategySettingsValues = {
  risk_params: {
    risk_per_trade_pct: number
    max_position_pct: number
    max_concurrent_positions: number
    max_sector_exposure_pct: number
    max_portfolio_heat_pct: number
    daily_drawdown_kill_switch_pct: number
    max_drawdown_tolerance_pct: number
  }
  screening_params: {
    shortlist_size: number
    daily_recommendation_cap: number
    factor_weights: {
      value: number
      quality: number
      momentum: number
      low_vol: number
      growth: number
    }
  }
  timing_params: {
    max_holding_period_days: number
    horizon_baseline_days: {
      pullback: number
      breakout: number
      squeeze: number
    }
    regime_multipliers: {
      risk_on: number
      neutral: number
      risk_off: number
    }
    earnings_blackout_pre_days: number
    earnings_blackout_post_days: number
  }
  position_mgmt_params: {
    trailing_stop_atr_multiple: number
    breakeven_trigger_r: number
    auto_apply_stop_tightening: boolean
  }
  performance_goals: {
    target_annual_return_pct: number
    max_drawdown_tolerance_pct: number
    benchmark_symbol: string
    llm_daily_cost_cap_usd: number
  }
}

export type StrategySettingsFormValues = Record<string, string | boolean>

export type ParsedSettingsUpdate = Record<string, number | boolean | string>

export type ChangedSetting = {
  field: ScalarFieldDefinition
  oldValue: number | boolean | string
  newValue: number | boolean | string
}

export const DEFAULT_STRATEGY_SETTINGS: StrategySettingsValues = {
  risk_params: {
    risk_per_trade_pct: 0.01,
    max_position_pct: 0.1,
    max_concurrent_positions: 15,
    max_sector_exposure_pct: 0.25,
    max_portfolio_heat_pct: 0.08,
    daily_drawdown_kill_switch_pct: -0.03,
    max_drawdown_tolerance_pct: 0.18,
  },
  screening_params: {
    shortlist_size: 50,
    daily_recommendation_cap: 10,
    factor_weights: {
      value: 0.25,
      quality: 0.25,
      momentum: 0.25,
      low_vol: 0.1,
      growth: 0.15,
    },
  },
  timing_params: {
    max_holding_period_days: 30,
    horizon_baseline_days: {
      pullback: 20,
      breakout: 15,
      squeeze: 10,
    },
    regime_multipliers: {
      risk_on: 1,
      neutral: 0.85,
      risk_off: 0.65,
    },
    earnings_blackout_pre_days: 3,
    earnings_blackout_post_days: 1,
  },
  position_mgmt_params: {
    trailing_stop_atr_multiple: 2,
    breakeven_trigger_r: 1,
    auto_apply_stop_tightening: true,
  },
  performance_goals: {
    target_annual_return_pct: 0.25,
    max_drawdown_tolerance_pct: 0.18,
    benchmark_symbol: 'SPY',
    llm_daily_cost_cap_usd: 5,
  },
}

function decimalField(definition: Omit<ScalarFieldDefinition, 'type'>): ScalarFieldDefinition {
  return { ...definition, type: 'decimal' }
}

function integerField(definition: Omit<ScalarFieldDefinition, 'type'>): ScalarFieldDefinition {
  return { ...definition, type: 'integer' }
}

function booleanField(definition: Omit<ScalarFieldDefinition, 'type'>): ScalarFieldDefinition {
  return { ...definition, type: 'boolean' }
}

function stringField(definition: Omit<ScalarFieldDefinition, 'type'>): ScalarFieldDefinition {
  return { ...definition, type: 'string' }
}

export const STRATEGY_SETTINGS_GROUPS: SettingsGroupDefinition[] = [
  {
    id: 'risk-sizing',
    title: 'Risk & Sizing',
    column: 'risk_params',
    rows: [
      {
        id: 'risk_per_trade_pct',
        label: 'Risk per trade',
        description: 'Fraction of equity the sizing engine can put at risk on a fresh entry before any other vetoes apply.',
        hint: 'Allowed range: 0.001 to 0.05 (0.1% to 5.0% of equity).',
        fields: [
          decimalField({
            key: 'risk_per_trade_pct',
            column: 'risk_params',
            path: ['risk_per_trade_pct'],
            label: 'Risk per trade',
            description: 'Fraction of equity risked on each new entry.',
            hint: 'Allowed range: 0.001 to 0.05 (0.1% to 5.0% of equity).',
            min: 0.001,
            max: 0.05,
            step: '0.001',
          }),
        ],
      },
      {
        id: 'max_position_pct',
        label: 'Max position size',
        description: 'Caps the notional size of a single position as a fraction of current equity.',
        hint: 'Allowed range: 0.02 to 0.25 (2% to 25% of equity).',
        fields: [
          decimalField({
            key: 'max_position_pct',
            column: 'risk_params',
            path: ['max_position_pct'],
            label: 'Max position size',
            description: 'Maximum position notional as a fraction of equity.',
            hint: 'Allowed range: 0.02 to 0.25 (2% to 25% of equity).',
            min: 0.02,
            max: 0.25,
            step: '0.01',
          }),
        ],
      },
      {
        id: 'max_concurrent_positions',
        label: 'Max concurrent positions',
        description: 'Limits how many open positions the system can carry at once.',
        hint: 'Allowed range: 3 to 30 positions.',
        fields: [
          integerField({
            key: 'max_concurrent_positions',
            column: 'risk_params',
            path: ['max_concurrent_positions'],
            label: 'Max concurrent positions',
            description: 'Maximum number of simultaneous open positions.',
            hint: 'Allowed range: 3 to 30 positions.',
            min: 3,
            max: 30,
            step: '1',
          }),
        ],
      },
      {
        id: 'max_sector_exposure_pct',
        label: 'Max sector exposure',
        description: 'Hard ceiling on how much of the portfolio can be concentrated in a single sector.',
        hint: 'Allowed range: 0.10 to 0.50 (10% to 50% of equity).',
        fields: [
          decimalField({
            key: 'max_sector_exposure_pct',
            column: 'risk_params',
            path: ['max_sector_exposure_pct'],
            label: 'Max sector exposure',
            description: 'Maximum exposure to any one sector.',
            hint: 'Allowed range: 0.10 to 0.50 (10% to 50% of equity).',
            min: 0.1,
            max: 0.5,
            step: '0.01',
          }),
        ],
      },
      {
        id: 'max_portfolio_heat_pct',
        label: 'Max portfolio heat',
        description: 'Caps the sum of planned dollar risk across all open positions after reviews are applied.',
        hint: 'Allowed range: 0.02 to 0.20 (2% to 20% of equity at risk).',
        fields: [
          decimalField({
            key: 'max_portfolio_heat_pct',
            column: 'risk_params',
            path: ['max_portfolio_heat_pct'],
            label: 'Max portfolio heat',
            description: 'Maximum combined open-position risk budget.',
            hint: 'Allowed range: 0.02 to 0.20 (2% to 20% of equity at risk).',
            min: 0.02,
            max: 0.2,
            step: '0.01',
          }),
        ],
      },
      {
        id: 'daily_drawdown_kill_switch_pct',
        label: 'Daily drawdown kill switch',
        description: 'Intraday drawdown threshold that pauses new entries and flags existing risk for review.',
        hint: 'Allowed range: -0.20 to -0.005 (-20% to -0.5% in a session).',
        fields: [
          decimalField({
            key: 'daily_drawdown_kill_switch_pct',
            column: 'risk_params',
            path: ['daily_drawdown_kill_switch_pct'],
            label: 'Daily drawdown kill switch',
            description: 'Session loss threshold that halts new entries.',
            hint: 'Allowed range: -0.20 to -0.005 (-20% to -0.5% in a session).',
            min: -0.2,
            max: -0.005,
            step: '0.001',
          }),
        ],
      },
    ],
  },
  {
    id: 'screening-shortlisting',
    title: 'Screening & Shortlisting',
    column: 'screening_params',
    rows: [
      {
        id: 'shortlist_size',
        label: 'Shortlist size',
        description: 'Controls how many ranked names survive factor scoring into the daily shortlist.',
        hint: 'Allowed range: 10 to 60 names.',
        fields: [
          integerField({
            key: 'shortlist_size',
            column: 'screening_params',
            path: ['shortlist_size'],
            label: 'Shortlist size',
            description: 'Number of names retained after factor ranking.',
            hint: 'Allowed range: 10 to 60 names.',
            min: 10,
            max: 60,
            step: '1',
          }),
        ],
      },
      {
        id: 'daily_recommendation_cap',
        label: 'Daily recommendation cap',
        description: 'Maximum number of new ENTER recommendations Synthesis can surface in a single run.',
        hint: 'Allowed range: 1 to 25 recommendations.',
        fields: [
          integerField({
            key: 'daily_recommendation_cap',
            column: 'screening_params',
            path: ['daily_recommendation_cap'],
            label: 'Daily recommendation cap',
            description: 'Maximum number of fresh recommendations in one run.',
            hint: 'Allowed range: 1 to 25 recommendations.',
            min: 1,
            max: 25,
            step: '1',
          }),
        ],
      },
      {
        id: 'factor_weights',
        label: 'Factor weights',
        description: 'Relative weighting for Value, Quality, Momentum, Low Volatility, and Growth in the composite score.',
        hint: 'Each weight must be between 0 and 1. Total must equal 1.0 within +/- 0.01.',
        fields: [
          decimalField({
            key: 'factor_weights.value',
            column: 'screening_params',
            path: ['factor_weights', 'value'],
            label: 'Value',
            description: 'Weight applied to the Value factor.',
            hint: 'Allowed range: 0 to 1.',
            min: 0,
            max: 1,
            step: '0.01',
          }),
          decimalField({
            key: 'factor_weights.quality',
            column: 'screening_params',
            path: ['factor_weights', 'quality'],
            label: 'Quality',
            description: 'Weight applied to the Quality factor.',
            hint: 'Allowed range: 0 to 1.',
            min: 0,
            max: 1,
            step: '0.01',
          }),
          decimalField({
            key: 'factor_weights.momentum',
            column: 'screening_params',
            path: ['factor_weights', 'momentum'],
            label: 'Momentum',
            description: 'Weight applied to the Momentum factor.',
            hint: 'Allowed range: 0 to 1.',
            min: 0,
            max: 1,
            step: '0.01',
          }),
          decimalField({
            key: 'factor_weights.low_vol',
            column: 'screening_params',
            path: ['factor_weights', 'low_vol'],
            label: 'Low Vol',
            description: 'Weight applied to the Low Volatility factor.',
            hint: 'Allowed range: 0 to 1.',
            min: 0,
            max: 1,
            step: '0.01',
          }),
          decimalField({
            key: 'factor_weights.growth',
            column: 'screening_params',
            path: ['factor_weights', 'growth'],
            label: 'Growth',
            description: 'Weight applied to the Growth factor.',
            hint: 'Allowed range: 0 to 1.',
            min: 0,
            max: 1,
            step: '0.01',
          }),
        ],
      },
    ],
  },
  {
    id: 'timing-horizon',
    title: 'Timing & Horizon',
    column: 'timing_params',
    rows: [
      {
        id: 'max_holding_period_days',
        label: 'Max holding period',
        description: 'Outer bound on how long a position can stay open before the system evaluates it as time-expired.',
        hint: 'Allowed range: 5 to 60 calendar days.',
        fields: [
          integerField({
            key: 'max_holding_period_days',
            column: 'timing_params',
            path: ['max_holding_period_days'],
            label: 'Max holding period',
            description: 'Maximum permitted holding period in days.',
            hint: 'Allowed range: 5 to 60 calendar days.',
            min: 5,
            max: 60,
            step: '1',
          }),
        ],
      },
      {
        id: 'horizon_baseline_days',
        label: 'Baseline horizon by setup',
        description: 'Starting horizon, in calendar days, before the regime multiplier is applied for each setup type.',
        hint: 'Each setup horizon must stay between 5 and 60 days.',
        fields: [
          integerField({
            key: 'horizon_baseline_days.pullback',
            column: 'timing_params',
            path: ['horizon_baseline_days', 'pullback'],
            label: 'Pullback',
            description: 'Baseline holding window for pullback setups.',
            hint: 'Allowed range: 5 to 60 days.',
            min: 5,
            max: 60,
            step: '1',
          }),
          integerField({
            key: 'horizon_baseline_days.breakout',
            column: 'timing_params',
            path: ['horizon_baseline_days', 'breakout'],
            label: 'Breakout',
            description: 'Baseline holding window for breakout setups.',
            hint: 'Allowed range: 5 to 60 days.',
            min: 5,
            max: 60,
            step: '1',
          }),
          integerField({
            key: 'horizon_baseline_days.squeeze',
            column: 'timing_params',
            path: ['horizon_baseline_days', 'squeeze'],
            label: 'Squeeze',
            description: 'Baseline holding window for squeeze setups.',
            hint: 'Allowed range: 5 to 60 days.',
            min: 5,
            max: 60,
            step: '1',
          }),
        ],
      },
      {
        id: 'regime_multipliers',
        label: 'Regime multipliers',
        description: 'Scaling factors applied to the baseline horizon for risk-on, neutral, and risk-off conditions.',
        hint: 'Each multiplier must stay between 0.25 and 1.50.',
        fields: [
          decimalField({
            key: 'regime_multipliers.risk_on',
            column: 'timing_params',
            path: ['regime_multipliers', 'risk_on'],
            label: 'Risk on',
            description: 'Multiplier used when the market regime is risk_on.',
            hint: 'Allowed range: 0.25 to 1.50.',
            min: 0.25,
            max: 1.5,
            step: '0.01',
          }),
          decimalField({
            key: 'regime_multipliers.neutral',
            column: 'timing_params',
            path: ['regime_multipliers', 'neutral'],
            label: 'Neutral',
            description: 'Multiplier used when the market regime is neutral.',
            hint: 'Allowed range: 0.25 to 1.50.',
            min: 0.25,
            max: 1.5,
            step: '0.01',
          }),
          decimalField({
            key: 'regime_multipliers.risk_off',
            column: 'timing_params',
            path: ['regime_multipliers', 'risk_off'],
            label: 'Risk off',
            description: 'Multiplier used when the market regime is risk_off.',
            hint: 'Allowed range: 0.25 to 1.50.',
            min: 0.25,
            max: 1.5,
            step: '0.01',
          }),
        ],
      },
      {
        id: 'earnings_blackout_pre_days',
        label: 'Earnings blackout before',
        description: 'Number of days before earnings when new entries are blocked.',
        hint: 'Allowed range: 0 to 10 days.',
        fields: [
          integerField({
            key: 'earnings_blackout_pre_days',
            column: 'timing_params',
            path: ['earnings_blackout_pre_days'],
            label: 'Pre-earnings blackout',
            description: 'Days before earnings that block new entries.',
            hint: 'Allowed range: 0 to 10 days.',
            min: 0,
            max: 10,
            step: '1',
          }),
        ],
      },
      {
        id: 'earnings_blackout_post_days',
        label: 'Earnings blackout after',
        description: 'Number of days after earnings when new entries stay blocked.',
        hint: 'Allowed range: 0 to 10 days.',
        fields: [
          integerField({
            key: 'earnings_blackout_post_days',
            column: 'timing_params',
            path: ['earnings_blackout_post_days'],
            label: 'Post-earnings blackout',
            description: 'Days after earnings that block new entries.',
            hint: 'Allowed range: 0 to 10 days.',
            min: 0,
            max: 10,
            step: '1',
          }),
        ],
      },
    ],
  },
  {
    id: 'position-management',
    title: 'Position Management',
    column: 'position_mgmt_params',
    rows: [
      {
        id: 'trailing_stop_atr_multiple',
        label: 'Trailing stop ATR multiple',
        description: 'ATR multiple used when the trailing stop ratchets higher on winning positions.',
        hint: 'Allowed range: 0.5 to 5.0 ATR.',
        fields: [
          decimalField({
            key: 'trailing_stop_atr_multiple',
            column: 'position_mgmt_params',
            path: ['trailing_stop_atr_multiple'],
            label: 'Trailing stop ATR multiple',
            description: 'ATR multiple used for trailing stop calculations.',
            hint: 'Allowed range: 0.5 to 5.0 ATR.',
            min: 0.5,
            max: 5,
            step: '0.1',
          }),
        ],
      },
      {
        id: 'breakeven_trigger_r',
        label: 'Breakeven trigger',
        description: 'Profit threshold, in R, that moves the stop to entry price.',
        hint: 'Allowed range: 0.25 to 3.0R.',
        fields: [
          decimalField({
            key: 'breakeven_trigger_r',
            column: 'position_mgmt_params',
            path: ['breakeven_trigger_r'],
            label: 'Breakeven trigger',
            description: 'R-multiple threshold for moving the stop to breakeven.',
            hint: 'Allowed range: 0.25 to 3.0R.',
            min: 0.25,
            max: 3,
            step: '0.25',
          }),
        ],
      },
      {
        id: 'auto_apply_stop_tightening',
        label: 'Auto-apply stop tightening',
        description: 'Whether safe stop-tightening actions can be applied automatically without waiting for human approval.',
        hint: 'Allowed values: on or off.',
        fields: [
          booleanField({
            key: 'auto_apply_stop_tightening',
            column: 'position_mgmt_params',
            path: ['auto_apply_stop_tightening'],
            label: 'Auto-apply stop tightening',
            description: 'Automatically tighten risk-reducing stops.',
            hint: 'Allowed values: on or off.',
          }),
        ],
      },
    ],
  },
  {
    id: 'performance-goals',
    title: 'Performance Goals',
    column: 'performance_goals',
    rows: [
      {
        id: 'target_annual_return_pct',
        label: 'Target annual return',
        description: 'Performance target shown to the agents for context. It never loosens risk limits when the system is behind.',
        hint: 'Allowed range: 0.05 to 0.60 (5% to 60% annualized).',
        fields: [
          decimalField({
            key: 'target_annual_return_pct',
            column: 'performance_goals',
            path: ['target_annual_return_pct'],
            label: 'Target annual return',
            description: 'Annualized performance target for agent context.',
            hint: 'Allowed range: 0.05 to 0.60 (5% to 60% annualized).',
            min: 0.05,
            max: 0.6,
            step: '0.01',
          }),
        ],
      },
      {
        id: 'max_drawdown_tolerance_pct',
        label: 'Max drawdown tolerance',
        description: 'Maximum tolerated drawdown before the system starts tightening behavior and ultimately vetoing new risk.',
        hint: 'Allowed range: 0.05 to 0.35 (5% to 35% drawdown).',
        fields: [
          decimalField({
            key: 'max_drawdown_tolerance_pct',
            column: 'performance_goals',
            path: ['max_drawdown_tolerance_pct'],
            label: 'Max drawdown tolerance',
            description: 'Drawdown tolerance used by the engine and reporting pages.',
            hint: 'Allowed range: 0.05 to 0.35 (5% to 35% drawdown).',
            min: 0.05,
            max: 0.35,
            step: '0.01',
            mirrorTargets: [{ column: 'risk_params', path: ['max_drawdown_tolerance_pct'] }],
          }),
        ],
      },
      {
        id: 'benchmark_symbol',
        label: 'Benchmark symbol',
        description: 'Ticker used for rebasing comparison on the account page and broader performance framing.',
        hint: 'Allowed pattern: 1 to 10 uppercase letters, numbers, dots, or hyphens.',
        fields: [
          stringField({
            key: 'benchmark_symbol',
            column: 'performance_goals',
            path: ['benchmark_symbol'],
            label: 'Benchmark symbol',
            description: 'Primary comparison ticker.',
            hint: 'Allowed pattern: 1 to 10 uppercase letters, numbers, dots, or hyphens.',
            placeholder: 'SPY',
            pattern: /^[A-Z0-9.-]{1,10}$/,
            transform: (value) => value.trim().toUpperCase(),
          }),
        ],
      },
    ],
  },
  {
    id: 'cost-control',
    title: 'Cost Control',
    column: 'performance_goals',
    rows: [
      {
        id: 'llm_daily_cost_cap_usd',
        label: 'LLM daily cost cap',
        description: 'Upper budget for agent usage in a single day before downstream work should start refusing more calls.',
        hint: 'Allowed range: 0.5 to 100.0 USD per day.',
        fields: [
          decimalField({
            key: 'llm_daily_cost_cap_usd',
            column: 'performance_goals',
            path: ['llm_daily_cost_cap_usd'],
            label: 'LLM daily cost cap',
            description: 'Maximum daily agent budget in USD.',
            hint: 'Allowed range: 0.5 to 100.0 USD per day.',
            min: 0.5,
            max: 100,
            step: '0.5',
          }),
        ],
      },
    ],
  },
]

export const STRATEGY_SETTINGS_FIELDS = STRATEGY_SETTINGS_GROUPS.flatMap((group) =>
  group.rows.flatMap((row) => row.fields),
)

function cloneDefaults(): StrategySettingsValues {
  return {
    risk_params: { ...DEFAULT_STRATEGY_SETTINGS.risk_params },
    screening_params: {
      ...DEFAULT_STRATEGY_SETTINGS.screening_params,
      factor_weights: { ...DEFAULT_STRATEGY_SETTINGS.screening_params.factor_weights },
    },
    timing_params: {
      ...DEFAULT_STRATEGY_SETTINGS.timing_params,
      horizon_baseline_days: { ...DEFAULT_STRATEGY_SETTINGS.timing_params.horizon_baseline_days },
      regime_multipliers: { ...DEFAULT_STRATEGY_SETTINGS.timing_params.regime_multipliers },
    },
    position_mgmt_params: { ...DEFAULT_STRATEGY_SETTINGS.position_mgmt_params },
    performance_goals: { ...DEFAULT_STRATEGY_SETTINGS.performance_goals },
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getPathValue(source: unknown, path: string[]) {
  let current = source
  for (const segment of path) {
    if (!isPlainRecord(current) || !(segment in current)) {
      return undefined
    }
    current = current[segment]
  }
  return current
}

function setPathValue(target: Record<string, unknown>, path: string[], value: unknown) {
  let current = target
  path.forEach((segment, index) => {
    if (index === path.length - 1) {
      current[segment] = value
      return
    }

    const next = current[segment]
    if (!isPlainRecord(next)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  })
}

function normalizeConfigValue(field: ScalarFieldDefinition, value: unknown) {
  if (value == null) {
    return undefined
  }

  if (field.type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined
  }

  if (field.type === 'string') {
    return typeof value === 'string' ? value.trim() : undefined
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return undefined
  }

  return field.type === 'integer' ? Math.trunc(parsed) : parsed
}

function syncDrawdownTolerance(config: StrategySettingsValues) {
  const synced =
    Number(config.performance_goals.max_drawdown_tolerance_pct) ||
    Number(config.risk_params.max_drawdown_tolerance_pct) ||
    DEFAULT_STRATEGY_SETTINGS.performance_goals.max_drawdown_tolerance_pct

  config.performance_goals.max_drawdown_tolerance_pct = synced
  config.risk_params.max_drawdown_tolerance_pct = synced
}

export function buildEffectiveStrategySettings(row?: StrategySettingsRow | null): StrategySettingsValues {
  const config = cloneDefaults()

  if (!row) {
    return config
  }

  for (const field of STRATEGY_SETTINGS_FIELDS) {
    const columnValue = row[field.column]
    const rawValue = getPathValue(columnValue, field.path)
    const normalized = normalizeConfigValue(field, rawValue)
    if (normalized !== undefined) {
      setPathValue(config[field.column] as Record<string, unknown>, field.path, normalized)
    }
  }

  const rawPerformanceDrawdown = Number(
    getPathValue(row.performance_goals, ['max_drawdown_tolerance_pct']) ??
      Number.NaN,
  )
  const rawRiskDrawdown = Number(
    getPathValue(row.risk_params, ['max_drawdown_tolerance_pct']) ?? Number.NaN,
  )

  if (Number.isFinite(rawPerformanceDrawdown)) {
    config.performance_goals.max_drawdown_tolerance_pct = rawPerformanceDrawdown
  } else if (Number.isFinite(rawRiskDrawdown)) {
    config.performance_goals.max_drawdown_tolerance_pct = rawRiskDrawdown
  }

  syncDrawdownTolerance(config)

  return config
}

export function buildSettingsFormValues(
  config: StrategySettingsValues,
): StrategySettingsFormValues {
  const values: StrategySettingsFormValues = {}

  for (const field of STRATEGY_SETTINGS_FIELDS) {
    const value = getPathValue(config[field.column], field.path)
    values[field.key] = field.type === 'boolean' ? Boolean(value) : String(value ?? '')
  }

  return values
}

function hasOwnValue(source: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key)
}

function validateScalarValue(
  field: ScalarFieldDefinition,
  value: number | boolean | string | undefined,
) {
  if (field.type === 'boolean') {
    return typeof value === 'boolean'
      ? null
      : `${field.label} must be set to on or off.`
  }

  if (field.type === 'string') {
    if (typeof value !== 'string' || value.trim() === '') {
      return `${field.label} is required.`
    }
    if (field.pattern && !field.pattern.test(value)) {
      return `${field.label} must match the expected ticker format.`
    }
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${field.label} must be a valid number.`
  }

  if (field.type === 'integer' && !Number.isInteger(value)) {
    return `${field.label} must be a whole number.`
  }

  if (field.min != null && value < field.min) {
    return `${field.label} must be at least ${field.min}.`
  }

  if (field.max != null && value > field.max) {
    return `${field.label} must be at most ${field.max}.`
  }

  return null
}

export function normalizeSubmittedSettingsInput(values: Record<string, unknown>): {
  parsed: ParsedSettingsUpdate
  errors: Record<string, string>
} {
  const parsed: ParsedSettingsUpdate = {}
  const errors: Record<string, string> = {}

  for (const field of STRATEGY_SETTINGS_FIELDS) {
    if (!hasOwnValue(values, field.key)) {
      continue
    }

    const rawValue = values[field.key]

    if (field.type === 'boolean') {
      if (typeof rawValue !== 'boolean') {
        errors[field.key] = `${field.label} must be set to on or off.`
        continue
      }
      parsed[field.key] = rawValue
      continue
    }

    const rawText = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '')
    const trimmed = rawText.trim()

    if (trimmed === '') {
      errors[field.key] = `${field.label} is required.`
      continue
    }

    if (field.type === 'string') {
      const transformed = field.transform ? field.transform(trimmed) : trimmed
      const error = validateScalarValue(field, transformed)
      if (error) {
        errors[field.key] = error
        continue
      }
      parsed[field.key] = transformed
      continue
    }

    const parsedNumber = Number(trimmed)
    const candidate = field.type === 'integer' ? Math.trunc(parsedNumber) : parsedNumber

    if (!Number.isFinite(parsedNumber)) {
      errors[field.key] = `${field.label} must be a valid number.`
      continue
    }

    if (field.type === 'integer' && !Number.isInteger(parsedNumber)) {
      errors[field.key] = `${field.label} must be a whole number.`
      continue
    }

    const error = validateScalarValue(field, candidate)
    if (error) {
      errors[field.key] = error
      continue
    }

    parsed[field.key] = candidate
  }

  return { parsed, errors }
}

export function applySubmittedSettingsValues(
  current: StrategySettingsValues,
  updates: ParsedSettingsUpdate,
): StrategySettingsValues {
  const next = cloneDefaults()

  for (const field of STRATEGY_SETTINGS_FIELDS) {
    const currentValue = getPathValue(current[field.column], field.path)
    if (currentValue !== undefined) {
      setPathValue(next[field.column] as Record<string, unknown>, field.path, currentValue)
    }
  }

  for (const field of STRATEGY_SETTINGS_FIELDS) {
    if (!hasOwnValue(updates, field.key)) {
      continue
    }
    setPathValue(next[field.column] as Record<string, unknown>, field.path, updates[field.key])
  }

  syncDrawdownTolerance(next)

  return next
}

export function validateStrategySettings(
  config: StrategySettingsValues,
): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const field of STRATEGY_SETTINGS_FIELDS) {
    const value = getPathValue(config[field.column], field.path) as
      | number
      | boolean
      | string
      | undefined
    const error = validateScalarValue(field, value)
    if (error) {
      errors[field.key] = error
    }
  }

  const factorWeights = config.screening_params.factor_weights
  const factorWeightSum =
    factorWeights.value +
    factorWeights.quality +
    factorWeights.momentum +
    factorWeights.low_vol +
    factorWeights.growth

  if (Math.abs(factorWeightSum - 1) > FACTOR_WEIGHTS_SUM_TOLERANCE) {
    errors.factor_weights = `Factor weights must sum to 1.0 within +/- ${FACTOR_WEIGHTS_SUM_TOLERANCE.toFixed(2)}. Current total: ${factorWeightSum.toFixed(2)}.`
  }

  return errors
}

export function getChangedSettings(
  current: StrategySettingsValues,
  next: StrategySettingsValues,
): ChangedSetting[] {
  const changes: ChangedSetting[] = []

  for (const field of STRATEGY_SETTINGS_FIELDS) {
    const oldValue = getPathValue(current[field.column], field.path) as
      | number
      | boolean
      | string
      | undefined
    const newValue = getPathValue(next[field.column], field.path) as
      | number
      | boolean
      | string
      | undefined

    if (oldValue !== undefined && newValue !== undefined && oldValue !== newValue) {
      changes.push({ field, oldValue, newValue })
    }
  }

  return changes
}

export function buildStrategySettingsUpdatePatch(
  row: StrategySettingsRow,
  changes: ChangedSetting[],
  next: StrategySettingsValues,
) {
  const patch: Partial<Record<StrategyConfigColumn, Record<string, unknown>>> = {}

  for (const change of changes) {
    const targets: MirrorTarget[] = [
      { column: change.field.column, path: change.field.path },
      ...(change.field.mirrorTargets ?? []),
    ]

    for (const target of targets) {
      if (!patch[target.column]) {
        patch[target.column] = isPlainRecord(row[target.column])
          ? { ...(row[target.column] as Record<string, unknown>) }
          : {}
      }

      const nextValue = getPathValue(next[target.column], target.path)
      setPathValue(patch[target.column] as Record<string, unknown>, target.path, nextValue)
    }
  }

  return patch
}

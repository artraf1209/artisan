import { toNumber, type RiskParams } from '@/lib/queue'

export interface RecommendationDetailRow {
  id: string
  run_id: string | null
  strategy_id: string | null
  symbol: string
  action: 'enter' | 'watch'
  conviction: string | null
  thesis: string | null
  setup_type: string | null
  regime: string | null
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
  reviewed_at: string | null
  review_note: string | null
}

export interface EntrySignalDetail {
  gate_market: boolean | null
  gate_trend: boolean | null
  gate_confirmed: boolean
  setup_type: string | null
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  atr: number | null
  r_multiple: number | null
  effective_horizon_days: number | null
  actionable: boolean
}

export interface FactorScoreDetail {
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
  is_new: boolean
}

export interface IndicatorValuesDetail {
  computed_at: string
  rsi_14: number | null
  adx_14: number | null
  macd_hist: number | null
  sma_50: number | null
  sma_200: number | null
  atr_14: number | null
}

export interface FundamentalOutput {
  summary: string
  key_drivers: string[]
  quality_assessment: 'high' | 'medium' | 'low' | 'concerning'
  red_flags: string[]
  trend_vs_prior_run: 'improving' | 'stable' | 'deteriorating' | 'no_prior_data'
  historical_precedent: string
}

export interface TechnicalOutput {
  summary: string
  setup_quality: 'strong' | 'adequate' | 'marginal' | 'poor'
  confirmation_strength: string
  technical_invalidation_note: string
  regime_fit: string
  historical_precedent: string
}

export interface SentimentOutput {
  summary: string
  sentiment_direction: 'positive' | 'neutral' | 'negative' | 'mixed'
  materiality: 'high' | 'medium' | 'low' | 'none'
  catalysts_identified: string[]
  red_flags: string[]
  historical_precedent: string
}

export interface AnalystAnalysis<T> {
  output: T
  model: string | null
  prompt_version: string | null
  created_at: string
}

export interface SynthesisRecommendationEntry {
  symbol: string
  action: 'enter' | 'watch' | 'skip'
  conviction: 'high' | 'medium' | 'low'
  headline?: string
  sentiment_note?: string
  technical_note?: string
  fundamental_note?: string
  thesis: string
  invalidation_conditions: string[]
  redundancy_note: string
  historical_precedent: string
}

export interface PositionReviewEntry {
  position_id: string
  symbol: string
  recommended_action: 'hold' | 'trim' | 'add' | 'close' | 'tighten_stop' | 'widen_target'
  reasoning: string
  suggested_new_stop: number | null
  suggested_new_target: number | null
  historical_precedent: string
}

export interface DecisionOutcomeDetail {
  mode: string | null
  resolution: string | null
  resolved_at: string | null
  days_to_resolution: number | null
  r_multiple: number | null
  entry_price_reference: number | null
  stop_price: number | null
  target_price: number | null
}

export interface RecommendationDetail {
  recommendation: RecommendationDetailRow
  entrySignal: EntrySignalDetail | null
  factorScore: FactorScoreDetail | null
  indicatorValues: IndicatorValuesDetail | null
  fundamental: AnalystAnalysis<FundamentalOutput> | null
  technical: AnalystAnalysis<TechnicalOutput> | null
  sentiment: AnalystAnalysis<SentimentOutput> | null
  synthesis: SynthesisRecommendationEntry | null
  currentRiskParams: RiskParams | null
  decisionOutcome: DecisionOutcomeDetail | null
}

const AGENT_ANALYSES_COLUMNS = 'agent_type, symbol, output, prompt_version, model, created_at'

export async function loadRecommendationDetail(
  supabase: any,
  recommendationId: string,
): Promise<RecommendationDetail | null> {
  const { data: recommendationData, error: recommendationError } = await supabase
    .from('recommendations')
    .select(
      'id, run_id, strategy_id, symbol, action, conviction, thesis, setup_type, regime, entry_price, stop_price, target_price, atr_at_signal, effective_horizon_days, historical_precedent, shares, dollar_risk, status, created_at, reviewed_at, review_note',
    )
    .eq('id', recommendationId)
    .maybeSingle()

  if (recommendationError) {
    throw new Error(recommendationError.message)
  }

  if (!recommendationData) {
    return null
  }

  const recommendation: RecommendationDetailRow = {
    ...recommendationData,
    entry_price: toNumber(recommendationData.entry_price),
    stop_price: toNumber(recommendationData.stop_price),
    target_price: toNumber(recommendationData.target_price),
    atr_at_signal: toNumber(recommendationData.atr_at_signal),
    shares: toNumber(recommendationData.shares),
    dollar_risk: toNumber(recommendationData.dollar_risk),
  }

  const { run_id: runId, strategy_id: strategyId, symbol, created_at: createdAt } = recommendation

  const [
    entrySignalResult,
    factorScoreResult,
    indicatorValuesResult,
    analystRowsResult,
    synthesisRowResult,
    strategyResult,
    decisionOutcomeResult,
  ] = await Promise.all([
    runId && strategyId
      ? supabase
          .from('entry_signals')
          .select(
            'gate_market, gate_trend, gate_confirmed, setup_type, entry_price, stop_price, target_price, atr, r_multiple, effective_horizon_days, actionable',
          )
          .eq('run_id', runId)
          .eq('strategy_id', strategyId)
          .eq('symbol', symbol)
          .maybeSingle()
      : { data: null, error: null },
    runId && strategyId
      ? supabase
          .from('factor_scores')
          .select(
            'sector, rank, composite_z, value_z, value_prev, quality_z, quality_prev, momentum_z, momentum_prev, low_vol_z, low_vol_prev, growth_z, growth_prev, hard_filter_pass, is_new',
          )
          .eq('run_id', runId)
          .eq('strategy_id', strategyId)
          .eq('symbol', symbol)
          .maybeSingle()
      : { data: null, error: null },
    supabase
      .from('indicator_values')
      .select('computed_at, rsi_14, adx_14, macd_hist, sma_50, sma_200, atr_14')
      .eq('symbol', symbol)
      .lte('computed_at', createdAt)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    runId
      ? supabase
          .from('agent_analyses')
          .select(AGENT_ANALYSES_COLUMNS)
          .eq('run_id', runId)
          .eq('symbol', symbol)
          .in('agent_type', ['fundamental', 'technical', 'sentiment'])
      : { data: [], error: null },
    runId
      ? supabase
          .from('agent_analyses')
          .select(AGENT_ANALYSES_COLUMNS)
          .eq('run_id', runId)
          .eq('agent_type', 'synthesis')
          .is('symbol', null)
          .maybeSingle()
      : { data: null, error: null },
    strategyId
      ? supabase.from('strategies').select('risk_params').eq('id', strategyId).maybeSingle()
      : { data: null, error: null },
    supabase
      .from('decision_outcomes')
      .select(
        'mode, resolution, resolved_at, days_to_resolution, r_multiple, entry_price_reference, stop_price, target_price',
      )
      .eq('source_type', 'recommendation')
      .eq('source_id', recommendationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (entrySignalResult.error) throw new Error(entrySignalResult.error.message)
  if (factorScoreResult.error) throw new Error(factorScoreResult.error.message)
  if (decisionOutcomeResult.error) throw new Error(decisionOutcomeResult.error.message)
  if (analystRowsResult.error) throw new Error(analystRowsResult.error.message)
  if (synthesisRowResult.error) throw new Error(synthesisRowResult.error.message)
  if (strategyResult.error) throw new Error(strategyResult.error.message)

  const entrySignalData = entrySignalResult.data as Record<string, unknown> | null
  const entrySignal: EntrySignalDetail | null = entrySignalData
    ? {
        gate_market: entrySignalData.gate_market as boolean | null,
        gate_trend: entrySignalData.gate_trend as boolean | null,
        gate_confirmed: Boolean(entrySignalData.gate_confirmed),
        setup_type: (entrySignalData.setup_type as string | null) ?? null,
        entry_price: toNumber(entrySignalData.entry_price),
        stop_price: toNumber(entrySignalData.stop_price),
        target_price: toNumber(entrySignalData.target_price),
        atr: toNumber(entrySignalData.atr),
        r_multiple: toNumber(entrySignalData.r_multiple),
        effective_horizon_days: toNumber(entrySignalData.effective_horizon_days),
        actionable: Boolean(entrySignalData.actionable),
      }
    : null

  const factorScoreData = factorScoreResult.data as Record<string, unknown> | null
  const factorScore: FactorScoreDetail | null = factorScoreData
    ? {
        sector: (factorScoreData.sector as string | null) ?? null,
        rank: toNumber(factorScoreData.rank),
        composite_z: toNumber(factorScoreData.composite_z),
        value_z: toNumber(factorScoreData.value_z),
        value_prev: toNumber(factorScoreData.value_prev),
        quality_z: toNumber(factorScoreData.quality_z),
        quality_prev: toNumber(factorScoreData.quality_prev),
        momentum_z: toNumber(factorScoreData.momentum_z),
        momentum_prev: toNumber(factorScoreData.momentum_prev),
        low_vol_z: toNumber(factorScoreData.low_vol_z),
        low_vol_prev: toNumber(factorScoreData.low_vol_prev),
        growth_z: toNumber(factorScoreData.growth_z),
        growth_prev: toNumber(factorScoreData.growth_prev),
        hard_filter_pass: Boolean(factorScoreData.hard_filter_pass),
        is_new: Boolean(factorScoreData.is_new),
      }
    : null

  const indicatorValuesData = indicatorValuesResult.data as Record<string, unknown> | null
  const indicatorValues: IndicatorValuesDetail | null = indicatorValuesData
    ? {
        computed_at: String(indicatorValuesData.computed_at),
        rsi_14: toNumber(indicatorValuesData.rsi_14),
        adx_14: toNumber(indicatorValuesData.adx_14),
        macd_hist: toNumber(indicatorValuesData.macd_hist),
        sma_50: toNumber(indicatorValuesData.sma_50),
        sma_200: toNumber(indicatorValuesData.sma_200),
        atr_14: toNumber(indicatorValuesData.atr_14),
      }
    : null

  const analystRows = (analystRowsResult.data ?? []) as Array<{
    agent_type: string
    output: unknown
    prompt_version: string | null
    model: string | null
    created_at: string
  }>

  const findAnalyst = <T>(agentType: string): AnalystAnalysis<T> | null => {
    const row = analystRows.find((candidate) => candidate.agent_type === agentType)
    if (!row) {
      return null
    }
    return {
      output: row.output as T,
      model: row.model,
      prompt_version: row.prompt_version,
      created_at: row.created_at,
    }
  }

  const synthesisRow = synthesisRowResult.data as { output: unknown } | null
  const synthesisRecommendations = (synthesisRow?.output as { recommendations?: SynthesisRecommendationEntry[] } | null)
    ?.recommendations
  const synthesis =
    synthesisRecommendations?.find((entry) => entry.symbol === symbol) ?? null

  const strategyData = strategyResult.data as { risk_params?: RiskParams } | null

  const decisionOutcomeData = decisionOutcomeResult.data as Record<string, unknown> | null
  const decisionOutcome: DecisionOutcomeDetail | null = decisionOutcomeData
    ? {
        mode: (decisionOutcomeData.mode as string | null) ?? null,
        resolution: (decisionOutcomeData.resolution as string | null) ?? null,
        resolved_at: (decisionOutcomeData.resolved_at as string | null) ?? null,
        days_to_resolution: toNumber(decisionOutcomeData.days_to_resolution),
        r_multiple: toNumber(decisionOutcomeData.r_multiple),
        entry_price_reference: toNumber(decisionOutcomeData.entry_price_reference),
        stop_price: toNumber(decisionOutcomeData.stop_price),
        target_price: toNumber(decisionOutcomeData.target_price),
      }
    : null

  return {
    recommendation,
    entrySignal,
    factorScore,
    indicatorValues,
    fundamental: findAnalyst<FundamentalOutput>('fundamental'),
    technical: findAnalyst<TechnicalOutput>('technical'),
    sentiment: findAnalyst<SentimentOutput>('sentiment'),
    synthesis,
    currentRiskParams: strategyData?.risk_params ?? null,
    decisionOutcome,
  }
}

export type SentimentBucket = 'positive' | 'neutral' | 'negative'

export function bucketFundamental(value: FundamentalOutput['quality_assessment'] | undefined): SentimentBucket | null {
  if (!value) return null
  if (value === 'high') return 'positive'
  if (value === 'medium') return 'neutral'
  return 'negative' // low | concerning
}

export function bucketTechnical(value: TechnicalOutput['setup_quality'] | undefined): SentimentBucket | null {
  if (!value) return null
  if (value === 'strong') return 'positive'
  if (value === 'adequate') return 'neutral'
  return 'negative' // marginal | poor
}

export function bucketSentiment(value: SentimentOutput['sentiment_direction'] | undefined): SentimentBucket | null {
  if (!value) return null
  if (value === 'positive') return 'positive'
  if (value === 'negative') return 'negative'
  return 'neutral' // neutral | mixed
}

export function hasCrossPillarDisagreement(buckets: Array<SentimentBucket | null>): boolean {
  const present = buckets.filter((bucket): bucket is SentimentBucket => bucket != null)
  return present.includes('positive') && present.includes('negative')
}

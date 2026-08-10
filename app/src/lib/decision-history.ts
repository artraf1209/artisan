type DecisionOutcomeRow = {
  id: string
  symbol: string
  source_type: 'recommendation' | 'position_review'
  source_id: string
  mode: string | null
  entry_price_reference: number | string | null
  stop_price: number | string | null
  target_price: number | string | null
  effective_horizon_days: number | string | null
  setup_type: string | null
  regime: string | null
  resolution: string | null
  resolved_at: string | null
  days_to_resolution: number | string | null
  r_multiple: number | string | null
  created_at: string
}

type RecommendationSourceRow = {
  id: string
  run_id: string | null
  action: string | null
  conviction: string | null
  thesis: string | null
}

type PositionReviewSourceRow = {
  id: string
  run_id: string | null
  recommended_action: string | null
  reasoning: string | null
}

type PipelineRunRow = {
  id: string
  run_date: string
}

export interface DecisionHistoryFilters {
  symbol?: string
  setup_type?: string
  regime?: string
  resolution?: string
  mode?: string
  limit?: number
}

export interface DecisionHistoryRecord {
  id: string
  symbol: string
  source_type: 'recommendation' | 'position_review'
  source_id: string
  mode: string | null
  run_date: string | null
  action_label: string | null
  conviction: string | null
  thesis: string | null
  reasoning: string | null
  entry_price_reference: number | null
  stop_price: number | null
  target_price: number | null
  effective_horizon_days: number | null
  setup_type: string | null
  regime: string | null
  resolution: string | null
  resolved_at: string | null
  days_to_resolution: number | null
  r_multiple: number | null
  created_at: string
}

export interface DecisionHistoryAggregate {
  win_rate: number | null
  avg_r_multiple: number | null
  avg_days_to_resolution: number | null
  count: number
  real_count: number
  shadow_count: number
}

export interface DecisionHistoryResult {
  aggregate: DecisionHistoryAggregate
  rows: DecisionHistoryRecord[]
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function computeDecisionAggregate(
  rows: Array<{
    mode: string | null
    resolution: string | null
    r_multiple: number | null
    days_to_resolution: number | null
  }>,
): DecisionHistoryAggregate {
  const resolved = rows.filter((row) => row.resolution != null && row.resolution !== 'still_open')
  const hitTarget = resolved.filter((row) => row.resolution === 'hit_target').length
  const hitStop = resolved.filter((row) => row.resolution === 'hit_stop').length
  const winDenominator = hitTarget + hitStop
  const rMultiples = resolved
    .map((row) => row.r_multiple)
    .filter((value): value is number => value != null)
  const days = resolved
    .map((row) => row.days_to_resolution)
    .filter((value): value is number => value != null)

  return {
    win_rate: winDenominator > 0 ? round(hitTarget / winDenominator, 4) : null,
    avg_r_multiple:
      rMultiples.length > 0 ? round(rMultiples.reduce((sum, value) => sum + value, 0) / rMultiples.length, 4) : null,
    avg_days_to_resolution:
      days.length > 0 ? round(days.reduce((sum, value) => sum + value, 0) / days.length, 2) : null,
    count: rows.length,
    real_count: rows.filter((row) => row.mode === 'real').length,
    shadow_count: rows.filter((row) => row.mode === 'shadow').length,
  }
}

export async function loadDecisionHistory(
  supabase: any,
  filters: DecisionHistoryFilters = {},
): Promise<DecisionHistoryResult> {
  let query = supabase
    .from('decision_outcomes')
    .select(
      'id, symbol, source_type, source_id, mode, entry_price_reference, stop_price, target_price, effective_horizon_days, setup_type, regime, resolution, resolved_at, days_to_resolution, r_multiple, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 500)

  if (filters.symbol?.trim()) {
    query = query.eq('symbol', filters.symbol.trim().toUpperCase())
  }
  if (filters.setup_type?.trim()) {
    query = query.eq('setup_type', filters.setup_type.trim())
  }
  if (filters.regime?.trim()) {
    query = query.eq('regime', filters.regime.trim())
  }
  if (filters.resolution?.trim()) {
    query = query.eq('resolution', filters.resolution.trim())
  }
  if (filters.mode?.trim()) {
    query = query.eq('mode', filters.mode.trim())
  }

  const { data: rawRows, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  const rows = (rawRows ?? []) as DecisionOutcomeRow[]
  const recommendationIds = rows
    .filter((row) => row.source_type === 'recommendation')
    .map((row) => row.source_id)
  const positionReviewIds = rows
    .filter((row) => row.source_type === 'position_review')
    .map((row) => row.source_id)

  const [
    recommendationsResult,
    positionReviewsResult,
  ] = await Promise.all([
    recommendationIds.length > 0
      ? supabase
          .from('recommendations')
          .select('id, run_id, action, conviction, thesis')
          .in('id', recommendationIds)
      : { data: [], error: null },
    positionReviewIds.length > 0
      ? supabase
          .from('position_reviews')
          .select('id, run_id, recommended_action, reasoning')
          .in('id', positionReviewIds)
      : { data: [], error: null },
  ])

  if (recommendationsResult.error) {
    throw new Error(recommendationsResult.error.message)
  }
  if (positionReviewsResult.error) {
    throw new Error(positionReviewsResult.error.message)
  }

  const recommendationsById = new Map(
    ((recommendationsResult.data ?? []) as RecommendationSourceRow[]).map((row) => [row.id, row]),
  )
  const positionReviewsById = new Map(
    ((positionReviewsResult.data ?? []) as PositionReviewSourceRow[]).map((row) => [row.id, row]),
  )

  const runIds = [
    ...new Set(
      [
        ...((recommendationsResult.data ?? []) as RecommendationSourceRow[]).map((row) => row.run_id),
        ...((positionReviewsResult.data ?? []) as PositionReviewSourceRow[]).map((row) => row.run_id),
      ].filter((value): value is string => Boolean(value)),
    ),
  ]

  const { data: pipelineRunsData, error: pipelineRunsError } =
    runIds.length > 0
      ? await supabase.from('pipeline_runs').select('id, run_date').in('id', runIds)
      : { data: [], error: null }

  if (pipelineRunsError) {
    throw new Error(pipelineRunsError.message)
  }

  const pipelineRunsById = new Map(
    ((pipelineRunsData ?? []) as PipelineRunRow[]).map((row) => [row.id, row.run_date]),
  )

  const records: DecisionHistoryRecord[] = rows.map((row) => {
    const recommendation = row.source_type === 'recommendation'
      ? recommendationsById.get(row.source_id) ?? null
      : null
    const positionReview = row.source_type === 'position_review'
      ? positionReviewsById.get(row.source_id) ?? null
      : null
    const runId = recommendation?.run_id ?? positionReview?.run_id ?? null

    return {
      id: row.id,
      symbol: row.symbol,
      source_type: row.source_type,
      source_id: row.source_id,
      mode: row.mode,
      run_date: runId ? pipelineRunsById.get(runId) ?? null : null,
      action_label: recommendation?.action ?? positionReview?.recommended_action ?? null,
      conviction: recommendation?.conviction ?? null,
      thesis: recommendation?.thesis ?? null,
      reasoning: positionReview?.reasoning ?? null,
      entry_price_reference: toNumber(row.entry_price_reference),
      stop_price: toNumber(row.stop_price),
      target_price: toNumber(row.target_price),
      effective_horizon_days: toNumber(row.effective_horizon_days),
      setup_type: row.setup_type,
      regime: row.regime,
      resolution: row.resolution,
      resolved_at: row.resolved_at,
      days_to_resolution: toNumber(row.days_to_resolution),
      r_multiple: toNumber(row.r_multiple),
      created_at: row.created_at,
    }
  })

  return {
    aggregate: computeDecisionAggregate(records),
    rows: records,
  }
}

type PositionRow = {
  id: string
  account_id: string
  symbol: string
  quantity: number | string
  avg_entry_price: number | string
  current_price: number | string | null
  unrealized_pnl: number | string | null
  stop_price: number | string | null
  target_price: number | string | null
  signal_id: string | null
  opened_at: string
  updated_at: string
  entry_order_id: string | null
  stop_order_id: string | null
  target_order_id: string | null
}

type RecommendationRow = {
  id: string
  symbol: string
  strategy_id: string | null
  thesis: string | null
  entry_price: number | string | null
  stop_price: number | string | null
  target_price: number | string | null
  effective_horizon_days: number | string | null
  setup_type: string | null
}

type ReviewRow = {
  id: string
  position_id: string
  recommended_action: string
  reasoning: string | null
  status: string
  created_at: string
  new_stop_price: number | string | null
  new_target_price: number | string | null
}

type StrategyRow = {
  id: string
  timing_params?: {
    max_holding_period_days?: number
  } | null
}

type PriceBarRow = {
  symbol: string
  close: number | string | null
  bar_time: string
}

export interface PositionRecommendationContext {
  id: string
  strategy_id: string | null
  thesis: string | null
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  effective_horizon_days: number | null
  setup_type: string | null
}

export interface LatestPositionReview {
  id: string
  recommended_action: string
  reasoning: string | null
  status: string
  created_at: string
  new_stop_price: number | null
  new_target_price: number | null
}

export interface PositionOverview {
  id: string
  account_id: string
  symbol: string
  quantity: number
  avg_entry_price: number
  current_price: number | null
  unrealized_pnl: number | null
  unrealized_pnl_pct: number | null
  stop_price: number | null
  target_price: number | null
  signal_id: string | null
  opened_at: string
  updated_at: string
  days_held: number
  effective_horizon_days: number | null
  max_holding_period_days: number
  days_remaining_horizon: number | null
  days_remaining_ceiling: number
  r_multiple: number | null
  distance_to_stop_dollars: number | null
  distance_to_stop_pct: number | null
  distance_to_target_dollars: number | null
  distance_to_target_pct: number | null
  trailing_stop_active: boolean
  near_day_30: boolean
  needs_attention: boolean
  has_resting_orders: boolean
  original_recommendation: PositionRecommendationContext | null
  latest_review: LatestPositionReview | null
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

function daysSince(openedAt: string, now: Date) {
  const opened = new Date(openedAt)
  const current = new Date(now)
  opened.setUTCHours(0, 0, 0, 0)
  current.setUTCHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((current.getTime() - opened.getTime()) / (24 * 60 * 60 * 1000)))
}

function distanceToStopMetrics(currentPrice: number | null, stopPrice: number | null) {
  if (currentPrice == null || stopPrice == null || currentPrice === 0) {
    return {
      dollars: null,
      pct: null,
    }
  }

  const dollars = round(currentPrice - stopPrice, 2)
  return {
    dollars,
    pct: round((dollars / currentPrice) * 100, 2),
  }
}

function distanceToTargetMetrics(currentPrice: number | null, targetPrice: number | null) {
  if (currentPrice == null || targetPrice == null || currentPrice === 0) {
    return {
      dollars: null,
      pct: null,
    }
  }

  const dollars = round(targetPrice - currentPrice, 2)
  return {
    dollars,
    pct: round((dollars / currentPrice) * 100, 2),
  }
}

export async function loadOpenPositions(supabase: any, now = new Date()): Promise<PositionOverview[]> {
  const { data: rawPositions, error: positionsError } = await supabase
    .from('portfolio_positions')
    .select(
      'id, account_id, symbol, quantity, avg_entry_price, current_price, unrealized_pnl, stop_price, target_price, signal_id, opened_at, updated_at, entry_order_id, stop_order_id, target_order_id',
    )
    .order('opened_at', { ascending: false })

  if (positionsError) {
    throw new Error(positionsError.message)
  }

  const positions = (rawPositions ?? []) as PositionRow[]
  if (positions.length === 0) {
    return []
  }

  const recommendationIds = positions
    .map((position) => position.signal_id)
    .filter((value): value is string => Boolean(value))
  const strategyIds = new Set<string>()
  const symbols = [...new Set(positions.map((position) => position.symbol))]
  const positionIds = positions.map((position) => position.id)

  const [
    recommendationsResult,
    reviewsResult,
    priceBarsResult,
  ] = await Promise.all([
    recommendationIds.length > 0
      ? supabase
          .from('recommendations')
          .select(
            'id, symbol, strategy_id, thesis, entry_price, stop_price, target_price, effective_horizon_days, setup_type',
          )
          .in('id', recommendationIds)
      : { data: [], error: null },
    supabase
      .from('position_reviews')
      .select(
        'id, position_id, recommended_action, reasoning, status, created_at, new_stop_price, new_target_price',
      )
      .in('position_id', positionIds)
      .order('created_at', { ascending: false }),
    supabase
      .from('price_bars')
      .select('symbol, close, bar_time')
      .in('symbol', symbols)
      .order('bar_time', { ascending: false })
      .limit(Math.max(symbols.length * 4, 20)),
  ])

  if (recommendationsResult.error) {
    throw new Error(recommendationsResult.error.message)
  }
  if (reviewsResult.error) {
    throw new Error(reviewsResult.error.message)
  }
  if (priceBarsResult.error) {
    throw new Error(priceBarsResult.error.message)
  }

  const recommendations = (recommendationsResult.data ?? []) as RecommendationRow[]
  for (const recommendation of recommendations) {
    if (recommendation.strategy_id) {
      strategyIds.add(recommendation.strategy_id)
    }
  }

  const { data: strategiesData, error: strategiesError } =
    strategyIds.size > 0
      ? await supabase
          .from('strategies')
          .select('id, timing_params')
          .in('id', [...strategyIds])
      : { data: [], error: null }

  if (strategiesError) {
    throw new Error(strategiesError.message)
  }

  const recommendationsById = new Map(
    recommendations.map((recommendation) => [
      recommendation.id,
      {
        id: recommendation.id,
        strategy_id: recommendation.strategy_id,
        thesis: recommendation.thesis,
        entry_price: toNumber(recommendation.entry_price),
        stop_price: toNumber(recommendation.stop_price),
        target_price: toNumber(recommendation.target_price),
        effective_horizon_days: toNumber(recommendation.effective_horizon_days),
        setup_type: recommendation.setup_type,
      } satisfies PositionRecommendationContext,
    ]),
  )

  const strategiesById = new Map(
    ((strategiesData ?? []) as StrategyRow[]).map((strategy) => [strategy.id, strategy]),
  )

  const latestReviewByPositionId = new Map<string, LatestPositionReview>()
  for (const review of (reviewsResult.data ?? []) as ReviewRow[]) {
    if (latestReviewByPositionId.has(review.position_id)) {
      continue
    }

    latestReviewByPositionId.set(review.position_id, {
      id: review.id,
      recommended_action: review.recommended_action,
      reasoning: review.reasoning,
      status: review.status,
      created_at: review.created_at,
      new_stop_price: toNumber(review.new_stop_price),
      new_target_price: toNumber(review.new_target_price),
    })
  }

  const latestPriceBySymbol = new Map<string, number>()
  for (const row of (priceBarsResult.data ?? []) as PriceBarRow[]) {
    if (latestPriceBySymbol.has(row.symbol)) {
      continue
    }

    const close = toNumber(row.close)
    if (close != null) {
      latestPriceBySymbol.set(row.symbol, close)
    }
  }

  return positions.map((position) => {
    const quantity = toNumber(position.quantity) ?? 0
    const avgEntryPrice = toNumber(position.avg_entry_price) ?? 0
    const currentPrice = toNumber(position.current_price) ?? latestPriceBySymbol.get(position.symbol) ?? null
    const stopPrice = toNumber(position.stop_price)
    const targetPrice = toNumber(position.target_price)
    const recommendation = position.signal_id ? recommendationsById.get(position.signal_id) ?? null : null
    const strategy = recommendation?.strategy_id
      ? strategiesById.get(recommendation.strategy_id) ?? null
      : null
    const latestReview = latestReviewByPositionId.get(position.id) ?? null
    const daysHeld = daysSince(position.opened_at, now)
    const maxHoldingPeriodDays = Number(strategy?.timing_params?.max_holding_period_days ?? 30)
    const daysRemainingCeiling = maxHoldingPeriodDays - daysHeld
    const daysRemainingHorizon =
      recommendation?.effective_horizon_days != null
        ? recommendation.effective_horizon_days - daysHeld
        : null
    const unrealizedPnl =
      currentPrice != null ? round((currentPrice - avgEntryPrice) * quantity, 2) : toNumber(position.unrealized_pnl)
    const unrealizedPnlPct =
      currentPrice != null && avgEntryPrice !== 0
        ? round(((currentPrice - avgEntryPrice) / avgEntryPrice) * 100, 2)
        : null
    const rMultiple =
      currentPrice != null && stopPrice != null && avgEntryPrice !== stopPrice
        ? round((currentPrice - avgEntryPrice) / (avgEntryPrice - stopPrice), 2)
        : null
    const stopDistance = distanceToStopMetrics(currentPrice, stopPrice)
    const targetDistance = distanceToTargetMetrics(currentPrice, targetPrice)
    const trailingStopActive =
      stopPrice != null &&
      recommendation?.stop_price != null &&
      stopPrice > recommendation.stop_price

    const reviewNeedsAttention =
      latestReview != null &&
      ['close', 'trim'].includes(latestReview.recommended_action.toLowerCase())
    const nearDay30 = daysRemainingCeiling < 5
    const hasRestingOrders = Boolean(
      position.entry_order_id || position.stop_order_id || position.target_order_id,
    )

    return {
      id: position.id,
      account_id: position.account_id,
      symbol: position.symbol,
      quantity,
      avg_entry_price: avgEntryPrice,
      current_price: currentPrice,
      unrealized_pnl: unrealizedPnl,
      unrealized_pnl_pct: unrealizedPnlPct,
      stop_price: stopPrice,
      target_price: targetPrice,
      signal_id: position.signal_id,
      opened_at: position.opened_at,
      updated_at: position.updated_at,
      days_held: daysHeld,
      effective_horizon_days: recommendation?.effective_horizon_days ?? null,
      max_holding_period_days: maxHoldingPeriodDays,
      days_remaining_horizon: daysRemainingHorizon,
      days_remaining_ceiling: daysRemainingCeiling,
      r_multiple: rMultiple,
      distance_to_stop_dollars: stopDistance.dollars,
      distance_to_stop_pct: stopDistance.pct,
      distance_to_target_dollars: targetDistance.dollars,
      distance_to_target_pct: targetDistance.pct,
      trailing_stop_active: trailingStopActive,
      near_day_30: nearDay30,
      needs_attention: nearDay30 || reviewNeedsAttention,
      has_resting_orders: hasRestingOrders,
      original_recommendation: recommendation,
      latest_review: latestReview,
    } satisfies PositionOverview
  })
}

import { formatCurrency } from '@/lib/utils'

type RecommendationRow = {
  id: string
  symbol: string
  shares: number | string | null
  entry_price: number | string | null
  stop_price: number | string | null
  target_price: number | string | null
}

type DecisionOutcomeRow = {
  source_type: string
  source_id: string
  mode: string | null
  resolution: string | null
  r_multiple: number | string | null
  updated_at?: string | null
  created_at?: string | null
}

export interface OrdersFilters {
  date_from?: string
  date_to?: string
  symbol?: string
  side?: 'buy' | 'sell' | ''
  limit?: number
}

export interface OrderHistoryRow {
  id: string
  symbol: string
  side: string
  leg_type: 'entry' | 'stop_loss' | 'take_profit' | null
  order_type: 'market' | 'limit'
  limit_price: number | null
  execution_status: string
  intent_status: string | null
  filled_qty: number | null
  filled_price: number | null
  filled_at: string | null
  created_at: string
  requested_quantity: number | null
  recommended_shares: number | null
  recommended_stop_price: number | null
  recommended_target_price: number | null
  actual_shares: number | null
  actual_stop_price: number | null
  actual_target_price: number | null
  override_deltas: string[]
  /** null means no decision_outcomes row exists for this order at all (e.g. its
   * recommendation's action was never 'enter', or it's a manual order with no
   * signal_id) -- distinct from 'still_open', which means a row exists and
   * genuinely hasn't resolved yet. Don't collapse the two in the UI. */
  resolution: string | null
  r_multiple: number | null
  source_type: 'recommendation' | 'position_review'
}

/** Shared by the standalone Orders page and the per-position history panel so the
 * two views can't silently drift on how an order's type/leg is described. */
export function describeOrderType(order: Pick<OrderHistoryRow, 'order_type' | 'limit_price'>): string {
  if (order.order_type === 'limit') {
    return order.limit_price == null ? 'Limit' : `Limit @ ${formatCurrency(order.limit_price)}`
  }
  return 'Market'
}

export function humanizeLegType(value: OrderHistoryRow['leg_type']): string | null {
  if (value === 'stop_loss') return 'Stop loss'
  if (value === 'take_profit') return 'Take profit'
  if (value === 'entry') return 'Entry'
  return null
}

/** Shared by every view that diffs an approval-time `trade_intents.overrides`
 * blob against what was originally recommended (this file's own order rows,
 * and the New Recommendations / Position Actions history panels) so the
 * "what did a human actually change" logic can't drift between them. */
export function computeOverrideDeltas(
  overrides: Record<string, unknown>,
  recommended: { shares: number | null; stop_price: number | null; target_price: number | null },
): string[] {
  const deltas: string[] = []
  if (overrides.shares != null && recommended.shares != null && Number(overrides.shares) !== recommended.shares) {
    deltas.push(`shares: ${recommended.shares} -> ${Number(overrides.shares)}`)
  }
  if (
    overrides.stop_price != null &&
    recommended.stop_price != null &&
    Number(overrides.stop_price) !== recommended.stop_price
  ) {
    deltas.push(`stop: ${recommended.stop_price} -> ${Number(overrides.stop_price)}`)
  }
  if (
    overrides.target_price != null &&
    recommended.target_price != null &&
    Number(overrides.target_price) !== recommended.target_price
  ) {
    deltas.push(`target: ${recommended.target_price} -> ${Number(overrides.target_price)}`)
  }
  return deltas
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function selectBestOutcome(rows: DecisionOutcomeRow[]) {
  return [...rows].sort((left, right) => {
    if ((left.mode === 'real') !== (right.mode === 'real')) {
      return left.mode === 'real' ? -1 : 1
    }

    const leftStamp = left.updated_at ?? left.created_at ?? ''
    const rightStamp = right.updated_at ?? right.created_at ?? ''
    return rightStamp.localeCompare(leftStamp)
  })[0] ?? null
}

function parseIntent(raw: unknown) {
  const intent = Array.isArray(raw) ? raw[0] : raw
  return (intent ?? null) as
    | {
        id: string
        signal_id: string
        symbol: string
        side: string
        quantity: number | string | null
        stop_price: number | string | null
        status: string | null
        order_type: 'market' | 'limit' | null
        limit_price: number | string | null
        overrides?: Record<string, unknown> | null
      }
    | null
}

export async function loadOrders(supabase: any, filters: OrdersFilters = {}): Promise<OrderHistoryRow[]> {
  const limit = filters.limit ?? 250
  const { data: executionRows, error: executionsError } = await supabase
    .from('trade_executions')
    .select(
      'id, status, filled_qty, filled_price, filled_at, created_at, leg_type, trade_intents(id, signal_id, symbol, side, quantity, stop_price, status, order_type, limit_price, overrides)',
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (executionsError) {
    throw new Error(executionsError.message)
  }

  const executions = (executionRows ?? []) as Array<Record<string, unknown>>
  const intents = executions
    .map((execution) => parseIntent(execution.trade_intents))
    .filter((intent): intent is NonNullable<ReturnType<typeof parseIntent>> => intent != null)

  const recommendationIds = [...new Set(intents.map((intent) => intent.signal_id).filter(Boolean))]
  const positionReviewSourceIds = intents
    .map((intent) =>
      intent.overrides?.source_type === 'position_review' && typeof intent.overrides?.source_id === 'string'
        ? intent.overrides.source_id
        : null,
    )
    .filter((value): value is string => Boolean(value))

  const [
    recommendationsResult,
    recommendationOutcomesResult,
    positionReviewOutcomesResult,
  ] = await Promise.all([
    recommendationIds.length > 0
      ? supabase
          .from('recommendations')
          .select('id, symbol, shares, entry_price, stop_price, target_price')
          .in('id', recommendationIds)
      : { data: [], error: null },
    recommendationIds.length > 0
      ? supabase
          .from('decision_outcomes')
          .select('source_type, source_id, mode, resolution, r_multiple, updated_at, created_at')
          .eq('source_type', 'recommendation')
          .in('source_id', recommendationIds)
      : { data: [], error: null },
    positionReviewSourceIds.length > 0
      ? supabase
          .from('decision_outcomes')
          .select('source_type, source_id, mode, resolution, r_multiple, updated_at, created_at')
          .eq('source_type', 'position_review')
          .in('source_id', positionReviewSourceIds)
      : { data: [], error: null },
  ])

  if (recommendationsResult.error) {
    throw new Error(recommendationsResult.error.message)
  }
  if (recommendationOutcomesResult.error) {
    throw new Error(recommendationOutcomesResult.error.message)
  }
  if (positionReviewOutcomesResult.error) {
    throw new Error(positionReviewOutcomesResult.error.message)
  }

  const recommendationsById = new Map(
    ((recommendationsResult.data ?? []) as RecommendationRow[]).map((recommendation) => [
      recommendation.id,
      recommendation,
    ]),
  )

  const outcomesByKey = new Map<string, DecisionOutcomeRow[]>()
  for (const row of [
    ...((recommendationOutcomesResult.data ?? []) as DecisionOutcomeRow[]),
    ...((positionReviewOutcomesResult.data ?? []) as DecisionOutcomeRow[]),
  ]) {
    const key = `${row.source_type}:${row.source_id}`
    outcomesByKey.set(key, [...(outcomesByKey.get(key) ?? []), row])
  }

  const rows: OrderHistoryRow[] = []
  for (const execution of executions) {
    const intent = parseIntent(execution.trade_intents)
    if (!intent) {
      continue
    }

    const overrides = intent.overrides ?? {}
    const sourceType =
      overrides.source_type === 'position_review' ? 'position_review' : 'recommendation'
    const recommendation = recommendationsById.get(intent.signal_id) ?? null
    const actualShares = toNumber(execution.filled_qty) ?? toNumber(intent.quantity)
    const actualStopPrice = toNumber(overrides.stop_price) ?? toNumber(intent.stop_price)
    const actualTargetPrice =
      toNumber(overrides.target_price) ?? toNumber(recommendation?.target_price)

    const recommendedShares =
      sourceType === 'position_review'
        ? actualShares
        : toNumber(recommendation?.shares)
    const recommendedStopPrice =
      sourceType === 'position_review'
        ? actualStopPrice
        : toNumber(recommendation?.stop_price)
    const recommendedTargetPrice =
      sourceType === 'position_review'
        ? actualTargetPrice
        : toNumber(recommendation?.target_price)

    const overrideDeltas = computeOverrideDeltas(overrides, {
      shares: recommendedShares,
      stop_price: recommendedStopPrice,
      target_price: recommendedTargetPrice,
    })

    const outcomeKey =
      sourceType === 'position_review' && typeof overrides.source_id === 'string'
        ? `position_review:${overrides.source_id}`
        : `recommendation:${intent.signal_id}`
    const outcome = selectBestOutcome(outcomesByKey.get(outcomeKey) ?? [])

    // Exit legs (stop-loss/take-profit) always close a buy-side bracket entry with a
    // sell -- sourcing side from the parent intent would mislabel these as 'buy'.
    const legType = (execution.leg_type as OrderHistoryRow['leg_type']) ?? null
    const side = legType === 'stop_loss' || legType === 'take_profit' ? 'sell' : intent.side

    rows.push({
      id: String(execution.id),
      symbol: intent.symbol,
      side,
      leg_type: legType,
      order_type: intent.order_type ?? 'market',
      limit_price: toNumber(intent.limit_price),
      execution_status: String(execution.status ?? 'pending'),
      intent_status: intent.status ?? null,
      filled_qty: toNumber(execution.filled_qty) ?? toNumber(intent.quantity),
      requested_quantity: toNumber(intent.quantity),
      filled_price: toNumber(execution.filled_price),
      filled_at: (execution.filled_at as string | null) ?? null,
      created_at: String(execution.created_at),
      recommended_shares: recommendedShares,
      recommended_stop_price: recommendedStopPrice,
      recommended_target_price: recommendedTargetPrice,
      actual_shares: actualShares,
      actual_stop_price: actualStopPrice,
      actual_target_price: actualTargetPrice,
      override_deltas: overrideDeltas,
      resolution: outcome?.resolution ?? null,
      r_multiple: toNumber(outcome?.r_multiple),
      source_type: sourceType,
    })
  }

  return rows.filter((row) => {
      const normalizedSymbol = filters.symbol?.trim().toUpperCase()
      if (normalizedSymbol && row.symbol.toUpperCase() !== normalizedSymbol) {
        return false
      }
      if (filters.side && row.side !== filters.side) {
        return false
      }

      const rowDate = (row.filled_at ?? row.created_at).slice(0, 10)
      if (filters.date_from && rowDate < filters.date_from) {
        return false
      }
      if (filters.date_to && rowDate > filters.date_to) {
        return false
      }

      return true
    })
}

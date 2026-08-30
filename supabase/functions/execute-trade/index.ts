import { createClient } from '@supabase/supabase-js'

type OrderSide = 'buy' | 'sell'
type OrderType = 'market' | 'limit'
type OrderClass = 'simple' | 'bracket'
type LegType = 'stop_loss' | 'take_profit'
type ErrorType = 'market_closed' | 'insufficient_balance' | 'other'

interface ExecuteTradePayload {
  action?: 'replace_leg' | 'cancel_position_orders'
  trade_intent_id?: string
  overrides?: {
    shares?: number
    stop_price?: number
    target_price?: number
  }
  position_id?: string
  leg?: LegType
  new_price?: number
}

interface TradeIntentRow {
  id: string
  signal_id: string | null
  account_id: string
  symbol: string
  side: OrderSide
  quantity: number | string
  dollar_value: number | string
  order_type: OrderType
  order_class: OrderClass
  limit_price: number | string | null
  stop_price: number | string | null
  status: string
  retry_count: number
  overrides?: Record<string, unknown> | null
}

interface RecommendationRow {
  id: string
  strategy_id: string | null
  symbol: string
  status: string
  entry_price: number | string | null
  stop_price: number | string | null
  target_price: number | string | null
}

interface StrategyParams {
  risk_params: {
    risk_per_trade_pct: number
    max_position_pct: number
    max_concurrent_positions: number
    max_sector_exposure_pct: number
    max_portfolio_heat_pct: number
    max_drawdown_tolerance_pct: number
  }
}

interface PortfolioPositionRow {
  id: string
  account_id: string
  symbol: string
  quantity: number | string
  avg_entry_price: number | string
  stop_price: number | string | null
  target_price?: number | string | null
  signal_id?: string | null
  entry_order_id?: string | null
  stop_order_id?: string | null
  target_order_id?: string | null
}

interface AssetRow {
  symbol: string
  sector: string | null
}

interface PriceBarRow {
  symbol: string
  bar_time: string
  close: number | string
}

interface AlpacaAccount {
  equity?: string | number | null
  cash?: string | number | null
  buying_power?: string | number | null
}

interface AlpacaPosition {
  symbol: string
  qty?: string | number | null
  avg_entry_price?: string | number | null
  current_price?: string | number | null
  unrealized_pl?: string | number | null
}

interface CandidatePosition {
  symbol: string
  sector?: string | null
  dollar_risk?: number | null
  dollar_value?: number | null
  returns_60d?: number[] | null
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CORRELATION_BREACH_THRESHOLD = 0.7
const CORRELATION_MIN_OBSERVATIONS = 10
const MAX_SUBMISSION_RETRIES = 3

class TradeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorType: ErrorType,
  ) {
    super(message)
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  })
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function toNumber(value: unknown, fallback: number | null = null): number | null {
  if (value == null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TradeError(`${field} must be a positive integer.`, 400, 'other')
  }
  return parsed
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function classifyBrokerError(raw: string): ErrorType {
  const errLower = raw.toLowerCase()
  if (
    errLower.includes('market closed') ||
    errLower.includes('outside regular trading hours') ||
    errLower.includes('cannot open') ||
    errLower.includes('40157')
  ) {
    return 'market_closed'
  }
  if (
    errLower.includes('insufficient') ||
    errLower.includes('42202') ||
    errLower.includes('balance') ||
    errLower.includes('buying power')
  ) {
    return 'insufficient_balance'
  }
  return 'other'
}

function alpacaHeaders(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': Deno.env.get('ALPACA_API_KEY') ?? '',
    'APCA-API-SECRET-KEY': Deno.env.get('ALPACA_API_SECRET') ?? '',
    'Content-Type': 'application/json',
  }
}

function alpacaBaseUrl(): string {
  return (Deno.env.get('ALPACA_BASE_URL') ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '')
}

async function alpacaRequest(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${alpacaBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...alpacaHeaders(),
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new TradeError(text, response.status, classifyBrokerError(text))
  }

  return response
}

async function fetchAlpacaAccount(): Promise<AlpacaAccount> {
  const response = await alpacaRequest('/v2/account', { method: 'GET' })
  return await response.json()
}

async function fetchAlpacaPosition(symbol: string): Promise<AlpacaPosition | null> {
  const response = await fetch(`${alpacaBaseUrl()}/v2/positions/${symbol}`, {
    method: 'GET',
    headers: alpacaHeaders(),
  })

  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    const text = await response.text()
    throw new TradeError(text, response.status, classifyBrokerError(text))
  }

  return await response.json()
}

// Recovery path for an ambiguous order-placement failure (Part 2's item 2.5): confirms
// whether an order that we lost the HTTP response for actually reached Alpaca.
async function fetchAlpacaOrderByClientOrderId(clientOrderId: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(
    `${alpacaBaseUrl()}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`,
    { method: 'GET', headers: alpacaHeaders() },
  )

  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    const text = await response.text()
    throw new TradeError(text, response.status, classifyBrokerError(text))
  }

  return await response.json()
}

async function patchAlpacaOrder(orderId: string, body: Record<string, unknown>): Promise<boolean> {
  const response = await fetch(`${alpacaBaseUrl()}/v2/orders/${orderId}`, {
    method: 'PATCH',
    headers: alpacaHeaders(),
    body: JSON.stringify(body),
  })

  if (response.status === 404) {
    return false
  }
  if (!response.ok) {
    const text = await response.text()
    throw new TradeError(text, response.status, classifyBrokerError(text))
  }
  return true
}

async function cancelAlpacaOrder(orderId: string): Promise<boolean> {
  const response = await fetch(`${alpacaBaseUrl()}/v2/orders/${orderId}`, {
    method: 'DELETE',
    headers: alpacaHeaders(),
  })

  if (response.status === 404) {
    return false
  }
  if (!response.ok && response.status !== 204) {
    const text = await response.text()
    throw new TradeError(text, response.status, classifyBrokerError(text))
  }
  return true
}

function computePositionSize(equity: number, entryPrice: number, stopPrice: number, params: StrategyParams['risk_params']) {
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

function pearsonCorrelation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < CORRELATION_MIN_OBSERVATIONS) {
    return null
  }

  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length

  let numerator = 0
  let leftDenominator = 0
  let rightDenominator = 0

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean
    const rightDelta = right[index] - rightMean
    numerator += leftDelta * rightDelta
    leftDenominator += leftDelta ** 2
    rightDenominator += rightDelta ** 2
  }

  if (leftDenominator === 0 || rightDenominator === 0) {
    return null
  }

  return numerator / Math.sqrt(leftDenominator * rightDenominator)
}

function returnsBySymbol(rows: PriceBarRow[]): Record<string, number[]> {
  const grouped = new Map<string, Array<{ bar_time: string; close: number }>>()
  for (const row of rows) {
    const close = toNumber(row.close)
    if (close == null) {
      continue
    }
    const bucket = grouped.get(row.symbol) ?? []
    bucket.push({ bar_time: row.bar_time, close })
    grouped.set(row.symbol, bucket)
  }

  const result: Record<string, number[]> = {}
  for (const [symbol, entries] of grouped.entries()) {
    entries.sort((left, right) => left.bar_time.localeCompare(right.bar_time))
    const returns: number[] = []
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1].close
      const current = entries[index].close
      if (previous !== 0) {
        returns.push((current / previous) - 1)
      }
    }
    result[symbol] = returns
  }
  return result
}

function correlationBreached(candidate: CandidatePosition, openPositions: CandidatePosition[]): boolean {
  if (!candidate.sector || !candidate.returns_60d?.length) {
    return false
  }

  for (const position of openPositions) {
    if (position.sector !== candidate.sector || !position.returns_60d?.length) {
      continue
    }

    const overlap = Math.min(candidate.returns_60d.length, position.returns_60d.length)
    if (overlap < CORRELATION_MIN_OBSERVATIONS) {
      continue
    }

    const correlation = pearsonCorrelation(
      candidate.returns_60d.slice(-overlap),
      position.returns_60d.slice(-overlap),
    )
    if (correlation != null && correlation > CORRELATION_BREACH_THRESHOLD) {
      return true
    }
  }

  return false
}

function checkPortfolioVetos(
  candidate: CandidatePosition,
  portfolioState: {
    equity: number
    drawdownFromHighPct: number | null
    openPositions: CandidatePosition[]
  },
  params: StrategyParams['risk_params'],
): string[] {
  const triggered: string[] = []
  const equity = portfolioState.equity
  const openPositions = portfolioState.openPositions

  if (
    portfolioState.drawdownFromHighPct != null &&
    Math.abs(portfolioState.drawdownFromHighPct) >= params.max_drawdown_tolerance_pct
  ) {
    triggered.push('drawdown_tolerance_breach')
  }

  if (openPositions.length >= params.max_concurrent_positions) {
    triggered.push('max_concurrent_positions')
  }

  if (equity > 0) {
    const existingRisk = openPositions.reduce((sum, position) => sum + Number(position.dollar_risk ?? 0), 0)
    const candidateRisk = Number(candidate.dollar_risk ?? 0)
    if ((existingRisk + candidateRisk) > equity * params.max_portfolio_heat_pct) {
      triggered.push('risk_budget_exhausted')
    }
  }

  if (equity > 0 && candidate.sector) {
    const existingSectorValue = openPositions
      .filter((position) => position.sector === candidate.sector)
      .reduce((sum, position) => sum + Number(position.dollar_value ?? 0), 0)
    if ((existingSectorValue + Number(candidate.dollar_value ?? 0)) > equity * params.max_sector_exposure_pct) {
      triggered.push('sector_cap_breach')
    }
  }

  if (correlationBreached(candidate, openPositions)) {
    triggered.push('correlation_breach')
  }

  return triggered
}

// Every explicit Alpaca order status this system can observe, mapped to our own
// execution-level vocabulary. `expired` covers every time-in-force-lapsed terminal
// state (expired/done_for_day/stopped/suspended) — kept distinct from `cancelled`
// since nothing in this system ever explicitly cancels an order; `expired` is the
// *expected* outcome for an unfilled day order and needs to be distinguishable from
// an actor-initiated cancellation for alerting/dashboard purposes.
export function mapExecutionStatus(
  orderStatus: string | null | undefined,
): 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected' | 'expired' {
  const status = (orderStatus ?? 'pending').toLowerCase()
  switch (status) {
    case 'filled':
      return 'filled'
    case 'partially_filled':
      return 'partial'
    case 'rejected':
      return 'rejected'
    case 'canceled':
    case 'cancelled':
      return 'cancelled'
    case 'expired':
    case 'done_for_day':
    case 'stopped':
    case 'suspended':
      return 'expired'
    case 'new':
    case 'accepted':
    case 'pending_new':
    case 'accepted_for_bidding':
    case 'calculated':
    case 'pending_cancel':
    case 'pending_replace':
      return 'pending'
    default:
      return 'pending'
  }
}

// Derives the intent-level status from (execution_status, filled_qty) rather than
// execution_status alone — an `expired` order with a nonzero fill is a distinct,
// terminal `partial` state (a day order that ran out of time after partially filling),
// not the same as a clean `expired` (nothing filled) or an open `submitted`.
export function mapIntentStatus(
  executionStatus: ReturnType<typeof mapExecutionStatus>,
  filledQty: number | null,
): 'submitted' | 'filled' | 'cancelled' | 'rejected' | 'expired' | 'partial' {
  if (executionStatus === 'filled') {
    return 'filled'
  }
  if (executionStatus === 'rejected' || executionStatus === 'cancelled') {
    return executionStatus
  }
  if (executionStatus === 'expired') {
    return filledQty != null && filledQty > 0 ? 'partial' : 'expired'
  }
  // 'pending' or 'partial' (still open, more fills may come)
  return 'submitted'
}

// Atomically claims a trade_intent for submission: only one concurrent invocation can
// ever win this UPDATE for a given intent (row-locked at the DB level), which is what
// actually prevents a second, duplicate live order — a plain SELECT-then-UPDATE has a
// TOCTOU race that this closes.
async function claimTradeIntent(
  supabase: ReturnType<typeof createClient>,
  tradeIntentId: string,
): Promise<TradeIntentRow> {
  const { data: claimed, error: claimError } = await supabase
    .from('trade_intents')
    .update({ status: 'submitting', last_attempted_at: new Date().toISOString() })
    .eq('id', tradeIntentId)
    .or(`status.eq.pending,status.eq.scheduled,and(status.eq.failed,retry_count.lt.${MAX_SUBMISSION_RETRIES})`)
    .select('*')
    .maybeSingle()

  if (claimError) {
    throw new TradeError(claimError.message, 500, 'other')
  }
  if (claimed) {
    return claimed as TradeIntentRow
  }

  const { data: existing, error: existingError } = await supabase
    .from('trade_intents')
    .select('id,status')
    .eq('id', tradeIntentId)
    .maybeSingle()

  if (existingError) {
    throw new TradeError(existingError.message, 500, 'other')
  }
  if (!existing) {
    throw new TradeError('Trade intent not found.', 404, 'other')
  }
  throw new TradeError(
    `Trade intent ${tradeIntentId} is not in a submittable state (current status: ${existing.status}).`,
    409,
    'other',
  )
}

// Resolves a 'submitting' claim to its next status. Guarded on status='submitting' so
// it only ever affects the claim this exact invocation is holding.
async function resolveClaim(
  supabase: ReturnType<typeof createClient>,
  intentId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('trade_intents')
    .update(fields)
    .eq('id', intentId)
    .eq('status', 'submitting')

  if (error) {
    throw new TradeError(error.message, 500, 'other')
  }
}

async function loadRecommendationById(
  supabase: ReturnType<typeof createClient>,
  recommendationId: string,
): Promise<RecommendationRow | null> {
  const { data, error } = await supabase
    .from('recommendations')
    .select('id,strategy_id,symbol,status,entry_price,stop_price,target_price')
    .eq('id', recommendationId)
    .maybeSingle()

  if (error) {
    throw new TradeError(error.message, 500, 'other')
  }
  return (data as RecommendationRow | null) ?? null
}

async function loadStrategyParams(supabase: ReturnType<typeof createClient>, strategyId: string | null) {
  if (!strategyId) {
    throw new TradeError('Recommendation is missing strategy_id.', 400, 'other')
  }

  const { data, error } = await supabase
    .from('strategies')
    .select('risk_params')
    .eq('id', strategyId)
    .maybeSingle()

  if (error) {
    throw new TradeError(error.message, 500, 'other')
  }
  if (!data?.risk_params) {
    throw new TradeError('Strategy risk parameters not found.', 404, 'other')
  }

  return data as StrategyParams
}

async function loadPortfolioState(
  supabase: ReturnType<typeof createClient>,
  {
    accountId,
    candidateSymbol,
    equity,
  }: {
    accountId: string
    candidateSymbol: string
    equity: number
  },
) {
  const { data: positions, error: positionsError } = await supabase
    .from('portfolio_positions')
    .select('account_id,symbol,quantity,avg_entry_price,stop_price')
    .eq('account_id', accountId)

  if (positionsError) {
    throw new TradeError(positionsError.message, 500, 'other')
  }

  const positionSymbols = [...new Set([candidateSymbol, ...(positions ?? []).map((position) => position.symbol)])]

  const { data: assets, error: assetsError } = await supabase
    .from('assets')
    .select('symbol,sector')
    .in('symbol', positionSymbols)

  if (assetsError) {
    throw new TradeError(assetsError.message, 500, 'other')
  }

  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
  const { data: bars, error: barsError } = await supabase
    .from('price_bars')
    .select('symbol,bar_time,close')
    .in('symbol', positionSymbols)
    .gte('bar_time', since)
    .order('bar_time', { ascending: true })

  if (barsError) {
    throw new TradeError(barsError.message, 500, 'other')
  }

  const { data: snapshotRows, error: snapshotsError } = await supabase
    .from('portfolio_snapshots')
    .select('drawdown_from_high_pct')
    .eq('account_id', accountId)
    .order('snapshot_date', { ascending: false })
    .limit(1)

  if (snapshotsError) {
    throw new TradeError(snapshotsError.message, 500, 'other')
  }

  const sectorRows = (assets ?? []) as AssetRow[]
  const barRows = (bars ?? []) as PriceBarRow[]
  const positionRows = (positions ?? []) as PortfolioPositionRow[]
  const sectors = new Map(sectorRows.map((asset) => [asset.symbol, asset.sector]))
  const returns = returnsBySymbol(barRows)
  const openPositions: CandidatePosition[] = positionRows.map((position) => {
    const quantity = toNumber(position.quantity, 0) ?? 0
    const avgEntryPrice = toNumber(position.avg_entry_price, 0) ?? 0
    const stopPrice = toNumber(position.stop_price)
    return {
      symbol: position.symbol,
      sector: sectors.get(position.symbol) ?? null,
      dollar_risk: stopPrice == null ? null : Math.max((avgEntryPrice - stopPrice) * quantity, 0),
      dollar_value: avgEntryPrice * quantity,
      returns_60d: returns[position.symbol] ?? null,
    }
  })

  return {
    equity,
    drawdownFromHighPct: toNumber(snapshotRows?.[0]?.drawdown_from_high_pct),
    openPositions,
    candidateSector: sectors.get(candidateSymbol) ?? null,
    candidateReturns: returns[candidateSymbol] ?? null,
  }
}

async function persistOverrides(
  supabase: ReturnType<typeof createClient>,
  intentId: string,
  payload: {
    quantity: number
    dollar_value: number
    stop_price: number
    overrides: Record<string, unknown>
  },
  existingOverrides: Record<string, unknown> | null | undefined,
) {
  const mergedOverrides = {
    ...(existingOverrides ?? {}),
    ...payload.overrides,
  }

  const { error } = await supabase
    .from('trade_intents')
    .update({
      ...payload,
      overrides: mergedOverrides,
    })
    .eq('id', intentId)

  if (error) {
    throw new TradeError(error.message, 500, 'other')
  }
}

// Alpaca requires whole-cent increments for equities priced >= $1.00; sub-penny
// increments are only valid below $1.00. Our own DB storage keeps 4 decimal places
// (finer-grained than Alpaca allows) for internal precision -- this is the point
// where prices actually sent to the broker need to respect its tick size, or the
// order is rejected outright (confirmed live: a bracket order with an unrounded
// 4-decimal take_profit.limit_price was rejected with "sub-penny increment does
// not fulfill minimum pricing criteria").
function roundToTickSize(price: number): number {
  return round(price, price >= 1 ? 2 : 4)
}

function buildOrderBody(
  intent: TradeIntentRow,
  quantity: number,
  stopPrice: number | null,
  targetPrice: number | null,
): Record<string, unknown> {
  const base = {
    symbol: intent.symbol,
    qty: String(quantity),
    side: intent.side,
    time_in_force: 'day',
    client_order_id: intent.id,
  }

  const limitPrice = toNumber(intent.limit_price)

  if (intent.side === 'buy' && intent.order_class === 'bracket') {
    return {
      ...base,
      type: 'limit',
      limit_price: limitPrice != null ? roundToTickSize(limitPrice) : limitPrice,
      order_class: 'bracket',
      take_profit: { limit_price: targetPrice != null ? roundToTickSize(targetPrice) : targetPrice },
      stop_loss: { stop_price: stopPrice != null ? roundToTickSize(stopPrice) : stopPrice },
    }
  }

  return {
    ...base,
    type: intent.order_type ?? 'market',
    ...(intent.order_type === 'limit' && limitPrice != null ? { limit_price: roundToTickSize(limitPrice) } : {}),
  }
}

// Distinguishes a bracket order's stop-loss leg (has stop_price) from its take-profit
// leg (limit_price only, no stop_price) in Alpaca's `legs` array.
function extractBracketLegs(order: Record<string, unknown> | null | undefined): {
  stopLegId: string | null
  targetLegId: string | null
} {
  const legs = Array.isArray((order as { legs?: unknown[] })?.legs) ? ((order as { legs: any[] }).legs) : []
  const stopLeg = legs.find((leg) => toNumber(leg?.stop_price) != null)
  const targetLeg = legs.find((leg) => toNumber(leg?.stop_price) == null && toNumber(leg?.limit_price) != null)
  return {
    stopLegId: stopLeg?.id ?? null,
    targetLegId: targetLeg?.id ?? null,
  }
}

async function syncPortfolioPosition(
  supabase: ReturnType<typeof createClient>,
  {
    intent,
    recommendation,
    order,
    effectiveStopPrice,
    effectiveTargetPrice,
  }: {
    intent: TradeIntentRow
    recommendation: RecommendationRow | null
    order: Record<string, unknown> | null
    effectiveStopPrice: number | null
    effectiveTargetPrice: number | null
  },
) {
  const { data: existingPosition, error: existingPositionError } = await supabase
    .from('portfolio_positions')
    .select('signal_id,stop_price,target_price,entry_order_id,stop_order_id,target_order_id,opened_at')
    .eq('account_id', intent.account_id)
    .eq('symbol', intent.symbol)
    .maybeSingle()

  if (existingPositionError) {
    throw new TradeError(existingPositionError.message, 500, 'other')
  }

  const currentPosition = await fetchAlpacaPosition(intent.symbol)

  if (!currentPosition) {
    const { error } = await supabase
      .from('portfolio_positions')
      .delete()
      .eq('account_id', intent.account_id)
      .eq('symbol', intent.symbol)

    if (error) {
      throw new TradeError(error.message, 500, 'other')
    }
    return
  }

  const currentQty = toNumber(currentPosition.qty, 0) ?? 0
  if (currentQty <= 0) {
    const { error } = await supabase
      .from('portfolio_positions')
      .delete()
      .eq('account_id', intent.account_id)
      .eq('symbol', intent.symbol)

    if (error) {
      throw new TradeError(error.message, 500, 'other')
    }
    return
  }

  // Bracket exit legs typically don't get independent, queryable order IDs until the
  // entry leg actually fills — if they're not present yet on this order response, these
  // stay null and the reconciliation job's poll pass is responsible for filling them in
  // once it independently discovers the entry fill.
  const { stopLegId, targetLegId } = intent.order_class === 'bracket' ? extractBracketLegs(order) : { stopLegId: null, targetLegId: null }

  const row = {
    account_id: intent.account_id,
    symbol: intent.symbol,
    quantity: currentQty,
    avg_entry_price: toNumber(currentPosition.avg_entry_price, 0) ?? 0,
    current_price: toNumber(currentPosition.current_price),
    unrealized_pnl: toNumber(currentPosition.unrealized_pl),
    stop_price: effectiveStopPrice ?? toNumber(existingPosition?.stop_price),
    target_price: effectiveTargetPrice ?? toNumber(existingPosition?.target_price),
    signal_id: existingPosition?.signal_id ?? recommendation?.id ?? null,
    entry_order_id: (intent.order_class === 'bracket' ? (order?.id as string | undefined) : undefined) ?? existingPosition?.entry_order_id ?? null,
    stop_order_id: stopLegId ?? existingPosition?.stop_order_id ?? null,
    target_order_id: targetLegId ?? existingPosition?.target_order_id ?? null,
    // Preserve the first observed local opening time, including a fill discovered
    // after the original order submission response was still pending.
    opened_at: existingPosition?.opened_at ?? (order?.filled_at as string | undefined) ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('portfolio_positions')
    .upsert(row, { onConflict: 'account_id,symbol' })

  if (error) {
    throw new TradeError(error.message, 500, 'other')
  }
}

async function updateRecommendationAndOutcome(
  supabase: ReturnType<typeof createClient>,
  {
    recommendation,
    fillPrice,
    effectiveStopPrice,
    effectiveTargetPrice,
  }: {
    recommendation: RecommendationRow
    fillPrice: number | null
    effectiveStopPrice: number | null
    effectiveTargetPrice: number | null
  },
) {
  const { error: recommendationError } = await supabase
    .from('recommendations')
    .update({ status: 'executed' })
    .eq('id', recommendation.id)

  if (recommendationError) {
    throw new TradeError(recommendationError.message, 500, 'other')
  }

  const { error: outcomeError } = await supabase
    .from('decision_outcomes')
    .update({
      mode: 'real',
      entry_price_reference: fillPrice,
      stop_price: effectiveStopPrice,
      target_price: effectiveTargetPrice,
      updated_at: new Date().toISOString(),
    })
    .eq('source_type', 'recommendation')
    .eq('source_id', recommendation.id)
    .eq('mode', 'shadow')

  if (outcomeError) {
    throw new TradeError(outcomeError.message, 500, 'other')
  }
}

async function updatePositionReviewOutcome(
  supabase: ReturnType<typeof createClient>,
  {
    positionReviewId,
    fillPrice,
    effectiveStopPrice,
    effectiveTargetPrice,
  }: {
    positionReviewId: string
    fillPrice: number | null
    effectiveStopPrice: number | null
    effectiveTargetPrice: number | null
  },
) {
  const { error } = await supabase
    .from('decision_outcomes')
    .update({
      mode: 'real',
      entry_price_reference: fillPrice,
      stop_price: effectiveStopPrice,
      target_price: effectiveTargetPrice,
      updated_at: new Date().toISOString(),
    })
    .eq('source_type', 'position_review')
    .eq('source_id', positionReviewId)
    .eq('mode', 'shadow')

  if (error) {
    throw new TradeError(error.message, 500, 'other')
  }
}

async function loadPositionById(
  supabase: ReturnType<typeof createClient>,
  positionId: string,
): Promise<PortfolioPositionRow> {
  const { data, error } = await supabase
    .from('portfolio_positions')
    .select('*')
    .eq('id', positionId)
    .maybeSingle()

  if (error) {
    throw new TradeError(error.message, 500, 'other')
  }
  if (!data) {
    throw new TradeError('Position not found.', 404, 'other')
  }
  return data as PortfolioPositionRow
}

// { action: 'replace_leg', position_id, leg, new_price } — PATCHes the resting
// stop-loss/take-profit order at Alpaca and only updates the DB once the broker
// confirms, so DB and broker never diverge independently.
async function handleReplaceLeg(
  supabase: ReturnType<typeof createClient>,
  payload: ExecuteTradePayload,
): Promise<Response> {
  if (!payload.position_id?.trim()) {
    throw new TradeError('position_id is required.', 400, 'other')
  }
  if (payload.leg !== 'stop_loss' && payload.leg !== 'take_profit') {
    throw new TradeError("leg must be 'stop_loss' or 'take_profit'.", 400, 'other')
  }
  const newPrice = toNumber(payload.new_price)
  if (newPrice == null || newPrice <= 0) {
    throw new TradeError('new_price must be a positive number.', 400, 'other')
  }

  const position = await loadPositionById(supabase, payload.position_id.trim())
  const orderId = payload.leg === 'stop_loss' ? position.stop_order_id : position.target_order_id
  if (!orderId) {
    return jsonResponse(
      { success: false, error: `Position has no live ${payload.leg} order to replace.`, error_type: 'other' },
      404,
    )
  }

  const patchBody = payload.leg === 'stop_loss' ? { stop_price: newPrice } : { limit_price: newPrice }
  const stillLive = await patchAlpacaOrder(orderId, patchBody)

  const positionUpdate: Record<string, unknown> = {}
  if (payload.leg === 'stop_loss') {
    positionUpdate.stop_price = newPrice
    if (!stillLive) positionUpdate.stop_order_id = null
  } else {
    positionUpdate.target_price = newPrice
    if (!stillLive) positionUpdate.target_order_id = null
  }

  const { error } = await supabase.from('portfolio_positions').update(positionUpdate).eq('id', position.id)
  if (error) {
    throw new TradeError(error.message, 500, 'other')
  }

  return jsonResponse({ success: true, replaced: stillLive })
}

// { action: 'cancel_position_orders', position_id } — cancels one resting bracket leg
// (which cancels the whole group per Alpaca's OCO behavior), freeing the shares before
// an independent close order is submitted.
async function handleCancelPositionOrders(
  supabase: ReturnType<typeof createClient>,
  payload: ExecuteTradePayload,
): Promise<Response> {
  if (!payload.position_id?.trim()) {
    throw new TradeError('position_id is required.', 400, 'other')
  }

  const position = await loadPositionById(supabase, payload.position_id.trim())
  const orderIdToCancel = position.stop_order_id ?? position.target_order_id ?? position.entry_order_id

  let cancelled = false
  if (orderIdToCancel) {
    cancelled = await cancelAlpacaOrder(orderIdToCancel)
  }

  const { error } = await supabase
    .from('portfolio_positions')
    .update({ entry_order_id: null, stop_order_id: null, target_order_id: null })
    .eq('id', position.id)

  if (error) {
    throw new TradeError(error.message, 500, 'other')
  }

  return jsonResponse({ success: true, cancelled })
}

async function handlePlaceOrder(
  supabase: ReturnType<typeof createClient>,
  payload: ExecuteTradePayload,
): Promise<Response> {
  if (!payload.trade_intent_id?.trim()) {
    throw new TradeError('trade_intent_id is required.', 400, 'other')
  }

  const intent = await claimTradeIntent(supabase, payload.trade_intent_id.trim())

  let order: Record<string, unknown>
  try {
    const recommendation = intent.signal_id ? await loadRecommendationById(supabase, intent.signal_id) : null
    if (intent.signal_id && !recommendation) {
      throw new TradeError('Linked recommendation not found.', 404, 'other')
    }

    const positionReviewSourceId =
      intent.overrides?.source_type === 'position_review' && typeof intent.overrides?.source_id === 'string'
        ? intent.overrides.source_id
        : null

    const requestedOverrides = payload.overrides ?? {}
    const hasOverrides = Object.keys(requestedOverrides).length > 0
    const entryPrice = (() => {
      const quantity = toNumber(intent.quantity)
      const dollarValue = toNumber(intent.dollar_value)
      if (quantity && quantity > 0 && dollarValue != null) {
        return dollarValue / quantity
      }
      return toNumber(recommendation?.entry_price)
    })()

    if (entryPrice == null || entryPrice <= 0) {
      throw new TradeError('Recommendation is missing a valid entry price.', 400, 'other')
    }

    let effectiveQuantity = toPositiveInteger(intent.quantity, 'trade_intent.quantity')
    let effectiveStopPrice = toNumber(intent.stop_price) ?? toNumber(recommendation?.stop_price)
    let effectiveTargetPrice = toNumber(recommendation?.target_price)

    if (hasOverrides) {
      if (requestedOverrides.shares != null) {
        effectiveQuantity = toPositiveInteger(requestedOverrides.shares, 'overrides.shares')
      }
      if (requestedOverrides.stop_price != null) {
        effectiveStopPrice = toNumber(requestedOverrides.stop_price)
      }
      if (requestedOverrides.target_price != null) {
        effectiveTargetPrice = toNumber(requestedOverrides.target_price)
      }

      if (effectiveStopPrice == null || effectiveStopPrice >= entryPrice) {
        throw new TradeError('overrides.stop_price must be below entry_price.', 400, 'other')
      }
      if (effectiveTargetPrice != null && effectiveTargetPrice <= entryPrice) {
        throw new TradeError('overrides.target_price must be above entry_price.', 400, 'other')
      }

      const account = await fetchAlpacaAccount()
      const equity = toNumber(account.equity, 0) ?? 0
      const strategy = await loadStrategyParams(supabase, recommendation?.strategy_id ?? null)
      const sizing = computePositionSize(equity, entryPrice, effectiveStopPrice, strategy.risk_params)
      if (effectiveQuantity > sizing.shares) {
        throw new TradeError(
          `Requested shares exceed the allowed size (${effectiveQuantity} > ${sizing.shares}).`,
          400,
          'other',
        )
      }

      const portfolioState = await loadPortfolioState(supabase, {
        accountId: intent.account_id,
        candidateSymbol: intent.symbol,
        equity,
      })
      const candidate: CandidatePosition = {
        symbol: intent.symbol,
        sector: portfolioState.candidateSector,
        dollar_risk: round(effectiveQuantity * (entryPrice - effectiveStopPrice), 2),
        dollar_value: round(effectiveQuantity * entryPrice, 2),
        returns_60d: portfolioState.candidateReturns,
      }
      const vetoes = checkPortfolioVetos(candidate, {
        equity: portfolioState.equity,
        drawdownFromHighPct: portfolioState.drawdownFromHighPct,
        openPositions: portfolioState.openPositions,
      }, strategy.risk_params)

      if (vetoes.length > 0) {
        throw new TradeError(
          `Override rejected: portfolio vetoes triggered (${vetoes.join(', ')}).`,
          400,
          'other',
        )
      }

      const normalizedOverrides: Record<string, unknown> = {}
      if (requestedOverrides.shares != null) {
        normalizedOverrides.shares = effectiveQuantity
      }
      if (requestedOverrides.stop_price != null) {
        normalizedOverrides.stop_price = round(effectiveStopPrice, 4)
      }
      if (requestedOverrides.target_price != null && effectiveTargetPrice != null) {
        normalizedOverrides.target_price = round(effectiveTargetPrice, 4)
      }

      await persistOverrides(supabase, intent.id, {
        quantity: effectiveQuantity,
        dollar_value: round(effectiveQuantity * entryPrice, 2),
        stop_price: round(effectiveStopPrice, 4),
        overrides: normalizedOverrides,
      }, intent.overrides)
    }

    if (intent.side === 'buy' && intent.order_class === 'bracket') {
      if (effectiveStopPrice == null || effectiveTargetPrice == null) {
        throw new TradeError('Bracket orders require both a stop price and a target price.', 400, 'other')
      }
      if (intent.limit_price == null) {
        throw new TradeError('Bracket orders require a limit price for the entry leg.', 400, 'other')
      }
    }

    const account = await fetchAlpacaAccount()
    const buyingPower = toNumber(account.buying_power, 0) ?? 0
    const orderNotional = round(effectiveQuantity * entryPrice, 2)
    if (intent.side === 'buy' && orderNotional > buyingPower) {
      throw new TradeError('Insufficient buying power for this order.', 400, 'insufficient_balance')
    }

    try {
      const orderResponse = await alpacaRequest('/v2/orders', {
        method: 'POST',
        body: JSON.stringify(buildOrderBody(intent, effectiveQuantity, effectiveStopPrice, effectiveTargetPrice)),
      })
      order = await orderResponse.json()
    } catch (postError) {
      if (postError instanceof TradeError) {
        // A real broker-side rejection (market_closed, invalid symbol, etc.) — not
        // ambiguous. Let the outer catch classify it (market_closed -> scheduled,
        // everything else -> rejected).
        throw postError
      }

      // The fetch() call itself threw (network failure) — we genuinely don't know
      // whether the order reached Alpaca. Handle this entirely here (not via the
      // outer catch) since the resolution differs from every other error case.
      let recovered: Record<string, unknown> | null | undefined
      try {
        recovered = await fetchAlpacaOrderByClientOrderId(intent.id)
      } catch {
        recovered = undefined
      }

      if (recovered === undefined) {
        // Can't confirm either way. Do not guess — leave the claim at 'submitting'
        // for the reconciliation job's orphan sweep to resolve later.
        return jsonResponse(
          {
            success: false,
            error: 'Order submission failed and broker state could not be confirmed; left for reconciliation.',
            error_type: 'other',
            trade_intent_id: intent.id,
          },
          202,
        )
      }
      if (recovered === null) {
        await resolveClaim(supabase, intent.id, { status: 'failed', retry_count: intent.retry_count + 1 })
        return jsonResponse(
          { success: false, error: 'Order was not accepted by the broker.', error_type: 'other' },
          502,
        )
      }
      order = recovered
    }

    const executionStatus = mapExecutionStatus(order.status as string | undefined)
    const filledQty = toNumber(order.filled_qty)
    const intentStatus = mapIntentStatus(executionStatus, filledQty)

    const { data: execution, error: executionError } = await supabase
      .from('trade_executions')
      .insert({
        intent_id: intent.id,
        broker_order_id: (order.id as string | undefined) ?? null,
        filled_qty: filledQty,
        filled_price: toNumber(order.filled_avg_price),
        filled_at: (order.filled_at as string | undefined) ?? (order.updated_at as string | undefined) ?? null,
        fees: 0,
        status: executionStatus,
        leg_type: intent.order_class === 'bracket' ? 'entry' : null,
        raw_response: order,
      })
      .select('id,status,filled_price,broker_order_id')
      .single()

    if (executionError || !execution) {
      throw new TradeError(executionError?.message ?? 'Failed to persist trade execution.', 500, 'other')
    }

    await resolveClaim(supabase, intent.id, {
      status: intentStatus,
      quantity: effectiveQuantity,
      dollar_value: round(effectiveQuantity * entryPrice, 2),
      stop_price: effectiveStopPrice == null ? null : round(effectiveStopPrice, 4),
    })

    if (executionStatus === 'filled' || executionStatus === 'partial') {
      await syncPortfolioPosition(supabase, {
        intent,
        recommendation,
        order,
        effectiveStopPrice: effectiveStopPrice == null ? null : round(effectiveStopPrice, 4),
        effectiveTargetPrice: effectiveTargetPrice == null ? null : round(effectiveTargetPrice, 4),
      })
    }

    if (intent.side === 'buy' && executionStatus === 'filled' && recommendation) {
      if (positionReviewSourceId) {
        await updatePositionReviewOutcome(supabase, {
          positionReviewId: positionReviewSourceId,
          fillPrice: toNumber(execution.filled_price),
          effectiveStopPrice: effectiveStopPrice == null ? null : round(effectiveStopPrice, 4),
          effectiveTargetPrice: effectiveTargetPrice == null ? null : round(effectiveTargetPrice, 4),
        })
      } else {
        await updateRecommendationAndOutcome(supabase, {
          recommendation,
          fillPrice: toNumber(execution.filled_price),
          effectiveStopPrice: effectiveStopPrice == null ? null : round(effectiveStopPrice, 4),
          effectiveTargetPrice: effectiveTargetPrice == null ? null : round(effectiveTargetPrice, 4),
        })
      }
    }

    return jsonResponse({
      success: true,
      trade_execution_id: execution.id,
      broker_order_id: execution.broker_order_id,
      fill_price: execution.filled_price,
      status: intentStatus,
      execution_status: execution.status,
      overrides_applied: hasOverrides,
    })
  } catch (error) {
    if (error instanceof TradeError) {
      if (error.errorType === 'market_closed') {
        await resolveClaim(supabase, intent.id, { status: 'scheduled' }).catch(() => {})
      } else {
        await resolveClaim(supabase, intent.id, { status: 'rejected' }).catch(() => {})
      }
      throw error
    }
    // A raw, non-TradeError exception anywhere before the order POST was attempted
    // (or an unexpected bug) — we know for certain no order was placed, so this is
    // safely retryable.
    await resolveClaim(supabase, intent.id, {
      status: 'failed',
      retry_count: intent.retry_count + 1,
    }).catch(() => {})
    throw new TradeError(safeMessage(error), 500, 'other')
  }
}

// Gated on import.meta.main (true when this file is the actual entry point -- both
// for local `deno run` and for Supabase's edge runtime invoking it directly) so that
// importing the pure functions above for testing (index.test.ts) doesn't also start
// a live listening server as a side effect.
if (import.meta.main) {
  Deno.serve(async (req): Promise<Response> => {
    try {
      const payload = (await req.json()) as ExecuteTradePayload
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )

      if (payload.action === 'replace_leg') {
        return await handleReplaceLeg(supabase, payload)
      }
      if (payload.action === 'cancel_position_orders') {
        return await handleCancelPositionOrders(supabase, payload)
      }
      return await handlePlaceOrder(supabase, payload)
    } catch (error) {
      if (error instanceof TradeError) {
        return jsonResponse(
          {
            success: false,
            error: error.message,
            error_type: error.errorType,
          },
          error.status,
        )
      }

      return jsonResponse(
        {
          success: false,
          error: safeMessage(error),
          error_type: 'other',
        },
        500,
      )
    }
  })
}

import { createClient } from '@supabase/supabase-js'

type OrderSide = 'buy' | 'sell'
type OrderType = 'market' | 'limit'
type ErrorType = 'market_closed' | 'insufficient_balance' | 'other'

interface ExecuteTradePayload {
  trade_intent_id: string
  overrides?: {
    shares?: number
    stop_price?: number
    target_price?: number
  }
}

interface TradeIntentRow {
  id: string
  signal_id: string
  account_id: string
  symbol: string
  side: OrderSide
  quantity: number | string
  dollar_value: number | string
  order_type: OrderType
  limit_price: number | string | null
  stop_price: number | string | null
  status: string
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
  account_id: string
  symbol: string
  quantity: number | string
  avg_entry_price: number | string
  stop_price: number | string | null
  target_price?: number | string | null
  signal_id?: string | null
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

async function alpacaRequest(path: string, init: RequestInit): Promise<Response> {
  const baseUrl = (Deno.env.get('ALPACA_BASE_URL') ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '')
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'APCA-API-KEY-ID': Deno.env.get('ALPACA_API_KEY') ?? '',
      'APCA-API-SECRET-KEY': Deno.env.get('ALPACA_API_SECRET') ?? '',
      'Content-Type': 'application/json',
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
  const baseUrl = (Deno.env.get('ALPACA_BASE_URL') ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '')
  const response = await fetch(`${baseUrl}/v2/positions/${symbol}`, {
    method: 'GET',
    headers: {
      'APCA-API-KEY-ID': Deno.env.get('ALPACA_API_KEY') ?? '',
      'APCA-API-SECRET-KEY': Deno.env.get('ALPACA_API_SECRET') ?? '',
      'Content-Type': 'application/json',
    },
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

function mapExecutionStatus(orderStatus: string | null | undefined): 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected' {
  const status = (orderStatus ?? 'pending').toLowerCase()
  if (status === 'filled') {
    return 'filled'
  }
  if (status === 'partially_filled') {
    return 'partial'
  }
  if (status === 'rejected') {
    return 'rejected'
  }
  if (status === 'cancelled' || status === 'canceled') {
    return 'cancelled'
  }
  return 'pending'
}

function mapIntentStatus(executionStatus: ReturnType<typeof mapExecutionStatus>): 'submitted' | 'filled' | 'cancelled' | 'rejected' {
  if (executionStatus === 'filled') {
    return 'filled'
  }
  if (executionStatus === 'cancelled' || executionStatus === 'rejected') {
    return executionStatus
  }
  return 'submitted'
}

async function loadTradeIntent(supabase: ReturnType<typeof createClient>, tradeIntentId: string) {
  const { data: intent, error: intentError } = await supabase
    .from('trade_intents')
    .select('*')
    .eq('id', tradeIntentId)
    .maybeSingle()

  if (intentError) {
    throw new TradeError(intentError.message, 500, 'other')
  }
  if (!intent) {
    throw new TradeError('Trade intent not found.', 404, 'other')
  }

  const { data: recommendation, error: recommendationError } = await supabase
    .from('recommendations')
    .select('id,strategy_id,symbol,status,entry_price,stop_price,target_price')
    .eq('id', intent.signal_id)
    .maybeSingle()

  if (recommendationError) {
    throw new TradeError(recommendationError.message, 500, 'other')
  }
  if (!recommendation) {
    throw new TradeError('Linked recommendation not found.', 404, 'other')
  }

  return {
    intent: intent as TradeIntentRow,
    recommendation: recommendation as RecommendationRow,
  }
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
) {
  const { error } = await supabase
    .from('trade_intents')
    .update(payload)
    .eq('id', intentId)

  if (error) {
    throw new TradeError(error.message, 500, 'other')
  }
}

async function syncPortfolioPosition(
  supabase: ReturnType<typeof createClient>,
  {
    intent,
    recommendation,
    effectiveStopPrice,
    effectiveTargetPrice,
  }: {
    intent: TradeIntentRow
    recommendation: RecommendationRow
    effectiveStopPrice: number | null
    effectiveTargetPrice: number | null
  },
) {
  const { data: existingPosition, error: existingPositionError } = await supabase
    .from('portfolio_positions')
    .select('signal_id,stop_price,target_price')
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

  const row = {
    account_id: intent.account_id,
    symbol: intent.symbol,
    quantity: currentQty,
    avg_entry_price: toNumber(currentPosition.avg_entry_price, 0) ?? 0,
    current_price: toNumber(currentPosition.current_price),
    unrealized_pnl: toNumber(currentPosition.unrealized_pl),
    stop_price: effectiveStopPrice ?? toNumber(existingPosition?.stop_price),
    target_price: effectiveTargetPrice ?? toNumber(existingPosition?.target_price),
    signal_id: existingPosition?.signal_id ?? recommendation.id,
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

Deno.serve(async (req): Promise<Response> => {
  try {
    const payload = (await req.json()) as ExecuteTradePayload
    if (!payload.trade_intent_id?.trim()) {
      throw new TradeError('trade_intent_id is required.', 400, 'other')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { intent, recommendation } = await loadTradeIntent(supabase, payload.trade_intent_id.trim())

    const requestedOverrides = payload.overrides ?? {}
    const hasOverrides = Object.keys(requestedOverrides).length > 0
    const entryPrice =
      toNumber(recommendation.entry_price)
      ?? (() => {
        const quantity = toNumber(intent.quantity)
        const dollarValue = toNumber(intent.dollar_value)
        if (quantity && quantity > 0 && dollarValue != null) {
          return dollarValue / quantity
        }
        return null
      })()

    if (entryPrice == null || entryPrice <= 0) {
      throw new TradeError('Recommendation is missing a valid entry price.', 400, 'other')
    }

    let effectiveQuantity = toPositiveInteger(intent.quantity, 'trade_intent.quantity')
    let effectiveStopPrice = toNumber(intent.stop_price) ?? toNumber(recommendation.stop_price)
    let effectiveTargetPrice = toNumber(recommendation.target_price)

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
      const strategy = await loadStrategyParams(supabase, recommendation.strategy_id)
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
      })
    }

    const account = await fetchAlpacaAccount()
    const buyingPower = toNumber(account.buying_power, 0) ?? 0
    const orderNotional = round(effectiveQuantity * entryPrice, 2)
    if (intent.side === 'buy' && orderNotional > buyingPower) {
      throw new TradeError('Insufficient buying power for this order.', 400, 'insufficient_balance')
    }

    const orderResponse = await alpacaRequest('/v2/orders', {
      method: 'POST',
      body: JSON.stringify({
        symbol: intent.symbol,
        qty: String(effectiveQuantity),
        side: intent.side,
        type: intent.order_type ?? 'market',
        time_in_force: 'day',
        ...(intent.order_type === 'limit' && intent.limit_price != null
          ? { limit_price: intent.limit_price }
          : {}),
      }),
    })
    const order = await orderResponse.json()
    const executionStatus = mapExecutionStatus(order.status)
    const intentStatus = mapIntentStatus(executionStatus)

    const { data: execution, error: executionError } = await supabase
      .from('trade_executions')
      .insert({
        intent_id: intent.id,
        broker_order_id: order.id ?? null,
        filled_qty: toNumber(order.filled_qty),
        filled_price: toNumber(order.filled_avg_price),
        filled_at: order.filled_at ?? order.updated_at ?? null,
        fees: 0,
        status: executionStatus,
        raw_response: order,
      })
      .select('id,status,filled_price,broker_order_id')
      .single()

    if (executionError || !execution) {
      throw new TradeError(executionError?.message ?? 'Failed to persist trade execution.', 500, 'other')
    }

    const { error: intentUpdateError } = await supabase
      .from('trade_intents')
      .update({
        status: intentStatus,
        quantity: effectiveQuantity,
        dollar_value: round(effectiveQuantity * entryPrice, 2),
        stop_price: effectiveStopPrice == null ? null : round(effectiveStopPrice, 4),
      })
      .eq('id', intent.id)

    if (intentUpdateError) {
      throw new TradeError(intentUpdateError.message, 500, 'other')
    }

    if (executionStatus === 'filled' || executionStatus === 'partial') {
      await syncPortfolioPosition(supabase, {
        intent,
        recommendation,
        effectiveStopPrice: effectiveStopPrice == null ? null : round(effectiveStopPrice, 4),
        effectiveTargetPrice: effectiveTargetPrice == null ? null : round(effectiveTargetPrice, 4),
      })
    }

    if (intent.side === 'buy' && executionStatus === 'filled') {
      await updateRecommendationAndOutcome(supabase, {
        recommendation,
        fillPrice: toNumber(execution.filled_price),
        effectiveStopPrice: effectiveStopPrice == null ? null : round(effectiveStopPrice, 4),
        effectiveTargetPrice: effectiveTargetPrice == null ? null : round(effectiveTargetPrice, 4),
      })
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

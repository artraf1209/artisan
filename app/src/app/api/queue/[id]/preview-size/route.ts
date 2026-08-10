import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computePositionSize, DEFAULT_ACCOUNT_ID, round, toNumber } from '@/lib/queue'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as {
    shares?: number | string
    stop_price?: number | string
    target_price?: number | string
  }

  const supabase = createAdminClient() as any
  const { data: recommendation, error: recommendationError } = await supabase
    .from('recommendations')
    .select('id, strategy_id, action, entry_price, stop_price, target_price')
    .eq('id', id)
    .single()

  if (recommendationError || !recommendation) {
    return NextResponse.json(
      { error: recommendationError?.message ?? 'Recommendation not found.' },
      { status: 404 },
    )
  }

  if (recommendation.action !== 'enter') {
    return NextResponse.json(
      { error: 'Only ENTER recommendations can be preview-sized.' },
      { status: 400 },
    )
  }

  const { data: strategy, error: strategyError } = await supabase
    .from('strategies')
    .select('risk_params')
    .eq('id', recommendation.strategy_id)
    .single()

  if (strategyError || !strategy?.risk_params) {
    return NextResponse.json(
      { error: strategyError?.message ?? 'Strategy risk settings not found.' },
      { status: 500 },
    )
  }

  const { data: latestSnapshot } = await supabase
    .from('portfolio_snapshots')
    .select('equity')
    .eq('account_id', DEFAULT_ACCOUNT_ID)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const entryPrice = toNumber(recommendation.entry_price)
  const stopPrice = toNumber(body.stop_price) ?? toNumber(recommendation.stop_price)
  const targetPrice = toNumber(body.target_price) ?? toNumber(recommendation.target_price)

  if (entryPrice == null || stopPrice == null) {
    return NextResponse.json(
      { error: 'Recommendation is missing entry/stop data for sizing.' },
      { status: 400 },
    )
  }

  if (stopPrice >= entryPrice) {
    return NextResponse.json(
      { error: 'Stop price must be below entry price.' },
      { status: 400 },
    )
  }

  const suggested = computePositionSize(
    Number(latestSnapshot?.equity ?? 100000),
    entryPrice,
    stopPrice,
    strategy.risk_params,
  )

  const requestedSharesRaw = body.shares == null || body.shares === ''
    ? suggested.shares
    : Number(body.shares)
  const requestedShares = Number.isInteger(requestedSharesRaw) && requestedSharesRaw > 0
    ? requestedSharesRaw
    : 0

  return NextResponse.json({
    shares: requestedShares,
    max_shares: suggested.shares,
    dollar_risk: round((entryPrice - stopPrice) * requestedShares, 2),
    entry_price: entryPrice,
    stop_price: round(stopPrice, 4),
    target_price: targetPrice == null ? null : round(targetPrice, 4),
    allowed: requestedShares > 0 && requestedShares <= suggested.shares,
  })
}

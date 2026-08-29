import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { invokeExecuteTrade, invokeExecuteTradeAction, RouteError } from '@/lib/execute-trade'
import { round } from '@/lib/queue'

type CloseBody = {
  order_type?: 'market' | 'limit'
  quantity?: number | string
  limit_price?: number | string
}

type PositionRow = {
  id: string
  account_id: string
  symbol: string
  quantity: number | string
  avg_entry_price: number | string
  current_price: number | string | null
  signal_id: string | null
  entry_order_id: string | null
  stop_order_id: string | null
  target_order_id: string | null
}

async function writeAuditLog(
  supabase: any,
  {
    action,
    entityId,
    payload,
  }: {
    action: string
    entityId: string
    payload: Record<string, unknown>
  },
) {
  await supabase.from('audit_log').insert({
    actor: 'close-position-route',
    action,
    entity: 'portfolio_positions',
    entity_id: entityId,
    payload,
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as CloseBody

    const orderType = body.order_type
    if (orderType !== 'market' && orderType !== 'limit') {
      throw new RouteError('order_type must be market or limit.', 400)
    }

    const supabase = createAdminClient() as any
    const { data: position, error: positionError } = await supabase
      .from('portfolio_positions')
      .select('id, account_id, symbol, quantity, avg_entry_price, current_price, signal_id, entry_order_id, stop_order_id, target_order_id')
      .eq('id', id)
      .maybeSingle()

    if (positionError) {
      throw new RouteError(positionError.message, 500)
    }
    if (!position) {
      throw new RouteError('Position not found.', 404)
    }

    const positionRow = position as PositionRow
    const positionQuantity = Number(positionRow.quantity)

    const requestedQuantity = Number(body.quantity)
    if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0 || requestedQuantity > positionQuantity) {
      throw new RouteError(
        `quantity must be a positive integer no greater than the current position size (${positionQuantity}).`,
        400,
      )
    }

    let limitPrice: number | null = null
    if (orderType === 'limit') {
      limitPrice = Number(body.limit_price)
      if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
        throw new RouteError('limit_price must be a positive number for a limit order.', 400)
      }
    }

    const hasRestingOrders = Boolean(
      positionRow.entry_order_id || positionRow.stop_order_id || positionRow.target_order_id,
    )

    if (hasRestingOrders) {
      const cancelResult = await invokeExecuteTradeAction({
        action: 'cancel_position_orders',
        position_id: positionRow.id,
      })

      // The resting stop-loss/take-profit legs reserve the position's shares at the
      // broker -- if we can't confirm they're cancelled, an independent sell risks a
      // rejected or conflicting order, so don't proceed. Mirrors position_review.py's
      // auto-CLOSE path (_cancel_orders_at_broker before _create_sell_trade_intent).
      if (cancelResult.networkFailure || !cancelResult.ok || !cancelResult.body?.success) {
        const errorMessage = cancelResult.networkFailure
          ? cancelResult.networkError
          : cancelResult.body?.error
        throw new RouteError(
          errorMessage ?? 'Failed to cancel the position\'s existing stop-loss/take-profit orders.',
          502,
        )
      }
    }

    const referencePrice = Number(positionRow.current_price ?? positionRow.avg_entry_price)
    const { data: tradeIntent, error: intentError } = await supabase
      .from('trade_intents')
      .insert({
        signal_id: positionRow.signal_id,
        account_id: positionRow.account_id,
        symbol: positionRow.symbol,
        side: 'sell',
        quantity: requestedQuantity,
        dollar_value: round(requestedQuantity * referencePrice, 2),
        order_type: orderType,
        ...(orderType === 'limit' ? { limit_price: round(limitPrice as number, 4) } : {}),
        status: 'pending',
      })
      .select('id')
      .single()

    if (intentError || !tradeIntent?.id) {
      throw new RouteError(intentError?.message ?? 'Failed to create trade intent.', 500)
    }

    await writeAuditLog(supabase, {
      action: 'manual_close_submitted',
      entityId: positionRow.id,
      payload: {
        symbol: positionRow.symbol,
        quantity: requestedQuantity,
        order_type: orderType,
        limit_price: limitPrice,
        trade_intent_id: tradeIntent.id,
      },
    })

    const execution = await invokeExecuteTrade(tradeIntent.id)
    if (!execution.ok) {
      const errorMessage = execution.networkFailure
        ? execution.networkError
        : execution.body?.error ?? 'Trade execution failed.'
      return NextResponse.json({ error: errorMessage }, { status: execution.networkFailure ? 502 : execution.status })
    }

    return NextResponse.json({
      ok: true,
      status: execution.body?.status ?? 'submitted',
      executed: true,
    })
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected close-position error.' },
      { status: 500 },
    )
  }
}

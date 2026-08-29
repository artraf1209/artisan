import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  computePositionSize,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ADMIN_USER_ID,
  round,
  toNumber,
  type QueueType,
} from '@/lib/queue'

type OverridePayload = {
  shares?: number | string
  stop_price?: number | string
  target_price?: number | string
}

type ApproveBody = {
  queue_type?: QueueType
  note?: string
  overrides?: OverridePayload
}

class RouteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

function normalizedNote(note?: string) {
  const trimmed = note?.trim()
  return trimmed ? trimmed : null
}

function normalizeOverrides(overrides?: OverridePayload) {
  if (!overrides) {
    return undefined
  }

  const normalized = {
    shares: overrides.shares == null || overrides.shares === '' ? undefined : Number(overrides.shares),
    stop_price:
      overrides.stop_price == null || overrides.stop_price === ''
        ? undefined
        : Number(overrides.stop_price),
    target_price:
      overrides.target_price == null || overrides.target_price === ''
        ? undefined
        : Number(overrides.target_price),
  }

  return Object.values(normalized).some((value) => value != null) ? normalized : undefined
}

async function invokeExecuteTrade(
  tradeIntentId: string,
  overrides?: {
    shares?: number
    stop_price?: number
    target_price?: number
  },
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new RouteError('Supabase function credentials are not configured.', 500)
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/execute-trade`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trade_intent_id: tradeIntentId,
        ...(overrides ? { overrides } : {}),
      }),
    })

    const body = (await response.json().catch(() => null)) as
      | {
          error?: string
          error_type?: string
          status?: string
          execution_status?: string
        }
      | null

    return {
      ok: response.ok,
      status: response.status,
      body,
      networkFailure: false as const,
    }
  } catch (error) {
    // The fetch() call itself threw (network failure, DNS issue, edge-function cold
    // start timeout) -- distinct from execute-trade responding with a non-ok status.
    // Without this, the trade_intent stays at 'pending' forever with no audit trail.
    return {
      ok: false,
      status: 0,
      body: null,
      networkFailure: true as const,
      networkError: error instanceof Error ? error.message : String(error),
    }
  }
}

async function updateTradeIntentStatus(
  supabase: any,
  tradeIntentId: string,
  status: string,
  extraFields?: Record<string, unknown>,
) {
  const { error } = await supabase
    .from('trade_intents')
    .update({ status, ...extraFields })
    .eq('id', tradeIntentId)
  if (error) {
    throw new RouteError(error.message, 500)
  }
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
    actor: 'queue-approve-route',
    action,
    entity: 'trade_intents',
    entity_id: entityId,
    payload,
  })
}

async function ensurePositionReviewOutcome(
  supabase: any,
  {
    reviewId,
    symbol,
    entryPrice,
    stopPrice,
    targetPrice,
    effectiveHorizonDays,
    setupType,
    regime,
  }: {
    reviewId: string
    symbol: string
    entryPrice: number
    stopPrice: number
    targetPrice: number | null
    effectiveHorizonDays: number | null
    setupType: string | null
    regime: string | null
  },
) {
  const { data: existing, error: existingError } = await supabase
    .from('decision_outcomes')
    .select('id')
    .eq('source_type', 'position_review')
    .eq('source_id', reviewId)
    .limit(1)

  if (existingError) {
    throw new RouteError(existingError.message, 500)
  }

  if (Array.isArray(existing) && existing.length > 0) {
    return
  }

  const { error } = await supabase.from('decision_outcomes').insert({
    source_type: 'position_review',
    source_id: reviewId,
    symbol,
    mode: 'shadow',
    entry_price_reference: round(entryPrice, 4),
    stop_price: round(stopPrice, 4),
    target_price: targetPrice == null ? null : round(targetPrice, 4),
    effective_horizon_days: effectiveHorizonDays,
    setup_type: setupType,
    regime,
    resolution: 'still_open',
  })

  if (error) {
    throw new RouteError(error.message, 500)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as ApproveBody
    const queueType = body.queue_type

    if (queueType !== 'recommendation' && queueType !== 'position_review') {
      throw new RouteError('queue_type must be recommendation or position_review.', 400)
    }

    const supabase = createAdminClient() as any
    const reviewedAt = new Date().toISOString()
    const note = normalizedNote(body.note)

    if (queueType === 'recommendation') {
      const overrides = normalizeOverrides(body.overrides)
      const { data: recommendation, error: recommendationError } = await supabase
        .from('recommendations')
        .select(
          'id, symbol, strategy_id, action, status, entry_price, stop_price, target_price, shares, run_id',
        )
        .eq('id', id)
        .maybeSingle()

      if (recommendationError || !recommendation) {
        throw new RouteError(recommendationError?.message ?? 'Recommendation not found.', 404)
      }
      if (recommendation.status !== 'pending') {
        throw new RouteError('Only pending recommendations can be approved.', 400)
      }
      if (recommendation.action !== 'enter') {
        throw new RouteError('Only ENTER recommendations can be approved into trade intents.', 400)
      }

      const entryPrice = toNumber(recommendation.entry_price)
      const stopPrice = overrides?.stop_price ?? toNumber(recommendation.stop_price)
      const targetPrice = overrides?.target_price ?? toNumber(recommendation.target_price)
      const shares = overrides?.shares ?? toNumber(recommendation.shares)

      if (entryPrice == null || stopPrice == null || shares == null || shares <= 0) {
        throw new RouteError('Recommendation is missing entry, stop, or share sizing.', 400)
      }

      const { data: tradeIntent, error: intentError } = await supabase
        .from('trade_intents')
        .insert({
          signal_id: recommendation.id,
          account_id: DEFAULT_ACCOUNT_ID,
          symbol: recommendation.symbol,
          side: 'buy',
          quantity: shares,
          dollar_value: round(shares * entryPrice, 2),
          order_type: 'limit',
          limit_price: round(entryPrice, 4),
          order_class: 'bracket',
          stop_price: round(stopPrice, 4),
          status: 'pending',
        })
        .select('id')
        .single()

      if (intentError || !tradeIntent?.id) {
        throw new RouteError(intentError?.message ?? 'Failed to create trade intent.', 500)
      }

      const { error: recommendationUpdateError } = await supabase
        .from('recommendations')
        .update({
          status: 'approved',
          reviewed_at: reviewedAt,
          reviewed_by: DEFAULT_ADMIN_USER_ID,
          review_note: note,
        })
        .eq('id', recommendation.id)

      if (recommendationUpdateError) {
        throw new RouteError(recommendationUpdateError.message, 500)
      }

      const execution = await invokeExecuteTrade(tradeIntent.id, overrides)
      if (!execution.ok) {
        if (execution.networkFailure) {
          // execute-trade's atomic claim never resolved -- the intent is otherwise
          // stuck at 'pending' forever. 'failed' (not 'rejected') so the reconciliation
          // job's retry-under-cap logic picks it up automatically.
          await updateTradeIntentStatus(supabase, tradeIntent.id, 'failed', { retry_count: 1 })
          await writeAuditLog(supabase, {
            action: 'execute_network_failure',
            entityId: tradeIntent.id,
            payload: {
              recommendation_id: recommendation.id,
              symbol: recommendation.symbol,
              error: execution.networkError,
            },
          })

          return NextResponse.json({ error: execution.networkError ?? 'Trade execution failed.' }, { status: 502 })
        }

        const errorType = execution.body?.error_type ?? 'other'
        const errorMessage = execution.body?.error ?? 'Trade execution failed.'

        if (errorType === 'market_closed') {
          // execute-trade already resolved the intent's status itself (to 'scheduled')
          // as part of its atomic claim -- only the route-specific audit context is
          // ours to add here.
          await writeAuditLog(supabase, {
            action: 'execute_scheduled',
            entityId: tradeIntent.id,
            payload: {
              recommendation_id: recommendation.id,
              symbol: recommendation.symbol,
              error: errorMessage,
            },
          })

          return NextResponse.json({
            ok: true,
            status: 'scheduled',
            executed: false,
          })
        }

        await writeAuditLog(supabase, {
          action: 'execute_rejected',
          entityId: tradeIntent.id,
          payload: {
            recommendation_id: recommendation.id,
            symbol: recommendation.symbol,
            error: errorMessage,
          },
        })

        return NextResponse.json({ error: errorMessage }, { status: execution.status })
      }

      return NextResponse.json({
        ok: true,
        status: execution.body?.status ?? 'submitted',
        executed: true,
      })
    }

    const { data: review, error: reviewError } = await supabase
      .from('position_reviews')
      .select(
        'id, position_id, symbol, recommended_action, new_stop_price, new_target_price, status, run_id',
      )
      .eq('id', id)
      .maybeSingle()

    if (reviewError || !review) {
      throw new RouteError(reviewError?.message ?? 'Position review not found.', 404)
    }
    if (review.status !== 'pending') {
      throw new RouteError('Only pending position reviews can be approved.', 400)
    }

    if (review.recommended_action === 'add') {
      const { data: position, error: positionError } = await supabase
        .from('portfolio_positions')
        .select(
          'id, account_id, symbol, quantity, avg_entry_price, stop_price, target_price, signal_id, opened_at',
        )
        .eq('id', review.position_id)
        .maybeSingle()

      if (positionError || !position) {
        throw new RouteError(positionError?.message ?? 'Linked position not found.', 404)
      }
      if (!position.signal_id) {
        throw new RouteError('Linked position is missing its original recommendation reference.', 400)
      }

      const { data: originalRecommendation, error: recommendationError } = await supabase
        .from('recommendations')
        .select(
          'id, strategy_id, thesis, entry_price, stop_price, target_price, effective_horizon_days, setup_type, regime',
        )
        .eq('id', position.signal_id)
        .maybeSingle()

      if (recommendationError || !originalRecommendation) {
        throw new RouteError(
          recommendationError?.message ?? 'Original recommendation not found for this position.',
          404,
        )
      }

      const { data: latestPriceRow, error: latestPriceError } = await supabase
        .from('price_bars')
        .select('close')
        .eq('symbol', review.symbol)
        .order('bar_time', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestPriceError) {
        throw new RouteError(latestPriceError.message, 500)
      }

      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select('risk_params')
        .eq('id', originalRecommendation.strategy_id)
        .maybeSingle()

      if (strategyError || !strategy?.risk_params) {
        throw new RouteError(strategyError?.message ?? 'Strategy risk settings not found.', 500)
      }

      const { data: latestSnapshot } = await supabase
        .from('portfolio_snapshots')
        .select('equity')
        .eq('account_id', position.account_id ?? DEFAULT_ACCOUNT_ID)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      const entryPrice = toNumber(latestPriceRow?.close)
      const stopPrice = toNumber(position.stop_price)
      const targetPrice = toNumber(position.target_price)

      if (entryPrice == null || stopPrice == null) {
        throw new RouteError('Position review is missing live entry or stop data.', 400)
      }
      if (stopPrice >= entryPrice) {
        throw new RouteError('The current stop must be below the live entry price for ADD sizing.', 400)
      }

      const sizing = computePositionSize(
        Number(latestSnapshot?.equity ?? 100000),
        entryPrice,
        stopPrice,
        strategy.risk_params,
      )

      if (sizing.shares <= 0) {
        throw new RouteError('No additional shares are allowed under the current risk settings.', 400)
      }

      await ensurePositionReviewOutcome(supabase, {
        reviewId: review.id,
        symbol: review.symbol,
        entryPrice,
        stopPrice,
        targetPrice,
        effectiveHorizonDays: toNumber(originalRecommendation.effective_horizon_days),
        setupType: originalRecommendation.setup_type ?? null,
        regime: originalRecommendation.regime ?? null,
      })

      const { data: tradeIntent, error: intentError } = await supabase
        .from('trade_intents')
        .insert({
          signal_id: originalRecommendation.id,
          account_id: position.account_id ?? DEFAULT_ACCOUNT_ID,
          symbol: review.symbol,
          side: 'buy',
          quantity: sizing.shares,
          dollar_value: round(sizing.shares * entryPrice, 2),
          order_type: 'limit',
          limit_price: round(entryPrice, 4),
          order_class: 'bracket',
          stop_price: round(stopPrice, 4),
          status: 'pending',
          overrides: {
            source_type: 'position_review',
            source_id: review.id,
          },
        })
        .select('id')
        .single()

      if (intentError || !tradeIntent?.id) {
        throw new RouteError(intentError?.message ?? 'Failed to create trade intent.', 500)
      }

      const { error: reviewUpdateError } = await supabase
        .from('position_reviews')
        .update({
          status: 'approved',
          reviewed_at: reviewedAt,
          reviewed_by: DEFAULT_ADMIN_USER_ID,
          review_note: note,
        })
        .eq('id', review.id)

      if (reviewUpdateError) {
        throw new RouteError(reviewUpdateError.message, 500)
      }

      const execution = await invokeExecuteTrade(tradeIntent.id, {
        shares: sizing.shares,
        stop_price: stopPrice,
        ...(targetPrice != null ? { target_price: targetPrice } : {}),
      })

      if (!execution.ok) {
        if (execution.networkFailure) {
          await updateTradeIntentStatus(supabase, tradeIntent.id, 'failed', { retry_count: 1 })
          await writeAuditLog(supabase, {
            action: 'execute_network_failure',
            entityId: tradeIntent.id,
            payload: {
              position_review_id: review.id,
              symbol: review.symbol,
              error: execution.networkError,
            },
          })

          return NextResponse.json({ error: execution.networkError ?? 'Trade execution failed.' }, { status: 502 })
        }

        const errorType = execution.body?.error_type ?? 'other'
        const errorMessage = execution.body?.error ?? 'Trade execution failed.'

        if (errorType === 'market_closed') {
          await writeAuditLog(supabase, {
            action: 'execute_scheduled',
            entityId: tradeIntent.id,
            payload: {
              position_review_id: review.id,
              symbol: review.symbol,
              error: errorMessage,
            },
          })

          return NextResponse.json({
            ok: true,
            status: 'scheduled',
            executed: false,
          })
        }

        await writeAuditLog(supabase, {
          action: 'execute_rejected',
          entityId: tradeIntent.id,
          payload: {
            position_review_id: review.id,
            symbol: review.symbol,
            error: errorMessage,
          },
        })

        return NextResponse.json({ error: errorMessage }, { status: execution.status })
      }

      return NextResponse.json({
        ok: true,
        status: execution.body?.status ?? 'submitted',
        executed: true,
      })
    }

    const positionPatch: Record<string, unknown> = {}
    if (review.new_stop_price != null) {
      positionPatch.stop_price = review.new_stop_price
    }
    if (review.new_target_price != null) {
      positionPatch.target_price = review.new_target_price
    }

    if (Object.keys(positionPatch).length > 0) {
      const { error: positionUpdateError } = await supabase
        .from('portfolio_positions')
        .update(positionPatch)
        .eq('id', review.position_id)

      if (positionUpdateError) {
        throw new RouteError(positionUpdateError.message, 500)
      }
    }

    const { error: reviewUpdateError } = await supabase
      .from('position_reviews')
      .update({
        status: 'approved',
        reviewed_at: reviewedAt,
        reviewed_by: DEFAULT_ADMIN_USER_ID,
        review_note: note,
      })
      .eq('id', review.id)

    if (reviewUpdateError) {
      throw new RouteError(reviewUpdateError.message, 500)
    }

    return NextResponse.json({ ok: true, status: 'approved', executed: true })
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unexpected approval error.',
      },
      { status: 500 },
    )
  }
}

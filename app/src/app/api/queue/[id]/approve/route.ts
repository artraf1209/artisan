import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_ADMIN_USER_ID = (process.env.ADMIN_USER_ID ?? '00000000-0000-0000-0000-000000000001').trim()
const DEFAULT_ACCOUNT_ID = (process.env.ACCOUNT_ID ?? '00000000-0000-0000-0000-000000000002').trim()
const DEFAULT_POSITION_FRACTION = 0.05

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { note } = (await request.json().catch(() => ({}))) as { note?: string }
  const supabase = createAdminClient() as any

  const { data: signal, error: signalError } = await supabase
    .from('signal_events')
    .select('*')
    .eq('id', id)
    .single()

  if (signalError || !signal) {
    return NextResponse.json({ error: signalError?.message ?? 'Signal not found.' }, { status: 404 })
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('id, equity')
    .eq('id', DEFAULT_ACCOUNT_ID)
    .single()

  const { data: strategy } = await supabase
    .from('strategies')
    .select('position_frac')
    .eq('id', signal.strategy_id)
    .single()

  const { data: latestBar } = await supabase
    .from('price_bars')
    .select('close')
    .eq('symbol', signal.symbol)
    .order('bar_time', { ascending: false })
    .limit(1)
    .single()

  const equity = Number(account?.equity ?? 100000)
  const close = Number(latestBar?.close ?? signal.target_price ?? signal.stop_price ?? 1)
  const positionFraction = Number(strategy?.position_frac ?? DEFAULT_POSITION_FRACTION)
  const quantity = Math.max(1, Math.floor((equity * positionFraction) / close))
  const dollarValue = Number((quantity * close).toFixed(2))

  const reviewedAt = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('signal_events')
    .update({
      status: 'approved',
      reviewed_at: reviewedAt,
      reviewed_by: DEFAULT_ADMIN_USER_ID,
      review_note: note?.trim() || null,
    })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const { data: intent, error: intentError } = await supabase
    .from('trade_intents')
    .insert({
      signal_id: signal.id,
      account_id: account?.id ?? DEFAULT_ACCOUNT_ID,
      symbol: signal.symbol,
      side: signal.direction === 'long' ? 'buy' : 'sell',
      quantity,
      dollar_value: dollarValue,
      order_type: 'market',
      limit_price: null,
      stop_price: signal.stop_price,
      status: 'pending',
    })
    .select()
    .single()

  if (intentError) {
    return NextResponse.json({ error: intentError.message }, { status: 500 })
  }

  const intentId = intent?.id
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  let executionStatus = 'pending'
  let executionError: string | null = null

  try {
    const execRes = await fetch(`${supabaseUrl}/functions/v1/execute-trade`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intentId: intentId,
        signalId: signal.id,
        symbol: signal.symbol,
        side: signal.direction === 'long' ? 'buy' : 'sell',
        quantity: quantity,
        orderType: 'market',
      }),
    })

    const execResult = await execRes.json()

    if (execRes.ok && !execResult.error) {
      executionStatus = execResult.trade?.status === 'filled' ? 'filled' : 'submitted'
    } else {
      const errorType = execResult.error_type || 'other'
      executionError = execResult.error

      if (errorType === 'market_closed') {
        executionStatus = 'scheduled'
      } else {
        executionStatus = 'rejected'
      }
    }
  } catch (execErr) {
    executionStatus = 'scheduled'
    executionError = String(execErr)
  }

  const { error: statusError } = await supabase
    .from('trade_intents')
    .update({ status: executionStatus })
    .eq('id', intentId)

  if (executionStatus === 'rejected' || executionStatus === 'scheduled') {
    await supabase.from('audit_log').insert({
      actor: 'approve-route',
      action: executionStatus === 'rejected' ? 'execute_rejected' : 'execute_scheduled',
      entity: 'trade_intents',
      entity_id: intentId,
      payload: {
        signal_id: signal.id,
        symbol: signal.symbol,
        error: executionError,
      },
    })
  }

  return NextResponse.json({ 
    ok: true, 
    executed: executionStatus === 'filled' || executionStatus === 'submitted',
    status: executionStatus,
  })
}

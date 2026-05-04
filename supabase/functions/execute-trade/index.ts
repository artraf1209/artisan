import { serve } from '@std/http/server'
import { createClient } from '@supabase/supabase-js'

interface ExecuteTradePayload {
  signalId: string
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  orderType: 'market' | 'limit'
  limitPrice?: number
}

serve(async (req) => {
  try {
    const payload: ExecuteTradePayload = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const alpacaKey = Deno.env.get('ALPACA_API_KEY')!
    const alpacaSecret = Deno.env.get('ALPACA_API_SECRET')!
    const alpacaBaseUrl = Deno.env.get('ALPACA_BASE_URL') ?? 'https://paper-api.alpaca.markets'
    const isPaper = Deno.env.get('PAPER_TRADING') !== 'false'

    // Submit order to Alpaca
    const orderRes = await fetch(`${alpacaBaseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': alpacaKey,
        'APCA-API-SECRET-KEY': alpacaSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol: payload.symbol,
        qty: payload.quantity,
        side: payload.side,
        type: payload.orderType,
        time_in_force: 'day',
        ...(payload.limitPrice ? { limit_price: payload.limitPrice } : {}),
      }),
    })

    if (!orderRes.ok) {
      const err = await orderRes.text()
      throw new Error(`Alpaca order failed: ${err}`)
    }

    const order = await orderRes.json()

    // Write trade record
    const { data: trade, error } = await supabase
      .from('trades')
      .insert({
        symbol: payload.symbol,
        side: payload.side,
        quantity: payload.quantity,
        price: order.limit_price ?? order.filled_avg_price ?? 0,
        status: order.status === 'filled' ? 'filled' : 'pending',
        broker_order_id: order.id,
        signal_id: payload.signalId,
        paper: isPaper,
        filled_at: order.filled_at ?? null,
      })
      .select()
      .single()

    if (error) throw error

    // Mark signal as executed
    await supabase
      .from('signals')
      .update({ executed: true })
      .eq('id', payload.signalId)

    return new Response(JSON.stringify({ trade }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

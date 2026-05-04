import { createClient } from '@supabase/supabase-js'

interface ExecuteTradePayload {
  signalId?: string
  intentId?: string
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  orderType: 'market' | 'limit'
  limitPrice?: number
}

interface TradeResponse {
  trade?: Record<string, unknown>
  error?: string
  error_type?: string
}

Deno.serve(async (req): Promise<Response> => {
  let response: TradeResponse = {}

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
      const errText = await orderRes.text()
      
      // Determine error type
      let errorType = 'other'
      const errLower = errText.toLowerCase()
      
      // Market closed errors
      if (errLower.includes('market closed') || 
          errLower.includes('outside regular trading hours') ||
          errLower.includes('cannot open') ||
          errLower.includes('40157')) {
        errorType = 'market_closed'
      }
      // Insufficient balance
      else if (errLower.includes('insufficient') || 
               errLower.includes('42202') ||
               errLower.includes('balance')) {
        errorType = 'insufficient_balance'
      }
      
      response = { 
        error: errText, 
        error_type: errorType 
      }
      
      return new Response(JSON.stringify(response), {
        status: orderRes.status,
        headers: { 'Content-Type': 'application/json' },
      })
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

    // Mark signal as executed (if signalId provided)
    if (payload.signalId) {
      await supabase
        .from('signals')
        .update({ executed: true })
        .eq('id', payload.signalId)
    }

    // Update trade_intents status (if intentId provided)
    if (payload.intentId) {
      const intentStatus = order.status === 'filled' ? 'filled' : 'submitted'
      await supabase
        .from('trade_intents')
        .update({ status: intentStatus })
        .eq('id', payload.intentId)
    }

    response = { trade }
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    response = { 
      error: String(err), 
      error_type: 'other' 
    }
    
    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

import { serve } from '@std/http/server'
import { createClient } from '@supabase/supabase-js'

const CONFIDENCE_THRESHOLD = 0.70

serve(async (req) => {
  try {
    const { record } = await req.json()

    if (!record || record.confidence < CONFIDENCE_THRESHOLD) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Check if engine is paused
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { data: settings } = await supabase
      .from('logs')
      .select('message')
      .eq('source', 'engine')
      .eq('level', 'info')
      .ilike('message', 'PAUSED%')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (settings?.message?.startsWith('PAUSED')) {
      return new Response(JSON.stringify({ skipped: true, reason: 'engine paused' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Invoke execute-trade
    const res = await fetch(`${supabaseUrl}/functions/v1/execute-trade`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        signalId: record.id,
        symbol: record.symbol,
        side: record.direction === 'long' ? 'buy' : 'sell',
        quantity: 1,
        orderType: 'market',
      }),
    })

    const result = await res.json()

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

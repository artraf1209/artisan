import { serve } from '@std/http/server'
import { createClient } from '@supabase/supabase-js'

interface AlertPayload {
  chatId?: string
  message: string
  trigger?: string
  tradeId?: string
}

serve(async (req) => {
  try {
    const payload: AlertPayload = await req.json()

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')!
    const chatId = payload.chatId ?? Deno.env.get('TELEGRAM_CHAT_ID')!

    const telegramRes = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: payload.message,
          parse_mode: 'Markdown',
        }),
      },
    )

    if (!telegramRes.ok) {
      const err = await telegramRes.text()
      throw new Error(`Telegram API error: ${err}`)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    await supabase.from('alerts').insert({
      chat_id: chatId,
      message: payload.message,
      trigger: payload.trigger ?? null,
      trade_id: payload.tradeId ?? null,
      sent: true,
      sent_at: new Date().toISOString(),
    })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

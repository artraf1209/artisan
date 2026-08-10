import { createClient } from '@supabase/supabase-js'

interface AlertPayload {
  chatId?: string
  message?: string
  trigger?: string
  tradeId?: string
  briefing?: {
    urgent_flags?: string[]
    regime_line?: string | null
    new_recommendations_summary?: string | null
    portfolio_state_line?: string | null
  }
}

function formatBriefingMessage(briefing: NonNullable<AlertPayload['briefing']>) {
  const lines: string[] = []
  for (const flag of briefing.urgent_flags ?? []) {
    lines.push(`⚠️ ${flag}`)
  }
  if (lines.length > 0) {
    lines.push('')
  }
  if (briefing.regime_line) {
    lines.push(briefing.regime_line)
    lines.push('')
  }
  if (briefing.new_recommendations_summary) {
    lines.push(briefing.new_recommendations_summary)
    lines.push('')
  }
  if (briefing.portfolio_state_line) {
    lines.push(briefing.portfolio_state_line)
    lines.push('')
  }

  const appBaseUrl = Deno.env.get('APP_BASE_URL')?.replace(/\/$/, '')
  lines.push(
    appBaseUrl
      ? `See ${appBaseUrl}/briefings for the full digest.`
      : 'See dashboard for the full briefing.',
  )

  return lines.join('\n')
}

Deno.serve(async (req) => {
  try {
    const payload: AlertPayload = await req.json()
    const message = payload.briefing ? formatBriefingMessage(payload.briefing) : payload.message

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')!
    const chatId = payload.chatId ?? Deno.env.get('TELEGRAM_CHAT_ID')!
    if (!message) {
      throw new Error('message is required.')
    }

    const telegramRes = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
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
      message,
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

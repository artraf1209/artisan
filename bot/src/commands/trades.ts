import type { Context } from 'grammy'
import { supabase } from '../lib/supabase'

export async function tradesCommand(ctx: Context) {
  const { data: trades } = await supabase
    .from('trades')
    .select('symbol, side, quantity, price, status, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  if (!trades || trades.length === 0) {
    return ctx.reply('No trades recorded yet.')
  }

  const lines = trades.map(
    (t) =>
      `• ${t.symbol} ${t.side.toUpperCase()} ${t.quantity} @ $${Number(t.price).toFixed(2)} — ${t.status}`,
  )

  await ctx.reply(`*Last 5 Trades*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
}

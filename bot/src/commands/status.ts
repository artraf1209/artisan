import type { Context } from 'grammy'
import { supabase } from '../lib/supabase'

export async function statusCommand(ctx: Context) {
  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, quantity, unrealized_pnl')
    .order('updated_at', { ascending: false })

  if (!positions || positions.length === 0) {
    return ctx.reply('No open positions.')
  }

  const totalPnl = positions.reduce((sum, p) => sum + (p.unrealized_pnl ?? 0), 0)
  const lines = positions.map(
    (p) => `• ${p.symbol}: ${p.quantity} shares, P&L: $${(p.unrealized_pnl ?? 0).toFixed(2)}`,
  )

  await ctx.reply(
    `*Portfolio Status*\n\n${lines.join('\n')}\n\n*Total Unrealized P&L: $${totalPnl.toFixed(2)}*`,
    { parse_mode: 'Markdown' },
  )
}

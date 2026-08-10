import type { Context } from 'grammy'
import { supabase } from '../lib/supabase'

function formatCurrency(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return 'N/A'
  }

  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

export async function tradesCommand(ctx: Context) {
  const { data: positions } = await supabase
    .from('portfolio_positions')
    .select('symbol, quantity, avg_entry_price, current_price, unrealized_pnl, updated_at')
    .order('updated_at', { ascending: false })
    .limit(10)

  if (!positions || positions.length === 0) {
    return ctx.reply('No open positions.')
  }

  const symbolsNeedingPrices = positions
    .filter((position) => position.current_price == null || position.unrealized_pnl == null)
    .map((position) => position.symbol)

  const { data: latestBars } =
    symbolsNeedingPrices.length > 0
      ? await supabase
          .from('price_bars')
          .select('symbol, close, bar_time')
          .in('symbol', symbolsNeedingPrices)
          .order('bar_time', { ascending: false })
          .limit(500)
      : { data: [] }

  const latestPriceBySymbol = new Map<string, number>()
  for (const bar of latestBars ?? []) {
    if (!latestPriceBySymbol.has(bar.symbol)) {
      latestPriceBySymbol.set(bar.symbol, Number(bar.close))
    }
  }

  const lines = positions.map((position) => {
    const avgEntry = Number(position.avg_entry_price)
    const currentPrice =
      position.current_price == null
        ? (latestPriceBySymbol.get(position.symbol) ?? null)
        : Number(position.current_price)
    const unrealizedPnl =
      position.unrealized_pnl == null && currentPrice != null
        ? (currentPrice - avgEntry) * Number(position.quantity)
        : (position.unrealized_pnl == null ? null : Number(position.unrealized_pnl))

    return `• ${position.symbol}: ${position.quantity} shares | Entry ${formatCurrency(avgEntry)} | Last ${formatCurrency(currentPrice)} | Unrealized ${formatCurrency(unrealizedPnl)}`
  })

  await ctx.reply(`Open Positions\n\n${lines.join('\n')}`)
}

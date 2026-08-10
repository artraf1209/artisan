import type { Context } from 'grammy'
import { supabase } from '../lib/supabase'

const DEFAULT_STRATEGY_ID = process.env.STRATEGY_ID ?? '00000000-0000-0000-0000-000000000010'

function formatCurrency(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return 'N/A'
  }

  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return 'N/A'
  }

  return `${(value * 100).toFixed(2)}%`
}

function formatPauseStatus(value: string | null) {
  if (!value) {
    return 'active'
  }

  const pausedUntil = new Date(value)
  if (Number.isNaN(pausedUntil.getTime()) || pausedUntil.getTime() <= Date.now()) {
    return 'active'
  }

  return `paused until ${pausedUntil.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`
}

export async function statusCommand(ctx: Context) {
  const [{ data: regime }, { data: snapshot }, { data: positions }, { data: strategy }] =
    await Promise.all([
      supabase
        .from('regime_snapshots')
        .select('regime, date')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('portfolio_snapshots')
        .select('equity, drawdown_from_high_pct, snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('portfolio_positions')
        .select('id')
        .order('updated_at', { ascending: false }),
      supabase
        .from('strategies')
        .select('paused_until')
        .eq('id', DEFAULT_STRATEGY_ID)
        .limit(1)
        .maybeSingle(),
    ])

  const openPositionsCount = positions?.length ?? 0
  const lines = [
    'Portfolio Status',
    '',
    `Regime: ${regime?.regime ?? 'unknown'}`,
    `Snapshot date: ${snapshot?.snapshot_date ?? 'N/A'}`,
    `Equity: ${formatCurrency(snapshot?.equity == null ? null : Number(snapshot.equity))}`,
    `Drawdown: ${formatPercent(snapshot?.drawdown_from_high_pct == null ? null : Number(snapshot.drawdown_from_high_pct))}`,
    `Open positions: ${openPositionsCount}`,
    `Engine: ${formatPauseStatus(strategy?.paused_until ?? null)}`,
  ]

  await ctx.reply(lines.join('\n'))
}

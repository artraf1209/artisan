import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { WaitingTrade, InMarketTrade, ClosedTrade } from '@/app/api/strategy/trades/route'

function PnlBadge({ value, pct }: { value: number | null; pct: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>
  const positive = value >= 0
  return (
    <span className={cn('text-sm font-semibold tabular-nums', positive ? 'text-profit' : 'text-loss')}>
      {positive ? '+' : ''}{formatCurrency(value)}
      {pct != null && (
        <span className="ml-1 text-xs font-normal opacity-80">
          ({positive ? '+' : ''}{pct.toFixed(2)}%)
        </span>
      )}
    </span>
  )
}

function Row({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground tabular-nums">{value}</span>
    </div>
  )
}

function ScorePips({ f, t, s }: { f: number; t: number; s: number }) {
  const scores = [
    { label: 'F', value: f },
    { label: 'T', value: t },
    { label: 'S', value: s },
  ]
  return (
    <div className="flex items-center gap-1.5">
      {scores.map(({ label, value }) => (
        <span
          key={label}
          className={cn(
            'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium',
            value >= 0.65
              ? 'bg-profit/15 text-profit'
              : value >= 0.45
              ? 'bg-yellow-400/15 text-yellow-400'
              : 'bg-loss/15 text-loss',
          )}
        >
          {label} {value.toFixed(2)}
        </span>
      ))}
    </div>
  )
}

export function WaitingCard({ trade }: { trade: WaitingTrade }) {
  const subStatus = trade.has_intent ? 'Awaiting execution' : 'Awaiting approval'
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{trade.symbol}</p>
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
            Long
          </span>
        </div>
        <div className="text-right">
          <p className={cn('text-base font-semibold tabular-nums',
            trade.composite_score >= 0.65 ? 'text-profit' : trade.composite_score >= 0.45 ? 'text-yellow-400' : 'text-loss'
          )}>
            {trade.composite_score.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">composite</p>
        </div>
      </div>
      <ScorePips f={trade.f_score} t={trade.t_score} s={trade.s_score} />
      <div className="space-y-1 border-t border-border/40 pt-3">
        <Row label="Stop" value={trade.stop_price != null ? formatCurrency(trade.stop_price) : '—'} />
        <Row label="Target" value={trade.target_price != null ? formatCurrency(trade.target_price) : '—'} />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/40 pt-2">
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-400">{subStatus}</span>
        <span>{formatDate(trade.created_at)}</span>
      </div>
    </div>
  )
}

export function InMarketCard({ trade }: { trade: InMarketTrade }) {
  const daysHeld = Math.floor((Date.now() - new Date(trade.opened_at).getTime()) / 86_400_000)
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{trade.symbol}</p>
          <p className="text-xs text-muted-foreground">{trade.quantity} shares</p>
        </div>
        <div className="text-right">
          <PnlBadge value={trade.unrealized_pnl} pct={trade.unrealized_pnl_pct} />
          <p className="text-xs text-muted-foreground mt-0.5">unrealized</p>
        </div>
      </div>
      <div className="space-y-1 border-t border-border/40 pt-3">
        <Row label="Avg entry" value={formatCurrency(trade.avg_entry_price)} />
        <Row label="Current" value={trade.current_price != null ? formatCurrency(trade.current_price) : '—'} />
        {trade.stop_price != null && <Row label="Stop" value={formatCurrency(trade.stop_price)} />}
        {trade.target_price != null && <Row label="Target" value={formatCurrency(trade.target_price)} />}
      </div>
      <p className="text-xs text-muted-foreground border-t border-border/40 pt-2">
        {daysHeld === 0 ? 'Opened today' : `${daysHeld}d held`}
        {trade.source === 'legacy' && <span className="ml-2 opacity-60">(legacy)</span>}
      </p>
    </div>
  )
}

export function ClosedCard({ trade }: { trade: ClosedTrade }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{trade.symbol}</p>
          <span className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            trade.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400',
          )}>
            {trade.side === 'buy' ? 'Long' : 'Short'}
          </span>
        </div>
        <PnlBadge value={trade.pnl} pct={trade.pnl_pct} />
      </div>
      <div className="space-y-1 border-t border-border/40 pt-3">
        <Row label="Entry" value={formatCurrency(trade.entry_price)} />
        <Row label="Exit" value={trade.exit_price != null ? formatCurrency(trade.exit_price) : '—'} />
        <Row label="Qty" value={trade.quantity} />
      </div>
      {trade.closed_at && (
        <p className="text-xs text-muted-foreground border-t border-border/40 pt-2">
          {formatDate(trade.closed_at)}
          {trade.source === 'legacy' && <span className="ml-2 opacity-60">(legacy)</span>}
        </p>
      )}
    </div>
  )
}

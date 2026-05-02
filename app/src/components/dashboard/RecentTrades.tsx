import type { Trade } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import StatusBadge from '@/components/shared/StatusBadge'

export default function RecentTrades({ trades }: { trades: Trade[] }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold text-foreground">Recent Trades</h2>
      </div>
      <div className="divide-y divide-border">
        {trades.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted-foreground">No trades yet.</p>
        )}
        {trades.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="font-medium text-foreground">{t.symbol}</p>
              <p className="text-xs text-muted-foreground">{formatDate(t.created_at)}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium ${t.side === 'buy' ? 'text-profit' : 'text-loss'}`}>
                {t.side.toUpperCase()} {t.quantity}
              </span>
              <span className="text-sm text-muted-foreground">{formatCurrency(t.price)}</span>
              <StatusBadge status={t.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

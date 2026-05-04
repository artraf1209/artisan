import type { Trade } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import StatusBadge from '@/components/shared/StatusBadge'

export default function RecentTrades({ trades }: { trades: Trade[] }) {
  return (
    <div className="surface-panel col-span-1 xl:col-span-6">
      <div className="border-b border-border/70 px-5 py-4">
        <h2 className="text-lg font-semibold tracking-[-0.04em] text-foreground">Recent trades</h2>
      </div>
      <div className="divide-y divide-border/70">
        {trades.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted-foreground">No trades yet.</p>
        )}
        {trades.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-lg font-medium tracking-[-0.03em] text-foreground">{t.symbol}</p>
              <p className="text-sm text-muted-foreground">{formatDate(t.created_at)}</p>
            </div>
            <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
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

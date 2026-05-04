import type { Trade } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import StatusBadge from '@/components/shared/StatusBadge'

export default function TradeTable({ trades }: { trades: Trade[] }) {
  return (
    <div className="surface-panel overflow-hidden">
      <div className="divide-y divide-border/70 md:hidden">
        {trades.length === 0 && (
          <div className="px-5 py-8 text-center text-muted-foreground">No trades recorded yet.</div>
        )}
        {trades.map((trade) => (
          <div key={trade.id} className="space-y-4 px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-medium tracking-[-0.03em] text-foreground">
                  {trade.symbol}
                </p>
                <p className="text-sm text-muted-foreground">{formatDate(trade.created_at)}</p>
              </div>
              <StatusBadge status={trade.status} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <TradeMetric
                label="Side"
                value={trade.side.toUpperCase()}
                valueClassName={trade.side === 'buy' ? 'text-profit' : 'text-loss'}
              />
              <TradeMetric label="Qty" value={String(trade.quantity)} />
              <TradeMetric label="Price" value={formatCurrency(trade.price)} />
              <TradeMetric label="Paper" value={trade.paper ? 'Yes' : 'No'} />
            </div>
          </div>
        ))}
      </div>

      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-border/70 bg-muted/25">
            <th className="text-left px-4 py-3 text-muted-foreground font-medium">Symbol</th>
            <th className="text-left px-4 py-3 text-muted-foreground font-medium">Side</th>
            <th className="text-right px-4 py-3 text-muted-foreground font-medium">Qty</th>
            <th className="text-right px-4 py-3 text-muted-foreground font-medium">Price</th>
            <th className="text-left px-4 py-3 text-muted-foreground font-medium">Status</th>
            <th className="text-left px-4 py-3 text-muted-foreground font-medium">Paper</th>
            <th className="text-left px-4 py-3 text-muted-foreground font-medium">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {trades.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                No trades recorded yet.
              </td>
            </tr>
          )}
          {trades.map((t) => (
            <tr key={t.id} className="hover:bg-accent/20 transition-colors">
              <td className="px-4 py-3 font-medium text-foreground">{t.symbol}</td>
              <td className={`px-4 py-3 font-medium ${t.side === 'buy' ? 'text-profit' : 'text-loss'}`}>
                {t.side.toUpperCase()}
              </td>
              <td className="px-4 py-3 text-right text-foreground">{t.quantity}</td>
              <td className="px-4 py-3 text-right text-foreground">{formatCurrency(t.price)}</td>
              <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
              <td className="px-4 py-3 text-muted-foreground">{t.paper ? 'Yes' : 'No'}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(t.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TradeMetric({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="rounded-[1.25rem] border border-border/70 bg-background/30 px-3 py-3">
      <p className="text-[0.7rem] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={`mt-2 text-sm font-medium text-foreground ${valueClassName ?? ''}`}>{value}</p>
    </div>
  )
}

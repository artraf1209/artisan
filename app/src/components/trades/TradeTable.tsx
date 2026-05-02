import type { Trade } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import StatusBadge from '@/components/shared/StatusBadge'

export default function TradeTable({ trades }: { trades: Trade[] }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left px-4 py-3 text-muted-foreground font-medium">Symbol</th>
            <th className="text-left px-4 py-3 text-muted-foreground font-medium">Side</th>
            <th className="text-right px-4 py-3 text-muted-foreground font-medium">Qty</th>
            <th className="text-right px-4 py-3 text-muted-foreground font-medium">Price</th>
            <th className="text-left px-4 py-3 text-muted-foreground font-medium">Status</th>
            <th className="text-left px-4 py-3 text-muted-foreground font-medium">Paper</th>
            <th className="text-left px-4 py-3 text-muted-foreground font-medium">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
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

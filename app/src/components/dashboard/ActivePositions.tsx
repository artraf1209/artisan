import type { Position } from '@/types'
import { formatCurrency } from '@/lib/utils'

export default function ActivePositions({ positions }: { positions: Position[] }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold text-foreground">Open Positions</h2>
      </div>
      <div className="divide-y divide-border">
        {positions.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted-foreground">No open positions.</p>
        )}
        {positions.map((p) => (
          <div key={p.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="font-medium text-foreground">{p.symbol}</p>
              <p className="text-xs text-muted-foreground">
                {p.quantity} @ {formatCurrency(p.avg_entry_price)}
              </p>
            </div>
            <div className="text-right">
              <p className={`font-medium ${(p.unrealized_pnl ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                {formatCurrency(p.unrealized_pnl)}
              </p>
              <p className="text-xs text-muted-foreground">{formatCurrency(p.current_price)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

import type { Position } from '@/types'
import { formatCurrency } from '@/lib/utils'

export default function ActivePositions({ positions }: { positions: Position[] }) {
  return (
    <div className="surface-panel col-span-1 xl:col-span-6">
      <div className="border-b border-border/70 px-5 py-4">
        <h2 className="text-lg font-semibold tracking-[-0.04em] text-foreground">Open positions</h2>
      </div>
      <div className="divide-y divide-border/70">
        {positions.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted-foreground">No open positions.</p>
        )}
        {positions.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-lg font-medium tracking-[-0.03em] text-foreground">{p.symbol}</p>
              <p className="text-sm text-muted-foreground">
                {p.quantity} @ {formatCurrency(p.avg_entry_price)}
              </p>
            </div>
            <div className="text-right">
              <p className={`text-lg font-medium ${(p.unrealized_pnl ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                {formatCurrency(p.unrealized_pnl)}
              </p>
              <p className="text-sm text-muted-foreground">{formatCurrency(p.current_price)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

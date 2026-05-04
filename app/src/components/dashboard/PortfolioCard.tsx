import type { Position } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { TrendingUp, TrendingDown } from 'lucide-react'

export default function PortfolioCard({ positions }: { positions: Position[] }) {
  const totalUnrealized = positions.reduce((sum, p) => sum + (p.unrealized_pnl ?? 0), 0)
  const isPositive = totalUnrealized >= 0

  return (
    <div className="surface-panel col-span-1 p-6 md:col-span-1 xl:col-span-4">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Portfolio</p>
          <p className="mt-2 text-sm text-muted-foreground">Open position exposure</p>
        </div>
        {isPositive ? (
          <TrendingUp size={22} className="text-profit" />
        ) : (
          <TrendingDown size={22} className="text-loss" />
        )}
      </div>
      <div className="flex items-end gap-3">
        <span className={`metric-value ${isPositive ? 'text-profit' : 'text-loss'}`}>
          {formatCurrency(totalUnrealized)}
        </span>
      </div>
      <div className="mt-6 flex items-center justify-between rounded-[1.5rem] border border-border/70 bg-background/30 px-4 py-4">
        <div>
          <p className="text-sm font-medium text-foreground">Open positions</p>
          <p className="text-sm text-muted-foreground">
            {positions.length} active {positions.length === 1 ? 'name' : 'names'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tracking-[-0.05em] text-foreground">
            {positions.length}
          </p>
        </div>
      </div>
    </div>
  )
}

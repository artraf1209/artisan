import type { Position } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { TrendingUp, TrendingDown } from 'lucide-react'

export default function PortfolioCard({ positions }: { positions: Position[] }) {
  const totalUnrealized = positions.reduce((sum, p) => sum + (p.unrealized_pnl ?? 0), 0)
  const isPositive = totalUnrealized >= 0

  return (
    <div className="rounded-lg border border-border bg-card p-5 col-span-1 md:col-span-3">
      <p className="text-sm text-muted-foreground mb-1">Unrealized P&L</p>
      <div className="flex items-center gap-2">
        {isPositive ? (
          <TrendingUp size={20} className="text-profit" />
        ) : (
          <TrendingDown size={20} className="text-loss" />
        )}
        <span className={`text-3xl font-bold ${isPositive ? 'text-profit' : 'text-loss'}`}>
          {formatCurrency(totalUnrealized)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{positions.length} open position{positions.length !== 1 ? 's' : ''}</p>
    </div>
  )
}

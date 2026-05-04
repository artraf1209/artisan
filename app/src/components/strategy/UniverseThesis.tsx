import { cn } from '@/lib/utils'
import { formatPercent } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus, CircleDot } from 'lucide-react'

interface UniverseRow {
  symbol: string
  sector: string | null
  added_at: string
  score: {
    f_score: number
    t_score: number
    s_score: number
    composite: number
    pillars_passed: number
    scored_at: string
  } | null
  indicators: {
    rsi_14: number | null
    macd_hist: number | null
    atr_14: number | null
    sma_50: number | null
    sma_200: number | null
  } | null
  current_price: number | null
  trend_pct: number | null
  active_signal: { status: string; composite_score: number } | null
}

function scoreColour(score: number | null): string {
  if (score == null) return 'text-muted-foreground'
  if (score >= 0.65) return 'text-profit'
  if (score >= 0.45) return 'text-yellow-400'
  return 'text-loss'
}

function ScoreBar({ score }: { score: number | null }) {
  const pct = score != null ? Math.round(score * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border/40">
        <div
          className={cn(
            'h-full rounded-full',
            score == null ? 'bg-border/60' : score >= 0.65 ? 'bg-profit' : score >= 0.45 ? 'bg-yellow-400' : 'bg-loss',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('text-xs tabular-nums', scoreColour(score))}>
        {score != null ? score.toFixed(2) : '—'}
      </span>
    </div>
  )
}

function keyIndicator(iv: UniverseRow['indicators']): string {
  if (!iv) return '—'
  const parts: string[] = []
  if (iv.rsi_14 != null) parts.push(`RSI ${Math.round(iv.rsi_14)}`)
  if (iv.macd_hist != null) parts.push(iv.macd_hist > 0 ? 'MACD ↑' : 'MACD ↓')
  if (iv.sma_50 != null && iv.sma_200 != null)
    parts.push(iv.sma_50 > iv.sma_200 ? 'SMA ↑' : 'SMA ↓')
  return parts.slice(0, 2).join(' · ') || '—'
}

function SignalBadge({ signal }: { signal: UniverseRow['active_signal'] }) {
  if (!signal) return <span className="text-xs text-muted-foreground">—</span>
  const isPending = signal.status === 'pending'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isPending
          ? 'bg-amber-500/15 text-amber-400'
          : 'bg-blue-500/15 text-blue-400',
      )}
    >
      <CircleDot size={9} />
      {isPending ? 'Pending' : 'Approved'}
    </span>
  )
}

export default function UniverseThesis({ rows }: { rows: UniverseRow[] }) {
  const hasScores = rows.some(r => r.score != null)

  return (
    <div className="surface-panel p-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Universe Analysis</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} symbols tracked
            {!hasScores && ' — run first ingestion to populate scores'}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-border/60">
              {['Symbol', 'Sector', 'F-Score', 'T-Score', 'S-Score', 'Composite', 'Indicators', 'Trend (30d)', 'Signal'].map(h => (
                <th key={h} className="pb-2 pr-4 text-left text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground last:pr-0">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {rows.map(row => {
              const trend = row.trend_pct
              const TrendIcon = trend == null ? Minus : trend >= 0 ? TrendingUp : TrendingDown
              const trendColour = trend == null ? 'text-muted-foreground' : trend >= 0 ? 'text-profit' : 'text-loss'

              return (
                <tr key={row.symbol} className="group transition-colors hover:bg-card/40">
                  <td className="py-3 pr-4 font-semibold text-foreground">{row.symbol}</td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">{row.sector ?? '—'}</td>
                  <td className="py-3 pr-4"><ScoreBar score={row.score?.f_score ?? null} /></td>
                  <td className="py-3 pr-4"><ScoreBar score={row.score?.t_score ?? null} /></td>
                  <td className="py-3 pr-4"><ScoreBar score={row.score?.s_score ?? null} /></td>
                  <td className="py-3 pr-4">
                    {row.score ? (
                      <div className="flex items-center gap-1.5">
                        <span className={cn('font-semibold tabular-nums', scoreColour(row.score.composite))}>
                          {row.score.composite.toFixed(2)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {row.score.pillars_passed}/3
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">{keyIndicator(row.indicators)}</td>
                  <td className="py-3 pr-4">
                    <span className={cn('flex items-center gap-1 text-xs font-medium tabular-nums', trendColour)}>
                      <TrendIcon size={12} />
                      {trend != null ? formatPercent(trend) : '—'}
                    </span>
                  </td>
                  <td className="py-3"><SignalBadge signal={row.active_signal} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

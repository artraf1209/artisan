import type { Strategy } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { Target, Clock, ShieldCheck } from 'lucide-react'

const RISK_COLOURS = {
  conservative: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  moderate: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  aggressive: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
}

const RISK_LABELS = {
  conservative: 'Conservative',
  moderate: 'Moderate',
  aggressive: 'Aggressive',
}

function daysRemaining(createdAt: string, goalMonths: number): number {
  const start = new Date(createdAt)
  const end = new Date(start)
  end.setMonth(end.getMonth() + goalMonths)
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000))
}

export default function GoalPanel({
  strategy,
  currentEquity,
}: {
  strategy: Strategy
  currentEquity: number | null
}) {
  const growthPct = strategy.goal_growth_pct ?? 25
  const months = strategy.goal_months ?? 12
  const riskLevel = strategy.risk_level ?? 'moderate'
  const startEquity = strategy.start_equity ?? null
  const targetEquity = startEquity ? startEquity * (1 + growthPct / 100) : null
  const days = daysRemaining(strategy.created_at, months)

  let progressPct = 0
  let pnlValue: number | null = null
  let pnlPct: number | null = null

  if (startEquity && currentEquity && targetEquity) {
    progressPct = Math.max(0, Math.min(100, ((currentEquity - startEquity) / (targetEquity - startEquity)) * 100))
    pnlValue = currentEquity - startEquity
    pnlPct = (pnlValue / startEquity) * 100
  }

  const riskColour = RISK_COLOURS[riskLevel] ?? RISK_COLOURS.moderate
  const riskLabel = RISK_LABELS[riskLevel] ?? 'Moderate'

  return (
    <div className="surface-panel p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/60">
            <Target size={18} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Strategy Goal</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{strategy.name}</p>
          </div>
        </div>

        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${riskColour}`}>
          <ShieldCheck size={12} />
          {riskLabel} risk
        </span>
      </div>

      {/* Target row */}
      <div className="mb-5 flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-muted-foreground">Target growth</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">+{growthPct}%</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Horizon</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{months}mo</p>
        </div>
        {targetEquity && (
          <div>
            <p className="text-xs text-muted-foreground">Target equity</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {formatCurrency(targetEquity)}
            </p>
          </div>
        )}
        {currentEquity != null && (
          <div>
            <p className="text-xs text-muted-foreground">Current equity</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {formatCurrency(currentEquity)}
            </p>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {startEquity ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatCurrency(startEquity)} start</span>
            <span className={pnlValue != null ? (pnlValue >= 0 ? 'text-profit' : 'text-loss') : ''}>
              {pnlValue != null
                ? `${pnlValue >= 0 ? '+' : ''}${formatCurrency(pnlValue)} (${pnlPct != null ? (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%' : '—'})`
                : '—'}
            </span>
            <span>{formatCurrency(targetEquity)} target</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-border/40">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progressPct.toFixed(1)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{progressPct.toFixed(1)}% of target reached</span>
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {days} days remaining
            </span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-background/30 px-4 py-3 text-sm text-muted-foreground">
          Baseline equity not set — run the first ingestion and set <code className="text-xs">start_equity</code> on the strategy to track progress.
        </div>
      )}
    </div>
  )
}

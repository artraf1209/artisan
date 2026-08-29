import StatusBadge from '@/components/shared/StatusBadge'
import RealtimeRefresher from '@/components/shared/RealtimeRefresher'
import ClosePositionDialog from '@/components/positions/ClosePositionDialog'
import { createServerClient } from '@/lib/supabase/server'
import { loadOpenPositions, type PositionOverview } from '@/lib/positions'
import { formatCurrency, formatPercent } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function PositionsPage() {
  const supabase = await createServerClient()
  const positions = await loadOpenPositions(supabase as any)
  const sortedPositions = [...positions].sort((left, right) => {
    if (left.needs_attention !== right.needs_attention) {
      return Number(right.needs_attention) - Number(left.needs_attention)
    }
    return right.days_held - left.days_held
  })

  const totalUnrealized = positions.reduce((sum, position) => sum + (position.unrealized_pnl ?? 0), 0)
  const attentionCount = positions.filter((position) => position.needs_attention).length

  return (
    <>
      <section className="grid gap-3 lg:grid-cols-3">
        <SummaryCard
          label="Open positions"
          value={String(positions.length)}
          detail="Current live holdings from portfolio_positions."
        />
        <SummaryCard
          label="Total unrealized"
          value={formatCurrency(totalUnrealized)}
          detail="Marked-to-market P/L across all open positions."
        />
        <SummaryCard
          label="Needs attention"
          value={String(attentionCount)}
          detail="Near the 30-day ceiling or carrying a CLOSE/TRIM verdict."
        />
      </section>

      {sortedPositions.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No open positions.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Approved and filled v2 entries will appear here after `execute-trade` syncs the live position state.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedPositions.map((position) => (
            <PositionCard key={position.id} position={position} />
          ))}
        </div>
      )}
      <RealtimeRefresher tables={['portfolio_positions', 'trade_executions']} />
    </>
  )
}

function PositionCard({ position }: { position: PositionOverview }) {
  const reviewAction = position.latest_review?.recommended_action?.toLowerCase() ?? null
  const showAttention = position.needs_attention
  const horizonPct =
    position.effective_horizon_days && position.effective_horizon_days > 0
      ? Math.min(100, Math.max(0, (position.days_held / position.effective_horizon_days) * 100))
      : null
  const ceilingPct = Math.min(
    100,
    Math.max(0, (position.days_held / position.max_holding_period_days) * 100),
  )
  const horizonMarker =
    position.effective_horizon_days != null
      ? Math.min(
          100,
          Math.max(0, (position.effective_horizon_days / position.max_holding_period_days) * 100),
        )
      : null

  return (
    <article
      className={`rounded-[1.5rem] border p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)] ${
        showAttention
          ? 'border-loss/35 bg-loss/8'
          : 'border-border bg-card/95'
      }`}
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
              {position.symbol}
            </h2>
            {position.latest_review ? (
              <StatusBadge status={position.latest_review.recommended_action} />
            ) : null}
            {position.trailing_stop_active ? <InlineBadge label="Trailing stop active" /> : null}
            {position.near_day_30 ? (
              <InlineBadge label={`${position.days_remaining_ceiling}d to ceiling`} tone="alert" />
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {position.quantity} shares @ {formatCurrency(position.avg_entry_price)} · opened{' '}
            {new Date(position.opened_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
          <details className="rounded-2xl border border-border bg-background/35 p-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              Original thesis
            </summary>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {position.original_recommendation?.thesis ?? 'No linked recommendation thesis found.'}
            </p>
          </details>
        </div>

        <div className="flex flex-col items-start gap-3 sm:min-w-[28rem] xl:items-end">
          <ClosePositionDialog
            positionId={position.id}
            symbol={position.symbol}
            quantity={position.quantity}
            currentPrice={position.current_price}
            hasRestingOrders={position.has_resting_orders}
          />
          <div className="grid min-w-full grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Current" value={formatCurrency(position.current_price)} />
            <Metric label="P/L $" value={formatCurrency(position.unrealized_pnl)} />
            <Metric label="P/L %" value={formatPercent(position.unrealized_pnl_pct)} />
            <Metric label="R multiple" value={position.r_multiple == null ? '—' : `${position.r_multiple.toFixed(2)}R`} />
            <Metric label="Stop" value={formatCurrency(position.stop_price)} />
            <Metric label="Target" value={formatCurrency(position.target_price)} />
            <Metric label="To stop" value={formatDistance(position.distance_to_stop_dollars, position.distance_to_stop_pct)} />
            <Metric label="To target" value={formatDistance(position.distance_to_target_dollars, position.distance_to_target_pct)} />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <div className="rounded-[1.25rem] border border-border bg-background/40 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Holding-period progress</p>
              <p className="text-sm text-muted-foreground">
                {position.days_held}d held ·{' '}
                {position.days_remaining_horizon == null
                  ? 'no explicit horizon'
                  : `${position.days_remaining_horizon}d vs horizon`}
                {' '}· {position.days_remaining_ceiling}d vs 30-day ceiling
              </p>
            </div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {position.original_recommendation?.setup_type ?? 'setup unavailable'}
            </p>
          </div>

          <div className="mt-4">
            <div className="relative h-3 overflow-hidden rounded-full bg-background/80">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary/25"
                style={{ width: `${ceilingPct}%` }}
              />
              {horizonPct != null ? (
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-profit/35"
                  style={{ width: `${horizonPct}%` }}
                />
              ) : null}
              {horizonMarker != null ? (
                <div
                  className="absolute inset-y-0 w-px bg-profit"
                  style={{ left: `${horizonMarker}%` }}
                />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <span>Held {position.days_held}d</span>
              <span>
                Horizon {position.effective_horizon_days == null ? '—' : `${position.effective_horizon_days}d`}
              </span>
              <span>Ceiling {position.max_holding_period_days}d</span>
            </div>
          </div>
        </div>

        <div className="rounded-[1.25rem] border border-border bg-background/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Latest review</p>
              <p className="text-sm text-muted-foreground">
                {position.latest_review
                  ? new Date(position.latest_review.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'No position review recorded yet.'}
              </p>
            </div>
            {position.latest_review ? (
              <StatusBadge status={position.latest_review.recommended_action} />
            ) : null}
          </div>

          {position.latest_review?.reasoning ? (
            <details className="mt-4 rounded-2xl border border-border bg-card/60 p-4">
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                Review reasoning
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {position.latest_review.reasoning}
              </p>
            </details>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              {reviewAction ? 'No review reasoning stored.' : 'Waiting for the first position review.'}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <article className="rounded-[1.5rem] border border-border bg-card/90 p-4 shadow-[0_16px_35px_rgba(0,0,0,0.22)]">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </article>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/50 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function InlineBadge({
  label,
  tone = 'default',
}: {
  label: string
  tone?: 'default' | 'alert'
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.16em] ${
        tone === 'alert'
          ? 'border-loss/25 bg-loss/12 text-loss'
          : 'border-border bg-background/70 text-muted-foreground'
      }`}
    >
      {label}
    </span>
  )
}

function formatDistance(dollars: number | null, pct: number | null) {
  if (dollars == null || pct == null) {
    return '—'
  }

  return `${formatCurrency(dollars)} · ${formatPercent(pct)}`
}

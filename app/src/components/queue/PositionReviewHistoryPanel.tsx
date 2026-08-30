import StatusBadge from '@/components/shared/StatusBadge'
import type { PositionReviewHistoryRow } from '@/lib/position-review-history'
import { formatCurrency, formatDate } from '@/lib/utils'

/** Every position review the pipeline has produced, most recent first --
 * including risk-reducing actions that were auto-applied upstream and never
 * passed through the approval queue above it. There's no edit affordance on
 * position-review approval today, so unlike RecommendationHistoryPanel there's
 * no override delta to show -- new_stop_price/new_target_price are simply
 * what the review itself recommended. */
export default function PositionReviewHistoryPanel({ rows }: { rows: PositionReviewHistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No position review history yet.</p>
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-2xl border border-border bg-card/60 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{row.symbol}</span>
              <StatusBadge status={row.recommended_action} />
              <StatusBadge status={row.status} />
            </div>
            <span className="text-xs text-muted-foreground">
              {row.status === 'pending' ? 'Given' : row.status} {formatDate(row.reviewed_at ?? row.created_at)}
            </span>
          </div>

          {row.reasoning ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{row.reasoning}</p> : null}

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {row.new_stop_price != null ? <span>New stop {formatCurrency(row.new_stop_price)}</span> : null}
            {row.new_target_price != null ? <span>New target {formatCurrency(row.new_target_price)}</span> : null}
            {row.trim_shares != null ? <span>Trim {row.trim_shares} sh</span> : null}
          </div>

          {row.review_note ? (
            <p className="mt-2 text-xs italic leading-5 text-muted-foreground">Note: {row.review_note}</p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

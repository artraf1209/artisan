import StatusBadge from '@/components/shared/StatusBadge'
import type { RecommendationHistoryRow } from '@/lib/recommendation-history'
import { formatCurrency, formatDate } from '@/lib/utils'

/** Every recommendation the pipeline has produced, most recent first -- not
 * just the pending queue above it. Reused nowhere else, unlike OrderHistoryPanel,
 * since this is the one place a recommendation's full lifecycle (including
 * approval-time edits) needs to be visible end to end. */
export default function RecommendationHistoryPanel({ rows }: { rows: RecommendationHistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No recommendation history yet.</p>
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-2xl border border-border bg-card/60 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{row.symbol}</span>
              <StatusBadge status={row.action} />
              <StatusBadge status={row.status} />
              {row.conviction ? (
                <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  {row.conviction} conviction
                </span>
              ) : null}
            </div>
            <span className="text-xs text-muted-foreground">
              {row.status === 'pending' ? 'Given' : row.status} {formatDate(row.reviewed_at ?? row.created_at)}
            </span>
          </div>

          {row.thesis ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{row.thesis}</p> : null}

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Entry {formatCurrency(row.entry_price)}</span>
            <span>Stop {formatCurrency(row.stop_price)}</span>
            <span>Target {formatCurrency(row.target_price)}</span>
            {row.shares != null ? <span>{row.shares} sh</span> : null}
          </div>

          {row.override_deltas.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {row.override_deltas.map((delta) => (
                <span
                  key={delta}
                  className="inline-flex items-center rounded-full border border-border bg-background/70 px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-foreground"
                >
                  edited {delta}
                </span>
              ))}
            </div>
          ) : null}

          {row.review_note ? (
            <p className="mt-2 text-xs italic leading-5 text-muted-foreground">Note: {row.review_note}</p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

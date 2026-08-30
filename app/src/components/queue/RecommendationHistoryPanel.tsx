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

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Entry" value={formatCurrency(row.entry_price)} />
            <Metric label="Stop" value={formatCurrency(row.stop_price)} />
            <Metric label="Target" value={formatCurrency(row.target_price)} />
            <Metric label="Shares" value={row.shares != null ? `${row.shares} sh` : 'N/A'} />
          </div>

          {row.thesis ? (
            <div className="mt-3 rounded-2xl border border-border bg-background/35 p-4">
              <p className="text-sm leading-6 text-muted-foreground">{row.thesis}</p>
            </div>
          ) : null}

          {row.override_deltas.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
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
            <p className="mt-3 text-xs italic leading-5 text-muted-foreground">Note: {row.review_note}</p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/50 p-2.5">
      <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

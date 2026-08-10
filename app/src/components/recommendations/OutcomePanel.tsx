import StatusBadge from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { RecommendationDetail } from '@/lib/recommendation-detail'

function humanize(value: string | null | undefined) {
  return (value ?? 'still_open').replaceAll('_', ' ')
}

export default function OutcomePanel({ detail }: { detail: RecommendationDetail }) {
  const { decisionOutcome } = detail

  return (
    <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <h3 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Outcome</h3>

      {!decisionOutcome ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No decision outcome has been tracked for this recommendation yet — it either hasn&apos;t been decided on,
          or the nightly outcome-tracking job hasn&apos;t run since it was.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={humanize(decisionOutcome.resolution)} />
            <StatusBadge status={decisionOutcome.mode ?? 'shadow'} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="R multiple"
              value={decisionOutcome.r_multiple != null ? `${decisionOutcome.r_multiple.toFixed(2)}R` : 'N/A'}
            />
            <Metric
              label="Days to resolution"
              value={decisionOutcome.days_to_resolution != null ? `${decisionOutcome.days_to_resolution}d` : 'N/A'}
            />
            <Metric label="Reference entry" value={formatCurrency(decisionOutcome.entry_price_reference)} />
            <Metric
              label="Resolved"
              value={decisionOutcome.resolved_at ? formatDate(decisionOutcome.resolved_at) : 'Still open'}
            />
          </div>
        </>
      )}
    </section>
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

import type { QueueSignal, ThesisAnalysis } from '@/types/hybrid'
import { formatCurrency, formatDate } from '@/lib/utils'
import StatusBadge from '@/components/shared/StatusBadge'

export default function ThesisNote({
  signal,
  thesis,
}: {
  signal: QueueSignal
  thesis: ThesisAnalysis | null
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-foreground">{signal.symbol}</h1>
            <StatusBadge status={signal.status} />
            <StatusBadge status={signal.direction} />
          </div>
          <p className="text-sm text-muted-foreground">Signal created {formatDate(signal.created_at)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm md:min-w-80">
          <Metric label="Composite" value={signal.composite_score.toFixed(3)} />
          <Metric label="Pillars" value={String(signal.pillars_passed)} />
          <Metric label="Stop" value={formatCurrency(signal.stop_price)} />
          <Metric label="Target" value={formatCurrency(signal.target_price)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Metric label="Fundamental" value={signal.f_score.toFixed(3)} />
        <Metric label="Technical" value={signal.t_score.toFixed(3)} />
        <Metric label="Sentiment" value={signal.s_score.toFixed(3)} />
      </div>

      {thesis ? (
        <div className="rounded-lg border border-border bg-muted/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Thesis Note</p>
            <p className="text-xs text-muted-foreground">
              {thesis.model} · {formatDate(thesis.created_at)}
            </p>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground">{thesis.content}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
          No thesis note has been generated for this signal yet.
        </div>
      )}

      {signal.review_note ? (
        <div className="rounded-lg border border-border bg-background/60 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Review Note</p>
          <p className="mt-2 text-sm leading-6 text-foreground whitespace-pre-wrap">{signal.review_note}</p>
        </div>
      ) : null}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

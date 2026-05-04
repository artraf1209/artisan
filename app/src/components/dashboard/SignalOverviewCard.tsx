import Link from 'next/link'
import type { Signal } from '@/types'

export default function SignalOverviewCard({
  signals,
  pendingApprovals,
}: {
  signals: Signal[]
  pendingApprovals: number
}) {
  const strongest = [...signals].sort((left, right) => right.confidence - left.confidence)[0]

  return (
    <div className="surface-panel col-span-1 p-6">
      <div className="mb-8 flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Signals</p>
          <p className="text-sm text-muted-foreground">Queue and confidence</p>
        </div>
        <Link
          href="/trades/queue"
          className="rounded-full border border-border/70 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          Open queue
        </Link>
      </div>

      <div className="space-y-6">
        <div>
          <p className="metric-value text-foreground">{pendingApprovals}</p>
          <p className="mt-2 text-sm text-muted-foreground">pending approvals</p>
        </div>

        {strongest ? (
          <div className="surface-soft p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Strongest recent signal
            </p>
            <div className="mt-3 flex items-end justify-between gap-4">
              <div>
                <p className="text-2xl font-semibold tracking-[-0.05em] text-foreground">
                  {strongest.symbol}
                </p>
                <p className="text-sm text-muted-foreground">{strongest.model}</p>
              </div>
              <p className="text-3xl font-semibold tracking-[-0.06em] text-foreground">
                {(strongest.confidence * 100).toFixed(0)}%
              </p>
            </div>
          </div>
        ) : (
          <div className="surface-soft p-4 text-sm text-muted-foreground">
            No recent legacy engine signals yet.
          </div>
        )}
      </div>
    </div>
  )
}

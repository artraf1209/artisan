import type { Signal } from '@/types'
import { formatDate } from '@/lib/utils'
import StatusBadge from '@/components/shared/StatusBadge'

export default function SignalFeed({ signals }: { signals: Signal[] }) {
  return (
    <div className="surface-panel divide-y divide-border/70 overflow-hidden">
      {signals.length === 0 && (
        <p className="px-5 py-6 text-sm text-muted-foreground">No signals generated yet.</p>
      )}
      {signals.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-4 px-5 py-5">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-medium tracking-[-0.03em] text-foreground">{s.symbol}</span>
              <StatusBadge status={s.direction} />
              {s.executed && (
                <StatusBadge status="executed" />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {s.model} · {formatDate(s.created_at)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tracking-[-0.05em] text-foreground">
              {(s.confidence * 100).toFixed(0)}%
            </p>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">confidence</p>
          </div>
        </div>
      ))}
    </div>
  )
}

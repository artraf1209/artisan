import type { Signal } from '@/types'
import { formatDate } from '@/lib/utils'
import StatusBadge from '@/components/shared/StatusBadge'

export default function SignalFeed({ signals }: { signals: Signal[] }) {
  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {signals.length === 0 && (
        <p className="px-5 py-6 text-sm text-muted-foreground">No signals generated yet.</p>
      )}
      {signals.map((s) => (
        <div key={s.id} className="px-5 py-4 flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{s.symbol}</span>
              <StatusBadge status={s.direction} />
              {s.executed && (
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">executed</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {s.model} · {formatDate(s.created_at)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-foreground">
              {(s.confidence * 100).toFixed(0)}%
            </p>
            <p className="text-xs text-muted-foreground">confidence</p>
          </div>
        </div>
      ))}
    </div>
  )
}

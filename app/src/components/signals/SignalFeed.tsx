import type { Signal } from '@/types'
import type { ThesisAnalysis } from '@/types/hybrid'
import { formatDate } from '@/lib/utils'
import StatusBadge from '@/components/shared/StatusBadge'

export type SignalFeedItem =
  | Signal
  | {
      id: string
      symbol: string
      direction: 'long' | 'flat'
      confidence: number
      model: string
      created_at: string
      status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired'
      thesis: ThesisAnalysis | null
    }

function isHybridSignal(signal: SignalFeedItem): signal is Extract<SignalFeedItem, { status: string }> {
  return 'status' in signal
}

function formatSignalStatus(status: Extract<SignalFeedItem, { status: string }>['status']) {
  if (status === 'pending') return 'in queue'
  return status
}

export default function SignalFeed({ signals }: { signals: SignalFeedItem[] }) {
  return (
    <div className="space-y-4">
      {signals.length === 0 && (
        <div className="surface-panel px-5 py-6 text-sm text-muted-foreground">
          No signals generated yet.
        </div>
      )}

      {signals.map((signal) => {
        const hybrid = isHybridSignal(signal)
        const thesis = hybrid ? signal.thesis : null

        return (
          <article key={signal.id} className="surface-panel p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-medium tracking-[-0.03em] text-foreground">
                    {signal.symbol}
                  </span>
                  <StatusBadge status={signal.direction} />
                  {hybrid ? (
                    <StatusBadge status={formatSignalStatus(signal.status)} />
                  ) : signal.executed ? (
                    <StatusBadge status="executed" />
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {signal.model} · {formatDate(signal.created_at)}
                </p>
              </div>

              <div className="text-left md:text-right">
                <p className="text-3xl font-semibold tracking-[-0.05em] text-foreground">
                  {(signal.confidence * 100).toFixed(0)}%
                </p>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  confidence
                </p>
              </div>
            </div>

            {hybrid ? (
              <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Narrative
                  </p>
                  {thesis ? (
                    <p className="text-xs text-muted-foreground">
                      {thesis.model} · {formatDate(thesis.created_at)}
                    </p>
                  ) : null}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground">
                  {thesis?.content ?? 'No thesis note has been generated for this signal yet.'}
                </p>
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

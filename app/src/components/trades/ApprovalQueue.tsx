import type { QueueSignal } from '@/types/hybrid'
import SignalApprovalCard from '@/components/trades/SignalApprovalCard'

export default function ApprovalQueue({ signals }: { signals: QueueSignal[] }) {
  if (signals.length === 0) {
    return (
      <div className="surface-panel p-10 text-center">
        <p className="text-base font-medium text-foreground">No pending approvals.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          New hybrid-engine signals will appear here when they pass scoring and veto checks.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {signals.map((signal) => (
        <SignalApprovalCard key={signal.id} signal={signal} />
      ))}
    </div>
  )
}

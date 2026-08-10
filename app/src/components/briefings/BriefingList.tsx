import type { BriefingRecord } from '@/lib/briefings'
import BriefingCard from '@/components/briefings/BriefingCard'

export default function BriefingList({ briefings }: { briefings: BriefingRecord[] }) {
  if (briefings.length === 0) {
    return (
      <div className="surface-panel p-10 text-center">
        <p className="text-base font-medium text-foreground">No briefings yet.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The daily summary written by the v2 briefing agent will appear here after a completed pipeline run.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {briefings.map((briefing) => (
        <BriefingCard key={briefing.id} briefing={briefing} />
      ))}
    </div>
  )
}

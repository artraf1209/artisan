import type { BriefingAnalysis } from '@/types/hybrid'
import { formatDate } from '@/lib/utils'

export default function BriefingCard({ briefing }: { briefing: BriefingAnalysis }) {
  return (
    <article className="surface-panel p-5 space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-[-0.04em] text-foreground">
          {formatDate(briefing.created_at)}
        </h2>
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{briefing.model}</p>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{briefing.content}</p>
    </article>
  )
}

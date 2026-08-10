import type { RecommendationDetail } from '@/lib/recommendation-detail'

export default function SynthesisCard({ detail }: { detail: RecommendationDetail }) {
  const { synthesis } = detail

  return (
    <article className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <h3 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Synthesis</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        What the synthesis agent weighed across all three analysts before writing this recommendation.
      </p>

      {synthesis ? (
        <>
          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Invalidation conditions</p>
            {synthesis.invalidation_conditions.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {synthesis.invalidation_conditions.map((condition) => (
                  <li key={condition} className="text-sm leading-6 text-foreground/85">
                    · {condition}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No invalidation conditions were listed.</p>
            )}
          </div>

          {synthesis.redundancy_note ? (
            <div className="mt-4 rounded-2xl border border-border bg-background/40 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Redundancy note</p>
              <p className="mt-2 text-sm leading-6 text-foreground/85">{synthesis.redundancy_note}</p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No matching synthesis output was found for this run — the run-level synthesis record may have been pruned
          or this recommendation predates per-symbol synthesis tracking.
        </p>
      )}
    </article>
  )
}

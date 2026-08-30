import PositionActionCard from '@/components/queue/PositionActionCard'
import PositionReviewHistoryPanel from '@/components/queue/PositionReviewHistoryPanel'
import { createServerClient } from '@/lib/supabase/server'
import { loadPositionReviewHistory } from '@/lib/position-review-history'
import type {
  OriginalRecommendationSummary,
  PositionActionQueueItem,
  PositionSummary,
} from '@/lib/queue'

export const dynamic = 'force-dynamic'

export default async function PositionActionsPage() {
  const supabase = (await createServerClient()) as any
  const {
    data: latestRun,
    error: latestRunError,
  } = await supabase
    .from('pipeline_runs')
    .select('id, run_date, status, market_regime, started_at')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: positionReviewData, error: positionReviewError } = latestRun?.id
    ? await supabase
        .from('position_reviews')
        .select(
          'id, position_id, symbol, recommended_action, reasoning, historical_precedent, new_stop_price, new_target_price, review_note, status, created_at',
        )
        .eq('run_id', latestRun.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
    : { data: [], error: null }

  const positionIds = ((positionReviewData ?? []) as Array<{ position_id: string }>).map(
    (review) => review.position_id,
  )

  const { data: positionsData } =
    positionIds.length > 0
      ? await supabase
          .from('portfolio_positions')
          .select('id, symbol, quantity, avg_entry_price, stop_price, target_price, signal_id, opened_at')
          .in('id', positionIds)
      : { data: [] }

  const positions = (positionsData ?? []) as PositionSummary[]
  const recommendationIds = positions
    .map((position) => position.signal_id)
    .filter((value): value is string => Boolean(value))

  const { data: linkedRecommendationsData } =
    recommendationIds.length > 0
      ? await supabase
          .from('recommendations')
          .select(
            'id, thesis, entry_price, stop_price, target_price, strategy_id, effective_horizon_days, setup_type, regime',
          )
          .in('id', recommendationIds)
      : { data: [] }

  const linkedRecommendations = (linkedRecommendationsData ?? []) as OriginalRecommendationSummary[]
  const positionsById = new Map(positions.map((position) => [position.id, position]))
  const recommendationsById = new Map(
    linkedRecommendations.map((recommendation) => [recommendation.id, recommendation]),
  )

  const positionReviewItems = ((positionReviewData ?? []) as PositionActionQueueItem[]).map((row) => {
    const position = positionsById.get(row.position_id) ?? null
    const originalRecommendation = position?.signal_id
      ? recommendationsById.get(position.signal_id) ?? null
      : null

    return {
      ...row,
      new_stop_price: row.new_stop_price == null ? null : Number(row.new_stop_price),
      new_target_price: row.new_target_price == null ? null : Number(row.new_target_price),
      position,
      original_recommendation: originalRecommendation,
    }
  })

  const history = await loadPositionReviewHistory(supabase, { limit: 50 })

  return (
    <>
      {latestRunError ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {latestRunError.message}
        </p>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-2">
        <SummaryCard
          label="Latest run"
          value={latestRun ? formatRunDate(latestRun.run_date) : 'No run yet'}
          detail={latestRun ? `Regime: ${latestRun.market_regime ?? 'unknown'}` : 'Nightly pipeline has not created a v2 run yet.'}
        />
        <SummaryCard
          label="Position actions"
          value={String(positionReviewItems.length)}
          detail="Pending ADD or management changes still waiting in the queue."
        />
      </section>

      {positionReviewError ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {positionReviewError.message}
        </p>
      ) : null}

      {positionReviewItems.length === 0 ? (
        <EmptyState
          title="No pending position actions."
          description="Risk-reducing position reviews are auto-applied upstream, so only the remaining approval-required actions stay here."
        />
      ) : (
        <div className="space-y-4">
          {positionReviewItems.map((review) => (
            <PositionActionCard key={review.id} review={review} />
          ))}
        </div>
      )}

      <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">History</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Every position review the pipeline has produced, most recent {history.length} shown -- including
            risk-reducing actions that were auto-applied upstream and never needed your approval.
          </p>
        </div>
        <PositionReviewHistoryPanel rows={history} />
      </section>
    </>
  )
}

function formatRunDate(value: string | null) {
  if (!value) {
    return 'No run date'
  }

  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <article className="rounded-[1.5rem] border border-border bg-card/90 p-4 shadow-[0_16px_35px_rgba(0,0,0,0.22)]">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </article>
  )
}

function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  )
}

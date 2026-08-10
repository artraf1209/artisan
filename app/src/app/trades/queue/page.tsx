import { ClipboardCheck, FileText, Settings } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import RecommendationCard from '@/components/queue/RecommendationCard'
import PositionActionCard from '@/components/queue/PositionActionCard'
import { createServerClient } from '@/lib/supabase/server'
import type {
  OriginalRecommendationSummary,
  PositionActionQueueItem,
  PositionSummary,
  RecommendationQueueItem,
} from '@/lib/queue'

export const dynamic = 'force-dynamic'

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

export default async function TradeQueuePage() {
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

  const [
    recommendationResult,
    positionReviewResult,
  ] = latestRun?.id
    ? await Promise.all([
        supabase
          .from('recommendations')
          .select(
            'id, run_id, strategy_id, symbol, action, conviction, thesis, entry_price, stop_price, target_price, atr_at_signal, effective_horizon_days, historical_precedent, shares, dollar_risk, status, created_at',
          )
          .eq('run_id', latestRun.id)
          .eq('status', 'pending')
          .eq('action', 'enter')
          .order('created_at', { ascending: false }),
        supabase
          .from('position_reviews')
          .select(
            'id, position_id, symbol, recommended_action, reasoning, historical_precedent, new_stop_price, new_target_price, review_note, status, created_at',
          )
          .eq('run_id', latestRun.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]

  const positionIds = ((positionReviewResult.data ?? []) as Array<{ position_id: string }>).map(
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

  const recommendationItems = ((recommendationResult.data ?? []) as RecommendationQueueItem[]).map(
    (row) => ({
      ...row,
      entry_price: row.entry_price == null ? null : Number(row.entry_price),
      stop_price: row.stop_price == null ? null : Number(row.stop_price),
      target_price: row.target_price == null ? null : Number(row.target_price),
      atr_at_signal: row.atr_at_signal == null ? null : Number(row.atr_at_signal),
      shares: row.shares == null ? null : Number(row.shares),
      dollar_risk: row.dollar_risk == null ? null : Number(row.dollar_risk),
    }),
  )

  const positionReviewItems = ((positionReviewResult.data ?? []) as PositionActionQueueItem[]).map(
    (row) => {
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
    },
  )

  return (
    <PageShell
      eyebrow="Human decision lane"
      title="Queue"
      subtitle="Review new ENTER recommendations and position-management actions from the latest v2 pipeline run before they hit the broker."
      actions={[
        { href: '/briefings', label: 'Briefings', icon: FileText },
        { href: '/settings', label: 'Settings', icon: Settings },
      ]}
    >
      {latestRunError ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {latestRunError.message}
        </p>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-3">
        <SummaryCard
          label="Latest run"
          value={latestRun ? formatRunDate(latestRun.run_date) : 'No run yet'}
          detail={latestRun ? `Regime: ${latestRun.market_regime ?? 'unknown'}` : 'Nightly pipeline has not created a v2 run yet.'}
        />
        <SummaryCard
          label="New recommendations"
          value={String(recommendationItems.length)}
          detail="Pending ENTER ideas awaiting a human decision."
        />
        <SummaryCard
          label="Position actions"
          value={String(positionReviewItems.length)}
          detail="Pending ADD or management changes still waiting in the queue."
        />
      </section>

      {recommendationResult.error ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {recommendationResult.error.message}
        </p>
      ) : null}

      {positionReviewResult.error ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {positionReviewResult.error.message}
        </p>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-foreground">
            <ClipboardCheck size={20} />
          </span>
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
              New Recommendations
            </h2>
            <p className="text-sm text-muted-foreground">
              New entry ideas from the latest pipeline run, ready for approve, edit, or reject.
            </p>
          </div>
        </div>

        {recommendationItems.length === 0 ? (
          <EmptyState
            title="No pending entry recommendations."
            description="When the latest v2 run produces actionable ENTER ideas, they’ll appear here for approval."
          />
        ) : (
          <div className="space-y-4">
            {recommendationItems.map((recommendation) => (
              <RecommendationCard key={recommendation.id} recommendation={recommendation} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
            Position Actions
          </h2>
          <p className="text-sm text-muted-foreground">
            Pending actions on existing positions that still require a human decision.
          </p>
        </div>

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
      </section>
    </PageShell>
  )
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

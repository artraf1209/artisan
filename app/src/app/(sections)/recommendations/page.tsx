import RecommendationCard from '@/components/queue/RecommendationCard'
import RecommendationHistoryPanel from '@/components/queue/RecommendationHistoryPanel'
import { createServerClient } from '@/lib/supabase/server'
import { loadRecommendationHistory } from '@/lib/recommendation-history'
import type { RecommendationQueueItem } from '@/lib/queue'

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

export default async function NewRecommendationsPage() {
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

  const { data: recommendationData, error: recommendationError } = latestRun?.id
    ? await supabase
        .from('recommendations')
        .select(
          'id, run_id, strategy_id, symbol, action, conviction, thesis, entry_price, stop_price, target_price, atr_at_signal, effective_horizon_days, historical_precedent, shares, dollar_risk, status, created_at',
        )
        .eq('run_id', latestRun.id)
        .eq('status', 'pending')
        .eq('action', 'enter')
        .order('created_at', { ascending: false })
    : { data: [], error: null }

  const recommendationItems = ((recommendationData ?? []) as RecommendationQueueItem[]).map((row) => ({
    ...row,
    entry_price: row.entry_price == null ? null : Number(row.entry_price),
    stop_price: row.stop_price == null ? null : Number(row.stop_price),
    target_price: row.target_price == null ? null : Number(row.target_price),
    atr_at_signal: row.atr_at_signal == null ? null : Number(row.atr_at_signal),
    shares: row.shares == null ? null : Number(row.shares),
    dollar_risk: row.dollar_risk == null ? null : Number(row.dollar_risk),
  }))

  const history = await loadRecommendationHistory(supabase, { limit: 50 })

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
          label="New recommendations"
          value={String(recommendationItems.length)}
          detail="Pending ENTER ideas awaiting a human decision."
        />
      </section>

      {recommendationError ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {recommendationError.message}
        </p>
      ) : null}

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

      <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">History</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Every recommendation the pipeline has produced, most recent {history.length} shown -- what was
            recommended, what happened to it, and any edits made before it was sent to the broker.
          </p>
        </div>
        <RecommendationHistoryPanel rows={history} />
      </section>
    </>
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

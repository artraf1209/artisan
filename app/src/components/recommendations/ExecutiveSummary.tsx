import StatusBadge from '@/components/shared/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  bucketFundamental,
  bucketSentiment,
  bucketTechnical,
  hasCrossPillarDisagreement,
  type RecommendationDetail,
} from '@/lib/recommendation-detail'

export default function ExecutiveSummary({ detail }: { detail: RecommendationDetail }) {
  const { recommendation, fundamental, technical, sentiment } = detail

  const disagreement = hasCrossPillarDisagreement([
    bucketFundamental(fundamental?.output.quality_assessment),
    bucketTechnical(technical?.output.setup_quality),
    bucketSentiment(sentiment?.output.sentiment_direction),
  ])

  return (
    <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">{recommendation.symbol}</h2>
        <StatusBadge status={recommendation.action} />
        {recommendation.conviction ? <StatusBadge status={recommendation.conviction} /> : null}
        <StatusBadge status={recommendation.status} />
        {disagreement ? (
          <span className="inline-flex items-center rounded-full border border-loss/30 bg-loss/10 px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.16em] text-loss">
            Analysts disagree
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-sm leading-6 text-foreground/88">
        {recommendation.thesis ?? 'No thesis provided for this recommendation yet.'}
      </p>

      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {formatDate(recommendation.created_at)} · setup {recommendation.setup_type ?? 'N/A'} · regime{' '}
        {recommendation.regime ?? 'N/A'}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Entry" value={formatCurrency(recommendation.entry_price)} />
        <Metric label="Stop" value={formatCurrency(recommendation.stop_price)} />
        <Metric label="Target" value={formatCurrency(recommendation.target_price)} />
        <Metric label="Shares" value={recommendation.shares != null ? String(recommendation.shares) : 'N/A'} />
        <Metric label="Dollar risk" value={formatCurrency(recommendation.dollar_risk)} />
        <Metric
          label="Horizon"
          value={recommendation.effective_horizon_days ? `${recommendation.effective_horizon_days}d` : 'N/A'}
        />
      </div>

      {disagreement ? (
        <p className="mt-4 rounded-2xl border border-amber-200/25 bg-amber-200/10 px-4 py-3 text-sm text-amber-200">
          The fundamental, technical, and sentiment analysts landed on conflicting reads for this symbol — at least
          one flagged a positive signal while another flagged a negative one. Review all three cards below before
          acting on this recommendation.
        </p>
      ) : null}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/50 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

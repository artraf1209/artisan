import StatusBadge from '@/components/shared/StatusBadge'
import { formatCurrency } from '@/lib/utils'
import { round } from '@/lib/queue'
import type { RecommendationDetail } from '@/lib/recommendation-detail'

const K_STOP = 2.0
const K_TARGET = 3.0

export default function ComputationTrace({ detail }: { detail: RecommendationDetail }) {
  const { recommendation, entrySignal, factorScore, indicatorValues, currentRiskParams } = detail
  const atr = entrySignal?.atr ?? null
  const entryPrice = recommendation.entry_price
  const riskPct = currentRiskParams?.risk_per_trade_pct ?? null
  const maxPositionPct = currentRiskParams?.max_position_pct ?? null

  return (
    <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <h3 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Computation trace</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        The entry gates, stop/target math, and position sizing that produced this recommendation.
      </p>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Entry gates</p>
        {entrySignal ? (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              <GatePill active={entrySignal.gate_market} label="Market" />
              <GatePill active={entrySignal.gate_trend} label="Trend" />
              <GatePill active={Boolean(entrySignal.setup_type)} label="Setup" />
              <GatePill active={entrySignal.gate_confirmed} label="Confirm" />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Setup {entrySignal.setup_type ?? 'N/A'} · R multiple{' '}
              {entrySignal.r_multiple != null ? `${entrySignal.r_multiple.toFixed(2)}R` : 'N/A'} · actionable{' '}
              {entrySignal.actionable ? 'yes' : 'no'}
            </p>
          </>
        ) : (
          <EmptyNote text="No matching entry_signals row was found for this run/strategy/symbol." />
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-background/40 p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Stop / target formula</p>
        <p className="mt-2 text-sm text-foreground">
          stop = entry − {K_STOP.toFixed(1)} × ATR &nbsp;·&nbsp; target = entry + {K_TARGET.toFixed(1)} × ATR
        </p>
        {atr != null && entryPrice != null ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {formatCurrency(entryPrice)} − {K_STOP.toFixed(1)} × {atr.toFixed(2)} = {formatCurrency(round(entryPrice - K_STOP * atr, 2))}{' '}
            (stop) &nbsp;·&nbsp; {formatCurrency(entryPrice)} + {K_TARGET.toFixed(1)} × {atr.toFixed(2)} ={' '}
            {formatCurrency(round(entryPrice + K_TARGET * atr, 2))} (target)
          </p>
        ) : (
          <EmptyNote text="No ATR value on record for this signal — falling back to the engine's flat 5%/10% stop/target." />
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-background/40 p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Position sizing</p>
        <p className="mt-2 text-sm text-foreground">
          shares = min(floor(equity × risk_per_trade_pct ÷ stop_distance), floor(equity × max_position_pct ÷ entry_price))
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Using the strategy&apos;s <em>current</em> config: risk_per_trade_pct{' '}
          {riskPct != null ? `${(riskPct * 100).toFixed(2)}%` : 'N/A'}, max_position_pct{' '}
          {maxPositionPct != null ? `${(maxPositionPct * 100).toFixed(1)}%` : 'N/A'}. Strategy parameters aren&apos;t
          versioned, so this may differ from the config active when this recommendation was generated — the values
          below are what was actually persisted at generation time.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Metric label="Shares (persisted)" value={recommendation.shares != null ? String(recommendation.shares) : 'N/A'} />
          <Metric label="Dollar risk (persisted)" value={formatCurrency(recommendation.dollar_risk)} />
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Factor score</p>
        {factorScore ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-sm text-foreground">
                Rank {factorScore.rank ?? 'N/A'} · sector {factorScore.sector ?? 'Unknown'}
              </p>
              <StatusBadge status={factorScore.hard_filter_pass ? 'approved' : 'rejected'} />
              {factorScore.is_new ? <StatusBadge status="pending" /> : null}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <ScoreWithDelta label="Value" value={factorScore.value_z} prev={factorScore.value_prev} />
              <ScoreWithDelta label="Quality" value={factorScore.quality_z} prev={factorScore.quality_prev} />
              <ScoreWithDelta label="Momentum" value={factorScore.momentum_z} prev={factorScore.momentum_prev} />
              <ScoreWithDelta label="Low vol" value={factorScore.low_vol_z} prev={factorScore.low_vol_prev} />
              <ScoreWithDelta label="Growth" value={factorScore.growth_z} prev={factorScore.growth_prev} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Composite z {factorScore.composite_z != null ? factorScore.composite_z.toFixed(2) : 'N/A'}
            </p>
          </>
        ) : (
          <EmptyNote text="No matching factor_scores row was found for this run/strategy/symbol." />
        )}
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Indicator context (best effort)</p>
        {indicatorValues ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric label="RSI 14" value={indicatorValues.rsi_14?.toFixed(1) ?? 'N/A'} />
              <Metric label="ADX 14" value={indicatorValues.adx_14?.toFixed(1) ?? 'N/A'} />
              <Metric label="MACD hist" value={indicatorValues.macd_hist?.toFixed(3) ?? 'N/A'} />
              <Metric label="SMA 50" value={formatCurrency(indicatorValues.sma_50)} />
              <Metric label="SMA 200" value={formatCurrency(indicatorValues.sma_200)} />
              <Metric label="ATR 14" value={indicatorValues.atr_14?.toFixed(2) ?? 'N/A'} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Closest available reading on or before this recommendation was created — `indicator_values` isn&apos;t
              run-scoped, so this is best-effort context, not a guaranteed as-of-run snapshot.
            </p>
          </>
        ) : (
          <EmptyNote text="No indicator_values row was found for this symbol as of the recommendation date." />
        )}
      </div>
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

function ScoreWithDelta({
  label,
  value,
  prev,
}: {
  label: string
  value: number | null
  prev: number | null
}) {
  const delta = value != null && prev != null ? value - prev : null

  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="font-semibold text-foreground">{value != null ? formatSigned(value) : 'N/A'}</p>
      <p className="text-xs text-muted-foreground">Delta {delta != null ? formatSigned(delta) : 'N/A'}</p>
    </div>
  )
}

function formatSigned(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function GatePill({ active, label }: { active: boolean | null; label: string }) {
  if (active == null) {
    return (
      <span className="rounded-full border border-border bg-accent/50 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label} n/a
      </span>
    )
  }

  return (
    <span
      className={`rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${
        active ? 'border-profit/30 bg-profit/10 text-profit' : 'border-loss/30 bg-loss/10 text-loss'
      }`}
    >
      {label} {active ? 'on' : 'off'}
    </span>
  )
}

function EmptyNote({ text }: { text: string }) {
  return <p className="mt-2 text-sm text-muted-foreground">{text}</p>
}

import SettingsEditor from '@/components/settings/SettingsEditor'
import { loadLatestCompletedRunContext } from '@/lib/latest-completed-run'
import { createServerClient } from '@/lib/supabase/server'
import { buildStrategyGroupDisclosures } from '@/lib/strategy-disclosures'
import {
  buildEffectiveStrategySettings,
  buildSettingsFormValues,
  STRATEGY_SETTINGS_GROUPS,
  type StrategySettingsRow,
} from '@/lib/settings'

export const dynamic = 'force-dynamic'

function formatCurrency(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatPercent(value: number | null, decimals = 2) {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }

  return `${(value * 100).toFixed(decimals)}%`
}

function formatMultiple(value: number | null, decimals = 2) {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }

  return `${value.toFixed(decimals)}x`
}

export default async function StrategyConfigPage() {
  const supabase = (await createServerClient()) as any

  const [{ data: strategy, error: strategyError }, latestRunContext, { data: latestSnapshot }] =
    await Promise.all([
      supabase
        .from('strategies')
        .select(
          'id, name, active, risk_params, screening_params, timing_params, position_mgmt_params, performance_goals',
        )
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadLatestCompletedRunContext(supabase),
      supabase
        .from('portfolio_snapshots')
        .select('equity, drawdown_from_high_pct, snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  const { data: latestAudit } = strategy?.id
    ? await supabase
        .from('audit_log')
        .select('created_at')
        .eq('entity', 'strategies')
        .eq('entity_id', strategy.id)
        .eq('action', 'config_update')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  const strategyConfig = buildEffectiveStrategySettings(
    (strategy ?? null) as StrategySettingsRow | null,
  )
  const initialValues = buildSettingsFormValues(strategyConfig)
  const rowCount = STRATEGY_SETTINGS_GROUPS.reduce((total, group) => total + group.rows.length, 0)
  const nestedControlCount = STRATEGY_SETTINGS_GROUPS.reduce(
    (total, group) =>
      total +
      group.rows.reduce(
        (rowTotal, row) => rowTotal + (row.fields.length > 1 ? row.fields.length : 0),
        0,
      ),
    0,
  )

  const latestEquity =
    latestSnapshot?.equity == null ? null : Number(latestSnapshot.equity)
  const latestDrawdown =
    latestSnapshot?.drawdown_from_high_pct == null
      ? null
      : Number(latestSnapshot.drawdown_from_high_pct)
  const riskBudget =
    latestEquity == null
      ? null
      : latestEquity * strategyConfig.risk_params.risk_per_trade_pct
  const maxPositionNotional =
    latestEquity == null
      ? null
      : latestEquity * strategyConfig.risk_params.max_position_pct
  const latestRegime = latestRunContext.regime
  const currentRegime = (latestRegime?.regime as string | null) ?? null
  const activeRegimeMultiplier =
    currentRegime && currentRegime in strategyConfig.timing_params.regime_multipliers
      ? strategyConfig.timing_params.regime_multipliers[
          currentRegime as keyof typeof strategyConfig.timing_params.regime_multipliers
        ]
      : null
  const performanceMultiplier =
    latestDrawdown != null &&
    latestDrawdown <= -Math.abs(strategyConfig.performance_goals.max_drawdown_tolerance_pct) / 2
      ? 0.8
      : 1

  const groupDisclosures = buildStrategyGroupDisclosures({
    config: strategyConfig,
    currentRegime,
    latestEquity,
    latestDrawdownFromHighPct: latestDrawdown,
  })

  return (
    <>
      {strategyError ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {strategyError.message}
        </p>
      ) : null}

      {strategy?.id ? (
        <>
          <section className="grid gap-3 lg:grid-cols-4">
            <SummaryCard
              label="Live sizing budget"
              value={formatCurrency(riskBudget)}
              detail={`Latest equity ${formatCurrency(latestEquity)} · max position ${formatCurrency(maxPositionNotional)}`}
            />
            <SummaryCard
              label="Current regime"
              value={currentRegime ?? 'Unknown'}
              detail={`Regime multiplier ${formatMultiple(activeRegimeMultiplier)} · performance multiplier ${formatMultiple(performanceMultiplier)}`}
            />
            <SummaryCard
              label="Editable parameters"
              value={String(rowCount)}
              detail={`${nestedControlCount} nested controls across the six strategy groups.`}
            />
            <SummaryCard
              label="Audit trail"
              value={latestAudit?.created_at ? 'Active' : 'Empty'}
              detail={
                latestAudit?.created_at
                  ? `Most recent config write: ${new Date(latestAudit.created_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : 'No config_update rows found yet.'
              }
            />
          </section>

          <section className="rounded-[1.5rem] border border-border bg-card/90 p-5 shadow-[0_16px_35px_rgba(0,0,0,0.22)]">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Live strategy context
            </p>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <ContextMetric
                label="Drawdown tolerance"
                value={formatPercent(strategyConfig.performance_goals.max_drawdown_tolerance_pct)}
                detail={`Current drawdown ${formatPercent(latestDrawdown)} · kill switch ${formatPercent(strategyConfig.risk_params.daily_drawdown_kill_switch_pct)}`}
              />
              <ContextMetric
                label="Benchmark"
                value={strategyConfig.performance_goals.benchmark_symbol}
                detail={`Target annual return ${formatPercent(strategyConfig.performance_goals.target_annual_return_pct)}`}
              />
              <ContextMetric
                label="Shortlist / rec cap"
                value={`${strategyConfig.screening_params.shortlist_size} / ${strategyConfig.screening_params.daily_recommendation_cap}`}
                detail={`Current regime row dated ${latestRegime?.date ?? 'unknown'}`}
              />
            </div>
          </section>

          <SettingsEditor
            strategyId={strategy.id}
            strategyName={strategy.name ?? 'atlas_v2'}
            initialValues={initialValues}
            lastModifiedAt={latestAudit?.created_at ?? null}
            groupDisclosures={groupDisclosures}
          />
        </>
      ) : (
        <div className="surface-panel px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No active strategy row is available.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The Strategy Config tab needs an active `strategies` row with the v2 jsonb config blobs.
          </p>
        </div>
      )}
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

function ContextMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <article className="rounded-[1.25rem] border border-border/70 bg-background/45 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </article>
  )
}

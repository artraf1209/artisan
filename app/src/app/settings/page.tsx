import { ClipboardCheck, Target } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import SettingsEditor from '@/components/settings/SettingsEditor'
import { createServerClient } from '@/lib/supabase/server'
import {
  buildEffectiveStrategySettings,
  buildSettingsFormValues,
  STRATEGY_SETTINGS_GROUPS,
  type StrategySettingsRow,
} from '@/lib/settings'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = (await createServerClient()) as any
  const { data: strategy, error: strategyError } = await supabase
    .from('strategies')
    .select('id, name, active, risk_params, screening_params, timing_params, position_mgmt_params, performance_goals')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

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

  const strategyConfig = buildEffectiveStrategySettings((strategy ?? null) as StrategySettingsRow | null)
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

  return (
    <PageShell
      eyebrow="Strategy config"
      title="Settings"
      subtitle="Edit the live v2 strategy thresholds that drive sizing, screening, timing, position management, and daily agent budget behavior."
      actions={[
        { href: '/recommendations/shortlist', label: 'Shortlist', icon: Target },
        { href: '/trades/queue', label: 'Approval Queue', icon: ClipboardCheck },
      ]}
    >
      {strategyError ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {strategyError.message}
        </p>
      ) : null}

      {strategy?.id ? (
        <>
          <section className="grid gap-3 lg:grid-cols-3">
            <SummaryCard
              label="Editable parameters"
              value={String(rowCount)}
              detail="Top-level config rows shown across the six v2 groups."
            />
            <SummaryCard
              label="Nested controls"
              value={String(nestedControlCount)}
              detail="Factor, horizon, and regime sub-fields included in the editor."
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

          <SettingsEditor
            strategyId={strategy.id}
            strategyName={strategy.name ?? 'artisan_v2'}
            initialValues={initialValues}
            lastModifiedAt={latestAudit?.created_at ?? null}
          />
        </>
      ) : (
        <div className="surface-panel px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No active strategy row is available.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The `/settings` editor needs an active `strategies` row with the v2 jsonb config blobs.
          </p>
        </div>
      )}
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

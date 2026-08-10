import Link from 'next/link'
import { Newspaper, TrendingUp } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import StatusBadge from '@/components/shared/StatusBadge'
import { createServerClient } from '@/lib/supabase/server'
import {
  loadDecisionHistory,
  type DecisionHistoryAggregate,
  type DecisionHistoryRecord,
} from '@/lib/decision-history'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type HistorySearchParams = {
  symbol?: string | string[]
  setup_type?: string | string[]
  regime?: string | string[]
  resolution?: string | string[]
  mode?: string | string[]
}

function firstValue(value: string | string[] | undefined) {
  if (typeof value === 'string') {
    return value
  }

  return value?.[0]
}

function humanize(value: string | null | undefined) {
  return (value ?? 'still_open').replaceAll('_', ' ')
}

function formatRatio(value: number | null) {
  return value == null ? 'N/A' : `${value.toFixed(2)}R`
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: Promise<HistorySearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const filters = {
    symbol: firstValue(params?.symbol),
    setup_type: firstValue(params?.setup_type),
    regime: firstValue(params?.regime),
    resolution: firstValue(params?.resolution),
    mode: firstValue(params?.mode),
  }

  const supabase = (await createServerClient()) as any
  const result = await loadDecisionHistory(supabase, filters)

  return (
    <PageShell
      eyebrow="Knowledge base"
      title="History"
      subtitle="Browse the same decision-outcome archive the agents query before making new calls, with live aggregate stats over the filtered set."
      actions={[
        { href: '/recommendations/orders', label: 'Orders', icon: TrendingUp },
        { href: '/briefing', label: 'Briefings', icon: Newspaper },
      ]}
    >
      <section className="grid gap-3 lg:grid-cols-5">
        <SummaryCard label="Rows" value={String(result.aggregate.count)} detail="Filtered decision-outcome rows." />
        <SummaryCard
          label="Win rate"
          value={result.aggregate.win_rate == null ? 'N/A' : `${(result.aggregate.win_rate * 100).toFixed(1)}%`}
          detail="hit_target / (hit_target + hit_stop)"
        />
        <SummaryCard
          label="Average R"
          value={result.aggregate.avg_r_multiple == null ? 'N/A' : `${result.aggregate.avg_r_multiple.toFixed(2)}R`}
          detail="Across resolved rows with an R multiple."
        />
        <SummaryCard
          label="Real vs shadow"
          value={`${result.aggregate.real_count} / ${result.aggregate.shadow_count}`}
          detail="Rows taken live versus kept hypothetical."
        />
        <SummaryCard
          label="Average days"
          value={result.aggregate.avg_days_to_resolution == null ? 'N/A' : `${result.aggregate.avg_days_to_resolution.toFixed(1)}d`}
          detail="Across resolved rows with timing data."
        />
      </section>

      <section className="rounded-[1.5rem] border border-border bg-card/95 p-4 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <form action="/history" className="grid gap-3 md:grid-cols-5">
          <FilterField label="Symbol" name="symbol" defaultValue={filters.symbol ?? ''} placeholder="AAPL" />
          <FilterField label="Setup type" name="setup_type" defaultValue={filters.setup_type ?? ''} placeholder="pullback" />
          <SelectField
            label="Regime"
            name="regime"
            defaultValue={filters.regime ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'risk_on', label: 'risk_on' },
              { value: 'neutral', label: 'neutral' },
              { value: 'risk_off', label: 'risk_off' },
            ]}
          />
          <SelectField
            label="Resolution"
            name="resolution"
            defaultValue={filters.resolution ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'hit_target', label: 'hit_target' },
              { value: 'hit_stop', label: 'hit_stop' },
              { value: 'time_expired_favorable', label: 'time_expired_favorable' },
              { value: 'time_expired_unfavorable', label: 'time_expired_unfavorable' },
              { value: 'time_expired_flat', label: 'time_expired_flat' },
              { value: 'superseded', label: 'superseded' },
              { value: 'still_open', label: 'still_open' },
            ]}
          />
          <SelectField
            label="Mode"
            name="mode"
            defaultValue={filters.mode ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'real', label: 'real' },
              { value: 'shadow', label: 'shadow' },
            ]}
          />
          <div className="md:col-span-5 flex gap-2">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Apply
            </button>
            <Link
              href="/history"
              className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
            >
              Clear
            </Link>
          </div>
        </form>
      </section>

      {result.rows.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No decision outcomes match the current filters.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The history page will fill in as recommendations and position reviews accumulate tracked outcomes.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4 xl:hidden">
            {result.rows.map((row) => (
              <HistoryCard key={row.id} row={row} />
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-[1.5rem] border border-border bg-card/95 shadow-[0_20px_45px_rgba(0,0,0,0.22)] xl:block">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-background/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Symbol</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Context</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Setup</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Pricing</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {result.rows.map((row) => (
                    <HistoryTableRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
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

function FilterField({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string
  name: string
  defaultValue: string
  placeholder: string
}) {
  return (
    <label className="space-y-2 text-sm text-foreground">
      <span className="font-medium">{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
      />
    </label>
  )
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string
  name: string
  defaultValue: string
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="space-y-2 text-sm text-foreground">
      <span className="font-medium">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
      >
        {options.map((option) => (
          <option key={option.value || option.label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function HistoryCard({ row }: { row: DecisionHistoryRecord }) {
  return (
    <article className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold tracking-[-0.04em] text-foreground">{row.symbol}</h2>
        {row.mode ? <StatusBadge status={row.mode} /> : null}
        <StatusBadge status={humanize(row.resolution)} />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {row.run_date ?? 'No run date'} · {row.source_type} · {row.action_label ?? 'n/a'}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <InfoBlock
          label="Setup"
          lines={[
            `Setup ${row.setup_type ?? 'N/A'}`,
            `Regime ${row.regime ?? 'N/A'}`,
            `Horizon ${row.effective_horizon_days ?? 'N/A'}d`,
          ]}
        />
        <InfoBlock
          label="Pricing"
          lines={[
            `Entry ${formatCurrency(row.entry_price_reference)}`,
            `Stop ${formatCurrency(row.stop_price)}`,
            `Target ${formatCurrency(row.target_price)}`,
          ]}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <InfoBlock
          label="Outcome"
          lines={[
            humanize(row.resolution),
            `R ${formatRatio(row.r_multiple)}`,
            `${row.days_to_resolution ?? 'N/A'} days`,
          ]}
        />
        <InfoBlock
          label="Context"
          lines={[
            `Conviction ${row.conviction ?? 'N/A'}`,
            row.reasoning ?? row.thesis ?? 'No thesis or reasoning attached.',
          ]}
        />
      </div>
    </article>
  )
}

function HistoryTableRow({ row }: { row: DecisionHistoryRecord }) {
  return (
    <tr className="align-top transition hover:bg-accent/10">
      <td className="px-4 py-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{row.symbol}</span>
            {row.mode ? <StatusBadge status={row.mode} /> : null}
          </div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {row.run_date ?? 'No run date'}
          </p>
        </div>
      </td>
      <td className="px-4 py-4 text-foreground">
        <p>{row.source_type} · {row.action_label ?? 'n/a'}</p>
        <p className="mt-1 text-xs text-muted-foreground">Conviction {row.conviction ?? 'N/A'}</p>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Thesis / reasoning
          </summary>
          <p className="mt-2 max-w-md whitespace-pre-wrap text-sm leading-6 text-foreground">
            {row.reasoning ?? row.thesis ?? 'No detail attached.'}
          </p>
        </details>
      </td>
      <td className="px-4 py-4 text-foreground">
        <p>{row.setup_type ?? 'N/A'}</p>
        <p className="mt-1 text-xs text-muted-foreground">Regime {row.regime ?? 'N/A'}</p>
        <p className="mt-1 text-xs text-muted-foreground">Horizon {row.effective_horizon_days ?? 'N/A'}d</p>
      </td>
      <td className="px-4 py-4 text-foreground">
        <p>Entry {formatCurrency(row.entry_price_reference)}</p>
        <p className="mt-1 text-xs text-muted-foreground">Stop {formatCurrency(row.stop_price)}</p>
        <p className="mt-1 text-xs text-muted-foreground">Target {formatCurrency(row.target_price)}</p>
      </td>
      <td className="px-4 py-4 text-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={humanize(row.resolution)} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {row.days_to_resolution == null ? 'N/A' : `${row.days_to_resolution} days`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatRatio(row.r_multiple)}
        </p>
      </td>
    </tr>
  )
}

function InfoBlock({
  label,
  lines,
}: {
  label: string
  lines: string[]
}) {
  return (
    <div className="rounded-2xl border border-border bg-background/50 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <div className="mt-2 space-y-1">
        {lines.map((line) => (
          <p key={line} className="text-sm text-foreground">
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}

import { cn } from '@/lib/utils'
import StatusBadge from '@/components/shared/StatusBadge'

type CandidateRow = {
  symbol: string
  name: string | null
  sector: string | null
  rank: number | null
  composite_z: number | null
  value_z: number | null
  quality_z: number | null
  momentum_z: number | null
  low_vol_z: number | null
  growth_z: number | null
  hard_filter_pass: boolean
  is_new: boolean
  setup_type: string | null
  signal_status: string | null
}

const FACTOR_LABELS = [
  ['value_z', 'Value'],
  ['quality_z', 'Quality'],
  ['momentum_z', 'Momentum'],
  ['low_vol_z', 'Low vol'],
  ['growth_z', 'Growth'],
] as const

function scoreTone(value: number | null) {
  if (value == null) return 'text-muted-foreground'
  if (value > 0.1) return 'text-profit'
  if (value < -0.1) return 'text-loss'
  return 'text-foreground'
}

function setupLabel(value: string | null) {
  if (!value) return null
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function bestFactor(row: CandidateRow) {
  const factors = FACTOR_LABELS.map(([key, label]) => ({
    label,
    value: row[key],
  })).filter((factor) => factor.value != null)

  if (factors.length === 0) return null

  return factors.sort((left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity))[0]
}

function FactorMeter({ label, value }: { label: string; value: number | null }) {
  const width = value == null ? 0 : Math.min(100, Math.round((Math.abs(value) / 3) * 100))

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-medium tabular-nums', scoreTone(value))}>
          {value != null ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}` : '—'}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border/40">
        <div
          className={cn(
            'h-full rounded-full',
            value == null ? 'bg-border/60' : value >= 0 ? 'bg-profit/70' : 'bg-loss/70',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

export default function StocksToTrade({ rows }: { rows: CandidateRow[] }) {
  const passing = rows
    .filter((row) => row.hard_filter_pass)
    .sort((left, right) => {
      if (left.rank == null && right.rank == null) return left.symbol.localeCompare(right.symbol)
      if (left.rank == null) return 1
      if (right.rank == null) return -1
      return left.rank - right.rank
    })

  const filteredOut = rows.length - passing.length

  return (
    <div className="surface-panel p-6 xl:col-span-7">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Stocks To Trade</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Factor-ranked names from the latest cross-sectional scoring run.
          </p>
        </div>
        <div className="rounded-full border border-border/70 bg-accent/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          {passing.length} passing hard filters
        </div>
      </div>

      {passing.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 px-5 py-10 text-center text-sm text-muted-foreground">
          Run the factor scoring job to populate this shortlist.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {passing.map((row) => {
            const leader = bestFactor(row)

            return (
              <article key={row.symbol} className="surface-soft p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-semibold tracking-[-0.03em] text-foreground">
                        {row.symbol}
                      </span>
                      {row.signal_status ? <StatusBadge status={row.signal_status} /> : null}
                      {row.is_new ? (
                        <span className="rounded-full border border-border/70 bg-accent/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-foreground">
                          New
                        </span>
                      ) : null}
                      {row.setup_type ? (
                        <span className="rounded-full border border-profit/30 bg-profit/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-profit">
                          {setupLabel(row.setup_type)}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p>{row.name ?? row.sector ?? 'Unclassified'}</p>
                      <p>{row.sector ?? 'Unknown sector'}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Rank</p>
                    <p className="text-2xl font-semibold tracking-[-0.05em] text-foreground">
                      {row.rank ?? '—'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-border/60 bg-background/35 px-3 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Composite Z</p>
                    <p className={cn('mt-1 text-xl font-semibold tracking-[-0.04em]', scoreTone(row.composite_z))}>
                      {row.composite_z != null ? `${row.composite_z >= 0 ? '+' : ''}${row.composite_z.toFixed(2)}` : '—'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-background/35 px-3 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Best Factor</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {leader ? `${leader.label} ${leader.value != null ? `${leader.value >= 0 ? '+' : ''}${leader.value.toFixed(2)}` : ''}` : 'No factor edge yet'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {FACTOR_LABELS.map(([key, label]) => (
                    <FactorMeter key={key} label={label} value={row[key]} />
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {filteredOut > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {filteredOut} symbol{filteredOut === 1 ? '' : 's'} filtered out before ranking.
        </p>
      ) : null}
    </div>
  )
}

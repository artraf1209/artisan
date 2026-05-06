import StatusBadge from '@/components/shared/StatusBadge'
import { cn } from '@/lib/utils'

type CandidateRow = {
  symbol: string
  name: string | null
  sector: string | null
  rank: number | null
  composite_z: number | null
  value_z: number | null
  value_delta: number | null
  quality_z: number | null
  quality_delta: number | null
  momentum_z: number | null
  momentum_delta: number | null
  low_vol_z: number | null
  low_vol_delta: number | null
  growth_z: number | null
  growth_delta: number | null
  hard_filter_pass: boolean
  is_new: boolean
  setup_type: string | null
  signal_status: string | null
}

const FACTOR_COLUMNS = [
  { label: 'Value', valueKey: 'value_z', deltaKey: 'value_delta' },
  { label: 'Quality', valueKey: 'quality_z', deltaKey: 'quality_delta' },
  { label: 'Momentum', valueKey: 'momentum_z', deltaKey: 'momentum_delta' },
  { label: 'Low Vol', valueKey: 'low_vol_z', deltaKey: 'low_vol_delta' },
  { label: 'Growth', valueKey: 'growth_z', deltaKey: 'growth_delta' },
] as const

function scoreTone(value: number | null) {
  if (value == null) return 'text-muted-foreground'
  if (value > 0.5) return 'text-profit'
  if (value > 0) return 'text-yellow-400'
  return 'text-loss'
}

function deltaTone(value: number | null) {
  if (value == null) return 'text-muted-foreground'
  if (value > 0) return 'text-profit'
  if (value < 0) return 'text-loss'
  return 'text-muted-foreground'
}

function formatSigned(value: number | null) {
  if (value == null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function setupLabel(value: string | null) {
  if (!value) return null
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function FactorCell({
  value,
  delta,
}: {
  value: number | null
  delta: number | null
}) {
  return (
    <div className="space-y-1">
      <p className={cn('font-semibold tabular-nums', scoreTone(value))}>{formatSigned(value)}</p>
      <p className={cn('text-[11px] tabular-nums', deltaTone(delta))}>
        {delta == null ? 'Δ —' : `Δ ${formatSigned(delta)}`}
      </p>
    </div>
  )
}

export default function StocksToTrade({ rows }: { rows: CandidateRow[] }) {
  const passing = [...rows]
    .filter((row) => row.hard_filter_pass)
    .sort((left, right) => {
      if (left.rank == null && right.rank == null) return left.symbol.localeCompare(right.symbol)
      if (left.rank == null) return 1
      if (right.rank == null) return -1
      return left.rank - right.rank
    })

  const filteredOut = rows.length - passing.length

  return (
    <div className="surface-panel p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Stocks To Trade</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ranked survivors from the latest multi-factor scoring run.
          </p>
        </div>
        <div className="rounded-full border border-border/70 bg-accent/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          {passing.length} ranked names
        </div>
      </div>

      {passing.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 px-5 py-10 text-center text-sm text-muted-foreground">
          Run the factor scoring job to populate this shortlist.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left">
                <th className="pb-3 pr-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">Rank</th>
                <th className="pb-3 pr-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">Symbol</th>
                <th className="pb-3 pr-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">Sector</th>
                <th className="pb-3 pr-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">Composite</th>
                {FACTOR_COLUMNS.map((column) => (
                  <th
                    key={column.label}
                    className="pb-3 pr-4 text-xs uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {column.label}
                  </th>
                ))}
                <th className="pb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {passing.map((row) => (
                <tr key={row.symbol} className="align-top">
                  <td className="py-4 pr-4">
                    <span className="text-lg font-semibold tracking-[-0.04em] text-foreground">
                      {row.rank ?? '—'}
                    </span>
                  </td>
                  <td className="py-4 pr-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{row.symbol}</span>
                        {row.is_new ? (
                          <span className="rounded-full border border-border/70 bg-accent/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-foreground">
                            New
                          </span>
                        ) : null}
                        {row.signal_status ? <StatusBadge status={row.signal_status} /> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {row.name ?? 'Unclassified'}
                      </p>
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-sm text-muted-foreground">
                    {row.sector ?? 'Unknown'}
                  </td>
                  <td className="py-4 pr-4">
                    <p className={cn('text-lg font-semibold tracking-[-0.04em] tabular-nums', scoreTone(row.composite_z))}>
                      {formatSigned(row.composite_z)}
                    </p>
                  </td>
                  {FACTOR_COLUMNS.map((column) => (
                    <td key={column.label} className="py-4 pr-4">
                      <FactorCell
                        value={row[column.valueKey]}
                        delta={row[column.deltaKey]}
                      />
                    </td>
                  ))}
                  <td className="py-4">
                    <div className="flex flex-wrap gap-2">
                      {row.setup_type ? (
                        <span className="rounded-full border border-profit/30 bg-profit/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-profit">
                          {setupLabel(row.setup_type)}
                        </span>
                      ) : (
                        <span className="rounded-full border border-border/70 bg-accent/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          No setup
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filteredOut > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {filteredOut} symbol{filteredOut === 1 ? '' : 's'} failed the hard filters and were excluded from ranking.
        </p>
      ) : null}
    </div>
  )
}

import { cn, formatCurrency } from '@/lib/utils'

type EntryRow = {
  symbol: string
  name: string | null
  rank: number | null
  gate_market: boolean | null
  gate_trend: boolean | null
  setup_type: string | null
  gate_confirmed: boolean
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  atr: number | null
  r_multiple: number | null
  shares: number | null
  dollar_risk: number | null
  actionable: boolean
}

function gateChip(label: string, active: boolean | null) {
  if (active == null) {
    return (
      <span className="rounded-full border border-border/70 bg-accent/50 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label} n/a
      </span>
    )
  }

  return (
    <span
      className={cn(
        'rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em]',
        active
          ? 'border-profit/30 bg-profit/10 text-profit'
          : 'border-loss/30 bg-loss/10 text-loss',
      )}
    >
      {label} {active ? 'on' : 'off'}
    </span>
  )
}

function readinessReason(row: EntryRow) {
  if (row.actionable) return 'All gates passed'
  if (!row.gate_trend) return 'Trend gate failed'
  if (!row.setup_type) return 'Waiting for setup'
  if (!row.gate_confirmed) return 'Waiting for confirmation'
  return 'Sizing not available yet'
}

function setupLabel(value: string | null) {
  if (!value) return 'No setup'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function WhenToTrade({ rows }: { rows: EntryRow[] }) {
  const sorted = [...rows].sort((left, right) => {
    const leftScore =
      (left.actionable ? 100 : 0) +
      (left.gate_confirmed ? 10 : 0) +
      (left.setup_type ? 5 : 0) +
      (left.gate_trend ? 2 : 0)
    const rightScore =
      (right.actionable ? 100 : 0) +
      (right.gate_confirmed ? 10 : 0) +
      (right.setup_type ? 5 : 0) +
      (right.gate_trend ? 2 : 0)

    if (leftScore !== rightScore) return rightScore - leftScore
    if (left.rank == null && right.rank == null) return left.symbol.localeCompare(right.symbol)
    if (left.rank == null) return 1
    if (right.rank == null) return -1
    return left.rank - right.rank
  })

  const marketGate = sorted.find((row) => row.gate_market != null)?.gate_market ?? null
  const actionableCount = sorted.filter((row) => row.actionable).length
  const setupCount = sorted.filter((row) => row.setup_type != null).length

  return (
    <div className="surface-panel p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">When To Trade</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Entry-gate readout for the current ranked shortlist.
          </p>
        </div>
        <div className="text-right text-sm">
          <p className={cn('font-semibold', actionableCount > 0 ? 'text-profit' : 'text-foreground')}>
            {actionableCount} actionable
          </p>
          <p className="text-muted-foreground">{setupCount} with setups</p>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-border/70 bg-background/35 px-4 py-3">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Market Regime</p>
        <p className={cn('mt-1 text-sm font-medium', marketGate === false ? 'text-loss' : 'text-profit')}>
          {marketGate === false ? 'Risk-off: the global SPY gate is closed.' : 'Risk-on: the global SPY gate is open.'}
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 px-5 py-10 text-center text-sm text-muted-foreground">
          Run the entry signal job to populate timing setups.
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((row) => (
            <article key={row.symbol} className="surface-soft p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-semibold tracking-[-0.03em] text-foreground">
                      {row.symbol}
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]',
                        row.actionable
                          ? 'border-profit/30 bg-profit/10 text-profit'
                          : 'border-border/70 bg-accent/60 text-muted-foreground',
                      )}
                    >
                      {row.actionable ? 'Actionable' : 'Watchlist'}
                    </span>
                    <span className="rounded-full border border-border/70 bg-accent/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-foreground">
                      {setupLabel(row.setup_type)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {row.name ?? 'Timing snapshot'}{row.rank != null ? ` · factor rank ${row.rank}` : ''}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">R multiple</p>
                  <p className="mt-1 text-lg font-semibold tracking-[-0.04em] text-foreground">
                    {row.r_multiple != null ? `${row.r_multiple.toFixed(1)}R` : '—'}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {gateChip('Market', row.gate_market)}
                {gateChip('Trend', row.gate_trend)}
                <span className="rounded-full border border-border/70 bg-accent/50 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Setup {setupLabel(row.setup_type)}
                </span>
                {gateChip('Confirm', row.gate_confirmed)}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <Metric label="Entry" value={formatCurrency(row.entry_price)} />
                <Metric label="ATR" value={row.atr != null ? row.atr.toFixed(2) : '—'} />
                <Metric label="Stop" value={formatCurrency(row.stop_price)} />
                <Metric label="Target" value={formatCurrency(row.target_price)} />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/40 pt-3 text-xs">
                <span className="text-muted-foreground">{readinessReason(row)}</span>
                <span className="font-medium text-foreground">
                  {row.shares != null && row.dollar_risk != null
                    ? `${row.shares} shares · ${formatCurrency(row.dollar_risk)} risk`
                    : 'No position size yet'}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/35 px-3 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

import StrategyDropdown from './StrategyDropdown'

interface Strategy {
  id: string
  name: string
  horizon: string
  threshold: number
  max_positions: number
  position_frac: number
  goal_growth_pct: number | null
  goal_months: number | null
  risk_level: string | null
}

interface FunnelCounts {
  screened: number
  hard_filtered: number
  scored: number
  in_portfolio: number
}

interface Props {
  strategies: Strategy[]
  selected: Strategy
  funnel: FunnelCounts
}

const FACTOR_WEIGHTS = [
  { label: 'Value', weight: 25 },
  { label: 'Quality', weight: 25 },
  { label: 'Momentum', weight: 25 },
  { label: 'Low Vol', weight: 10 },
  { label: 'Growth', weight: 15 },
]

const HARD_FILTERS = [
  'Free Cash Flow > 0',
  'Net Debt / EBITDA < 4×',
]

const UNIVERSE_RULES = [
  'NASDAQ & NYSE listed',
  'Market cap > $1B',
  'Avg daily volume > $5M',
  '5+ years of financials',
]

export default function StrategySummary({ strategies, selected, funnel }: Props) {
  return (
    <div className="surface-panel p-5 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-1">Strategy</p>
          <StrategyDropdown
            strategies={strategies.map(({ id, name }) => ({ id, name }))}
            selectedId={selected.id}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <span className="rounded-full border border-border/70 bg-accent/70 px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-widest">
            {selected.horizon}
          </span>
          {selected.risk_level && (
            <span className="rounded-full border border-border/70 bg-accent/70 px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-widest">
              {selected.risk_level}
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">Selection funnel</p>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <FunnelStep label="Screened" value={funnel.screened} />
          <Arrow />
          <FunnelStep label="Hard filter pass" value={funnel.hard_filtered} highlight />
          <Arrow />
          <FunnelStep label="Scored" value={funnel.scored} />
          <Arrow />
          <FunnelStep label="In portfolio" value={funnel.in_portfolio} highlight />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-1">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">Universe</p>
          <ul className="space-y-1">
            {UNIVERSE_RULES.map(r => (
              <li key={r} className="text-sm text-foreground flex gap-2">
                <span className="text-muted-foreground">·</span>{r}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">Hard filters</p>
          <ul className="space-y-1">
            {HARD_FILTERS.map(f => (
              <li key={f} className="text-sm text-foreground flex gap-2">
                <span className="text-profit">✓</span>{f}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">Factor weights</p>
          <div className="space-y-1.5">
            {FACTOR_WEIGHTS.map(({ label, weight }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16">{label}</span>
                <div className="flex-1 h-1.5 bg-border/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-foreground/40 rounded-full"
                    style={{ width: `${weight}%` }}
                  />
                </div>
                <span className="text-xs text-foreground w-8 text-right">{weight}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected.goal_growth_pct != null ? (
        <p className="text-xs text-muted-foreground border-t border-border/50 pt-3">
          Goal: {selected.goal_growth_pct}% in {selected.goal_months} months ·
          Max {selected.max_positions} positions ·
          {(selected.position_frac * 100).toFixed(0)}% per trade ·
          Threshold {(selected.threshold * 100).toFixed(0)}%
        </p>
      ) : null}
    </div>
  )
}

function FunnelStep({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-xl font-semibold tracking-[-0.04em] ${highlight ? 'text-foreground' : 'text-muted-foreground'}`}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function Arrow() {
  return <span className="text-muted-foreground text-sm">→</span>
}

import ClosePositionDialog from '@/components/positions/ClosePositionDialog'
import RealtimeRefresher from '@/components/shared/RealtimeRefresher'
import { fetchAlpacaAccountState } from '@/lib/alpaca'
import { loadOpenPositions, type PositionOverview } from '@/lib/positions'
import { createServerClient } from '@/lib/supabase/server'
import { formatCurrency, formatPercent } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function PositionsPage() {
  const supabase = await createServerClient()
  const [positions, account] = await Promise.all([loadOpenPositions(supabase as any), fetchAlpacaAccountState().catch(() => null)])
  const dayPnl = account?.day_pnl ?? null

  return <div className="space-y-4">
    <header><p className="font-[family-name:var(--font-display)] text-sm tracking-[0.14em] text-amber">ATLAS</p><p className="mt-2 text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">Portfolio positions · refreshed from reconciliation</p></header>
    <section className="grid grid-cols-3 divide-x divide-border border border-border bg-card"><StripMetric label="Equity" value={formatCurrency(account?.equity)} /><StripMetric label="Day P/L" value={formatCurrency(dayPnl)} tone={dayPnl == null || dayPnl === 0 ? 'neutral' : dayPnl > 0 ? 'profit' : 'loss'} /><StripMetric label="Open" value={String(positions.length)} /></section>
    {positions.length === 0 ? <p className="border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No open positions.</p> : positions.map((position) => <PositionCard key={position.id} position={position} />)}
    <details className="border border-border p-4 text-sm text-muted-foreground"><summary className="cursor-pointer uppercase tracking-[0.08em] text-paper">Portfolio</summary><p className="mt-3">Expanded portfolio analytics, exposure, drawdown, and annual goal tracking remain available in Account.</p></details>
    <RealtimeRefresher tables={['portfolio_positions', 'position_reviews', 'trade_executions']} />
  </div>
}

function PositionCard({ position }: { position: PositionOverview }) {
  const current = position.current_price ?? position.avg_entry_price
  const pnl = position.unrealized_pnl ?? 0
  const pnlTone = pnl === 0 ? 'text-muted-foreground' : pnl > 0 ? 'text-profit' : 'text-loss'
  const duration = Math.min(100, (position.days_held / position.max_holding_period_days) * 100)
  const start = position.stop_price ?? position.avg_entry_price
  const end = position.target_price ?? Math.max(current * 1.12, current + Math.abs(current - start))
  const currentPct = Math.max(0, Math.min(100, ((current - start) / Math.max(0.01, end - start)) * 100))
  return <article className="border border-border bg-card p-4">
    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-xl font-bold">{position.symbol}</h2><span className="rounded-full border border-border px-2 py-0.5 text-[0.58rem] uppercase text-muted-foreground">{position.original_recommendation?.setup_type ?? 'position'}</span></div><p className="mt-1 text-[0.68rem] text-muted-foreground">{position.quantity} sh @ {formatCurrency(position.avg_entry_price)} · opened {new Date(position.opened_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p></div><span className="text-xs text-muted-foreground">{position.r_multiple == null ? '—' : `${position.r_multiple.toFixed(2)}R`}</span></div>
    <div className="mt-4 flex items-baseline gap-3"><strong className="text-2xl">{formatCurrency(current)}</strong><span className={`text-xs ${pnlTone}`}>{formatPercent(position.unrealized_pnl_pct)} · {formatCurrency(pnl)}</span></div>
    <div className="mt-6 px-1"><div className="relative h-0.5 bg-border"><div className="absolute left-0 top-0 h-0.5 bg-paper/35" style={{ width: `${position.target_price == null ? currentPct : 100}%` }} />{position.target_price == null ? <div className="absolute right-0 top-0 h-0.5 bg-[repeating-linear-gradient(90deg,rgba(242,239,230,0.45)_0_4px,transparent_4px_9px)]" style={{ left: `${currentPct}%` }} /> : null}<span className="absolute -top-1.5 h-3 w-0.5 bg-loss" /><span className="absolute -top-[0.3rem] h-3 w-3 -translate-x-1/2 rounded-full bg-paper" style={{ left: `${currentPct}%` }} /></div><div className="mt-3 flex justify-between text-[0.62rem]"><span className="text-loss">STOP {formatCurrency(position.stop_price)}</span><span className="text-muted-foreground">TARGET {position.target_price == null ? '—' : formatCurrency(position.target_price)}</span></div></div>
    <div className="mt-5"><p className="text-[0.6rem] uppercase tracking-[0.06em] text-muted-foreground">{position.days_held}d held · {position.days_remaining_horizon == null ? 'no horizon' : `${position.days_remaining_horizon}d vs horizon`} · {position.days_remaining_ceiling}d vs ceiling</p><div className="mt-2 h-1 bg-muted"><div className="h-full bg-amber" style={{ width: `${duration}%` }} /></div></div>
    <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[0.65rem] uppercase tracking-[0.06em] text-muted-foreground"><span>Review · {position.latest_review ? position.latest_review.recommended_action : 'Not yet recorded'}</span>{position.latest_review?.reasoning ? <span className="max-w-[45%] truncate normal-case tracking-normal">{position.latest_review.reasoning}</span> : null}</div>
    <div className="mt-4"><ClosePositionDialog positionId={position.id} symbol={position.symbol} quantity={position.quantity} currentPrice={position.current_price} hasRestingOrders={position.has_resting_orders} /></div>
  </article>
}

function StripMetric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'neutral' | 'profit' | 'loss' }) {
  const toneClass = tone === 'profit' ? 'text-profit' : tone === 'loss' ? 'text-loss' : tone === 'neutral' ? 'text-muted-foreground' : 'text-paper'
  return <div className="min-w-0 p-3"><p className="text-[0.58rem] uppercase tracking-[0.08em] text-muted-foreground">{label}</p><p className={`mt-1 truncate text-sm font-bold ${toneClass}`}>{value}</p></div>
}

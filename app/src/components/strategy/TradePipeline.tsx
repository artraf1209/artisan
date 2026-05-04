import type { WaitingTrade, InMarketTrade, ClosedTrade } from '@/app/api/strategy/trades/route'
import { WaitingCard, InMarketCard, ClosedCard } from './TradeCard'

function Column({
  label,
  count,
  accent,
  children,
}: {
  label: string
  count: number
  accent: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</h3>
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${accent}`}>
          {count}
        </span>
      </div>
      {children}
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/50 bg-card/20 px-4 py-6 text-center text-xs text-muted-foreground">
      No {label} trades
    </div>
  )
}

export default function TradePipeline({
  waiting,
  in_market,
  closed,
}: {
  waiting: WaitingTrade[]
  in_market: InMarketTrade[]
  closed: ClosedTrade[]
}) {
  return (
    <div className="surface-panel p-6">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Trade Pipeline</p>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Column label="Waiting" count={waiting.length} accent="bg-amber-500/15 text-amber-400">
          {waiting.length === 0 ? (
            <Empty label="waiting" />
          ) : (
            waiting.map(t => <WaitingCard key={t.id} trade={t} />)
          )}
        </Column>

        <Column label="In Market" count={in_market.length} accent="bg-blue-500/15 text-blue-400">
          {in_market.length === 0 ? (
            <Empty label="in-market" />
          ) : (
            in_market.map(t => <InMarketCard key={t.id} trade={t} />)
          )}
        </Column>

        <Column label="Closed" count={closed.length} accent="bg-muted/60 text-muted-foreground">
          {closed.length === 0 ? (
            <Empty label="closed" />
          ) : (
            closed.map(t => <ClosedCard key={t.id} trade={t} />)
          )}
        </Column>
      </div>
    </div>
  )
}

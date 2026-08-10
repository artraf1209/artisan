'use client'

import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'

export interface PositionBarPoint {
  symbol: string
  date: string
  close: number
}

type TimeframeKey = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'All'

const TIMEFRAMES: { key: TimeframeKey; days: number | null; disabled?: boolean }[] = [
  { key: '1D', days: 1, disabled: true },
  { key: '1W', days: 7 },
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '6M', days: 180 },
  { key: '1Y', days: 365 },
  { key: 'All', days: null },
]

export default function PositionTimeframeChart({ symbols, bars }: { symbols: string[]; bars: PositionBarPoint[] }) {
  const [symbol, setSymbol] = useState(symbols[0] ?? '')
  const [timeframe, setTimeframe] = useState<TimeframeKey>('3M')

  const filtered = useMemo(() => {
    const symbolBars = bars.filter((bar) => bar.symbol === symbol).sort((a, b) => a.date.localeCompare(b.date))
    const days = TIMEFRAMES.find((option) => option.key === timeframe)?.days
    if (days == null) {
      return symbolBars
    }

    const cutoff = new Date()
    cutoff.setUTCDate(cutoff.getUTCDate() - days)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    return symbolBars.filter((bar) => bar.date >= cutoffStr)
  }, [bars, symbol, timeframe])

  if (symbols.length === 0) {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
        <p className="text-base font-medium text-foreground">No open positions to chart.</p>
      </div>
    )
  }

  return (
    <section className="rounded-[1.5rem] border border-border bg-card/95 p-4 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Position price history</h2>
          <p className="text-sm text-muted-foreground">Daily close, per open position.</p>
        </div>
        <select
          value={symbol}
          onChange={(event) => setSymbol(event.target.value)}
          className="rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
        >
          {symbols.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TIMEFRAMES.map((option) => (
          <button
            key={option.key}
            type="button"
            disabled={option.disabled}
            title={option.disabled ? 'Requires live intraday quotes, which this app doesn’t fetch yet.' : undefined}
            onClick={() => setTimeframe(option.key)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] transition',
              option.disabled
                ? 'cursor-not-allowed border-border/50 text-muted-foreground/50'
                : timeframe === option.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent',
            )}
          >
            {option.key}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No price_bars rows for {symbol} in this window.</p>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filtered}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={64}
                domain={['auto', 'auto']}
                tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
              />
              <Tooltip
                formatter={(value: any) => {
                  const numericValue = typeof value === 'number' ? value : Number(value)
                  return [Number.isFinite(numericValue) ? `$${numericValue.toFixed(2)}` : 'N/A', 'Close']
                }}
              />
              <Line type="monotone" dataKey="close" name="Close" stroke="rgb(34,197,94)" strokeWidth={2.25} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

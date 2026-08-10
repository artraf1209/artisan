'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface AccountChartPoint {
  date: string
  equity: number | null
  benchmark: number | null
  drawdown_pct: number | null
  drawdown_limit_pct: number
}

export default function AccountCharts({
  data,
  benchmarkLabel,
}: {
  data: AccountChartPoint[]
  benchmarkLabel: string
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
        <p className="text-base font-medium text-foreground">No portfolio snapshot history yet.</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Once daily `portfolio_snapshots` rows accumulate, the equity curve and drawdown chart will render here.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <section className="rounded-[1.5rem] border border-border bg-card/95 p-4 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Equity curve</h2>
          <p className="text-sm text-muted-foreground">
            Portfolio equity versus rebased {benchmarkLabel} over the same daily window.
          </p>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
              />
              <Tooltip
                formatter={(value: any, name: any) => {
                  const numericValue = typeof value === 'number' ? value : Number(value)
                  if (!Number.isFinite(numericValue)) {
                    return ['N/A', name]
                  }
                  return [
                    new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: 'USD',
                      maximumFractionDigits: 0,
                    }).format(numericValue),
                    name,
                  ]
                }}
              />
              <Line
                type="monotone"
                dataKey="equity"
                name="Equity"
                stroke="rgb(34,197,94)"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="benchmark"
                name={benchmarkLabel}
                stroke="rgba(255,255,255,0.75)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-border bg-card/95 p-4 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Drawdown</h2>
          <p className="text-sm text-muted-foreground">
            Daily drawdown from the high-water mark against the configured tolerance line.
          </p>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(value) => `${value}%`} />
              <Tooltip
                formatter={(value: any, name: any) => {
                  const numericValue = typeof value === 'number' ? value : Number(value)
                  if (!Number.isFinite(numericValue)) {
                    return ['N/A', name]
                  }
                  return [`${numericValue.toFixed(2)}%`, name]
                }}
              />
              <ReferenceLine
                y={data[0]?.drawdown_limit_pct ?? -18}
                stroke="rgba(239,68,68,0.85)"
                strokeDasharray="6 6"
                label={{ value: 'Max tolerance', fill: 'rgba(239,68,68,0.85)', position: 'insideTopRight' }}
              />
              <Area
                type="monotone"
                dataKey="drawdown_pct"
                name="Drawdown"
                stroke="rgb(59,130,246)"
                fill="rgba(59,130,246,0.18)"
                strokeWidth={2.25}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}

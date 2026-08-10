'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { YtdGoalPoint } from '@/lib/dashboard-overview'

export default function YtdGoalChart({
  data,
  benchmarkLabel,
  targetAnnualReturnPct,
}: {
  data: YtdGoalPoint[]
  benchmarkLabel: string
  targetAnnualReturnPct: number
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
        <p className="text-base font-medium text-foreground">No portfolio snapshot history yet.</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The YTD goal chart renders once daily portfolio_snapshots rows accumulate for this year.
        </p>
      </div>
    )
  }

  return (
    <section className="rounded-[1.5rem] border border-border bg-card/95 p-4 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-[-0.03em] text-foreground">YTD goal</h2>
        <p className="text-sm text-muted-foreground">
          Equity versus a {(targetAnnualReturnPct * 100).toFixed(0)}% annual target pro-rated from Jan 1, and rebased{' '}
          {benchmarkLabel}.
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
            <Line type="monotone" dataKey="equity" name="Equity" stroke="rgb(34,197,94)" strokeWidth={2.5} dot={false} />
            <Line
              type="monotone"
              dataKey="target"
              name="Target"
              stroke="rgba(250,204,21,0.85)"
              strokeWidth={2}
              strokeDasharray="6 6"
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
  )
}

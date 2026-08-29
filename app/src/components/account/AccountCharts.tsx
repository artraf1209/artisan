'use client'

import { useMemo } from 'react'
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

function numbersOf(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value != null && Number.isFinite(value))
}

/** [0.95 * lower-of-(min equity, min benchmark), 1.10 * higher-of-(max equity, max
 * benchmark)] -- both series share one axis, so the domain has to cover whichever
 * of the two swings further in each direction, not just the equity line alone. */
function computeEquityDomain(data: AccountChartPoint[]): [number, number] {
  const values = numbersOf([...data.map((point) => point.equity), ...data.map((point) => point.benchmark)])
  if (values.length === 0) {
    return [0, 1]
  }
  return [round(Math.min(...values) * 0.95, 2), round(Math.max(...values) * 1.1, 2)]
}

/** The tolerance line has to land inside the visible range even when actual
 * drawdown has never come close to it -- so the floor is whichever is lower,
 * worst drawdown on record or the tolerance line itself, with padding beyond
 * that so the reference line doesn't sit flush against the chart edge. */
function computeDrawdownDomain(data: AccountChartPoint[]): [number, number] {
  const values = numbersOf(data.map((point) => point.drawdown_pct))
  const thresholdPct = data[0]?.drawdown_limit_pct ?? -18
  const floor = Math.min(0, thresholdPct, ...values)
  const domainMin = floor * 1.15
  const domainMax = Math.max(0, ...values) + Math.abs(domainMin) * 0.05
  return [round(domainMin, 2), round(domainMax, 2)]
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export default function AccountCharts({
  data,
  benchmarkLabel,
}: {
  data: AccountChartPoint[]
  benchmarkLabel: string
}) {
  const equityDomain = useMemo(() => computeEquityDomain(data), [data])
  const drawdownDomain = useMemo(() => computeDrawdownDomain(data), [data])

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
                domain={equityDomain}
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
              <YAxis
                tickLine={false}
                axisLine={false}
                width={64}
                domain={drawdownDomain}
                tickFormatter={(value) => `${value}%`}
              />
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

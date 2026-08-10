function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export interface SectorExposure {
  sector: string
  dollarValue: number
  pctOfEquity: number | null
}

/** Mirrors execute-trade's sector-cap veto: dollar value per position is
 * cost basis (avg_entry_price * quantity), not mark-to-market — this isn't
 * persisted anywhere, so the Dashboard recomputes it the same way rather
 * than inventing a different (marked-to-market) definition. */
export function computeSectorExposure(
  positions: { symbol: string; quantity: number; avg_entry_price: number }[],
  sectorBySymbol: Map<string, string | null>,
  equity: number | null,
): SectorExposure[] {
  const totals = new Map<string, number>()

  for (const position of positions) {
    const sector = sectorBySymbol.get(position.symbol) ?? 'Unknown'
    const value = position.quantity * position.avg_entry_price
    totals.set(sector, (totals.get(sector) ?? 0) + value)
  }

  return [...totals.entries()]
    .map(([sector, dollarValue]) => ({
      sector,
      dollarValue: round(dollarValue, 2),
      pctOfEquity: equity != null && equity > 0 ? round((dollarValue / equity) * 100, 2) : null,
    }))
    .sort((a, b) => b.dollarValue - a.dollarValue)
}

export interface YtdGoalPoint {
  date: string
  equity: number | null
  target: number | null
  benchmark: number | null
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  return Math.floor((date.getTime() - start) / (24 * 60 * 60 * 1000)) + 1
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365
}

/** Pro-rates the annual target off calendar Jan 1, not off the first
 * snapshot's date — a goal is inherently full-year, even if snapshot
 * history only starts partway through it. Benchmark is rebased to the
 * first snapshot's equity, same convention as the Account tab's chart. */
export function computeYtdGoalSeries(
  snapshots: { snapshot_date: string; equity: number | null }[],
  benchmarkBars: { bar_time: string; close: number | null }[],
  targetAnnualReturnPct: number,
): YtdGoalPoint[] {
  if (snapshots.length === 0) {
    return []
  }

  const benchmarkByDate = new Map<string, number>()
  for (const row of benchmarkBars) {
    const date = row.bar_time.slice(0, 10)
    if (row.close != null) {
      benchmarkByDate.set(date, row.close)
    }
  }

  const baselineEquity = snapshots[0].equity
  let firstBenchmarkClose: number | null = null
  let rollingBenchmarkClose: number | null = null

  return snapshots.map((snapshot) => {
    const equity = snapshot.equity
    const date = new Date(`${snapshot.snapshot_date}T00:00:00Z`)
    const target =
      baselineEquity != null
        ? round(baselineEquity * (1 + targetAnnualReturnPct * (dayOfYear(date) / daysInYear(date.getUTCFullYear()))), 2)
        : null

    const benchmarkClose = benchmarkByDate.get(snapshot.snapshot_date) ?? rollingBenchmarkClose
    if (benchmarkClose != null) {
      rollingBenchmarkClose = benchmarkClose
      if (firstBenchmarkClose == null) {
        firstBenchmarkClose = benchmarkClose
      }
    }

    return {
      date: snapshot.snapshot_date,
      equity,
      target,
      benchmark:
        baselineEquity != null && firstBenchmarkClose != null && benchmarkClose != null
          ? round(baselineEquity * (benchmarkClose / firstBenchmarkClose), 2)
          : null,
    }
  })
}

export function formatPauseStatus(value: string | null): { paused: boolean; label: string } {
  if (!value) {
    return { paused: false, label: 'Active' }
  }

  const pausedUntil = new Date(value)
  if (Number.isNaN(pausedUntil.getTime()) || pausedUntil.getTime() <= Date.now()) {
    return { paused: false, label: 'Active' }
  }

  return {
    paused: true,
    label: `Paused until ${pausedUntil.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })}`,
  }
}

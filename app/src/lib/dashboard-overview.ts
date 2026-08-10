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

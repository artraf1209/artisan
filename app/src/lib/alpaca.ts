export interface AlpacaAccountState {
  equity: number | null
  cash: number | null
  buying_power: number | null
  day_pnl: number | null
  day_pnl_pct: number | null
  last_equity: number | null
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export async function fetchAlpacaAccountState(): Promise<AlpacaAccountState> {
  const apiKey = process.env.ALPACA_API_KEY
  const apiSecret = process.env.ALPACA_API_SECRET
  const baseUrl = (process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '')

  if (!apiKey || !apiSecret) {
    throw new Error('Alpaca credentials are not configured.')
  }

  const response = await fetch(`${baseUrl}/v2/account`, {
    method: 'GET',
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error((await response.text()) || 'Failed to load Alpaca account state.')
  }

  const payload = (await response.json()) as Record<string, unknown>
  const equity = toNumber(payload.equity)
  const lastEquity = toNumber(payload.last_equity)
  const changeToday = toNumber(payload.change_today)
  const dayPnl =
    equity != null && lastEquity != null ? round(equity - lastEquity, 2) : null
  const dayPnlPct =
    equity != null && lastEquity != null && lastEquity !== 0
      ? round(((equity - lastEquity) / lastEquity) * 100, 2)
      : changeToday != null
        ? round(changeToday * 100, 2)
        : null

  return {
    equity,
    cash: toNumber(payload.cash),
    buying_power: toNumber(payload.buying_power),
    day_pnl: dayPnl,
    day_pnl_pct: dayPnlPct,
    last_equity: lastEquity,
  }
}

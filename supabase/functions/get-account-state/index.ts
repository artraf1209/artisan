// Read-only Alpaca account state (equity/cash/buying_power/day P&L), server-side.
// Per CLAUDE.md, no Next.js code may call the Alpaca API directly — this is the
// one place besides execute-trade that's allowed to, and it never places orders.

const JSON_HEADERS = { 'Content-Type': 'application/json' }

interface AlpacaAccountPayload {
  equity?: string | number | null
  cash?: string | number | null
  buying_power?: string | number | null
  last_equity?: string | number | null
  change_today?: string | number | null
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

Deno.serve(async (_req): Promise<Response> => {
  try {
    const apiKey = Deno.env.get('ALPACA_API_KEY') ?? ''
    const apiSecret = Deno.env.get('ALPACA_API_SECRET') ?? ''
    const baseUrl = (Deno.env.get('ALPACA_BASE_URL') ?? 'https://paper-api.alpaca.markets').replace(/\/$/, '')

    if (!apiKey || !apiSecret) {
      return jsonResponse({ error: 'Alpaca credentials are not configured.' }, 500)
    }

    const response = await fetch(`${baseUrl}/v2/account`, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      return jsonResponse({ error: text || 'Failed to load Alpaca account state.' }, response.status)
    }

    const payload = (await response.json()) as AlpacaAccountPayload
    const equity = toNumber(payload.equity)
    const lastEquity = toNumber(payload.last_equity)
    const changeToday = toNumber(payload.change_today)
    const dayPnl = equity != null && lastEquity != null ? round(equity - lastEquity, 2) : null
    const dayPnlPct =
      equity != null && lastEquity != null && lastEquity !== 0
        ? round(((equity - lastEquity) / lastEquity) * 100, 2)
        : changeToday != null
          ? round(changeToday * 100, 2)
          : null

    return jsonResponse({
      equity,
      cash: toNumber(payload.cash),
      buying_power: toNumber(payload.buying_power),
      day_pnl: dayPnl,
      day_pnl_pct: dayPnlPct,
      last_equity: lastEquity,
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

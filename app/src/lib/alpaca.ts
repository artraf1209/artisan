export interface AlpacaAccountState {
  equity: number | null
  cash: number | null
  buying_power: number | null
  day_pnl: number | null
  day_pnl_pct: number | null
  last_equity: number | null
}

/**
 * Proxies through the get-account-state edge function rather than calling
 * Alpaca directly — per CLAUDE.md, no Next.js code may call the Alpaca API
 * server-side; only Supabase edge functions may (execute-trade for orders,
 * this one for read-only account state). Same auth pattern already used by
 * /api/queue/[id]/approve's invokeExecuteTrade(): service-role-authenticated
 * fetch to /functions/v1/<name>.
 */
export async function fetchAlpacaAccountState(): Promise<AlpacaAccountState> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase function credentials are not configured.')
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/get-account-state`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    cache: 'no-store',
  })

  const body = (await response.json().catch(() => null)) as (AlpacaAccountState & { error?: string }) | null

  if (!response.ok || !body) {
    throw new Error(body?.error || 'Failed to load Alpaca account state.')
  }

  return {
    equity: body.equity ?? null,
    cash: body.cash ?? null,
    buying_power: body.buying_power ?? null,
    day_pnl: body.day_pnl ?? null,
    day_pnl_pct: body.day_pnl_pct ?? null,
    last_equity: body.last_equity ?? null,
  }
}

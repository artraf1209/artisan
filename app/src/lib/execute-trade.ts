export class RouteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export interface ExecuteTradeResponse {
  ok: boolean
  status: number
  body:
    | {
        error?: string
        error_type?: string
        status?: string
        execution_status?: string
        success?: boolean
        [key: string]: unknown
      }
    | null
  networkFailure: boolean
  networkError?: string
}

async function postToExecuteTrade(payload: Record<string, unknown>): Promise<ExecuteTradeResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new RouteError('Supabase function credentials are not configured.', 500)
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/execute-trade`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const body = (await response.json().catch(() => null)) as ExecuteTradeResponse['body']

    return {
      ok: response.ok,
      status: response.status,
      body,
      networkFailure: false,
    }
  } catch (error) {
    // The fetch() call itself threw (network failure, DNS issue, edge-function cold
    // start timeout) -- distinct from execute-trade responding with a non-ok status.
    // Callers should resolve their own state explicitly on this path rather than
    // leaving anything stuck at a transient status with no audit trail.
    return {
      ok: false,
      status: 0,
      body: null,
      networkFailure: true,
      networkError: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Places (or resumes submission of) a trade_intent's order. */
export async function invokeExecuteTrade(
  tradeIntentId: string,
  overrides?: {
    shares?: number
    stop_price?: number
    target_price?: number
  },
): Promise<ExecuteTradeResponse> {
  return postToExecuteTrade({
    trade_intent_id: tradeIntentId,
    ...(overrides ? { overrides } : {}),
  })
}

/** Invokes one of execute-trade's position-management actions (e.g. replace_leg,
 * cancel_position_orders) rather than placing a new order for a trade_intent. */
export async function invokeExecuteTradeAction(payload: Record<string, unknown>): Promise<ExecuteTradeResponse> {
  return postToExecuteTrade(payload)
}

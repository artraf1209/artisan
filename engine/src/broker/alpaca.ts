import type { IBroker, Order, Fill, BrokerPosition } from './index'

export class AlpacaBroker implements IBroker {
  private baseUrl: string
  private headers: Record<string, string>

  constructor() {
    this.baseUrl = process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets'
    this.headers = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
      'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
      'Content-Type': 'application/json',
    }
  }

  async submitOrder(order: Order): Promise<Fill> {
    const res = await fetch(`${this.baseUrl}/v2/orders`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        symbol: order.symbol,
        qty: order.qty,
        side: order.side,
        type: order.type,
        time_in_force: 'day',
        ...(order.limitPrice ? { limit_price: order.limitPrice } : {}),
      }),
    })

    if (!res.ok) throw new Error(`Alpaca order error: ${await res.text()}`)
    const data = await res.json()

    return {
      brokerOrderId: data.id,
      filledPrice: Number(data.filled_avg_price ?? data.limit_price ?? 0),
      filledAt: data.filled_at ? new Date(data.filled_at) : new Date(),
    }
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const res = await fetch(`${this.baseUrl}/v2/positions`, { headers: this.headers })
    if (!res.ok) throw new Error(`Alpaca positions error: ${await res.text()}`)
    const data: Array<Record<string, string>> = await res.json()

    return data.map((p) => ({
      symbol: p.symbol,
      qty: Number(p.qty),
      avgEntryPrice: Number(p.avg_entry_price),
      currentPrice: Number(p.current_price),
      unrealizedPnl: Number(p.unrealized_pl),
    }))
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    await fetch(`${this.baseUrl}/v2/orders/${brokerOrderId}`, {
      method: 'DELETE',
      headers: this.headers,
    })
  }
}

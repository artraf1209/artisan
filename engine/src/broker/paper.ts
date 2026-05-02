import type { IBroker, Order, Fill, BrokerPosition } from './index'

export class PaperBroker implements IBroker {
  private orders = new Map<string, { order: Order; filledAt: Date }>()
  private positions = new Map<string, BrokerPosition>()

  async submitOrder(order: Order): Promise<Fill> {
    const id = crypto.randomUUID()
    const filledAt = new Date()
    this.orders.set(id, { order, filledAt })

    const existing = this.positions.get(order.symbol)
    const price = order.limitPrice ?? 100
    if (order.side === 'buy') {
      if (existing) {
        const totalQty = existing.qty + order.qty
        const avgEntry = (existing.avgEntryPrice * existing.qty + price * order.qty) / totalQty
        this.positions.set(order.symbol, { ...existing, qty: totalQty, avgEntryPrice: avgEntry })
      } else {
        this.positions.set(order.symbol, {
          symbol: order.symbol,
          qty: order.qty,
          avgEntryPrice: price,
          currentPrice: price,
          unrealizedPnl: 0,
        })
      }
    } else if (existing) {
      const newQty = existing.qty - order.qty
      if (newQty <= 0) {
        this.positions.delete(order.symbol)
      } else {
        this.positions.set(order.symbol, { ...existing, qty: newQty })
      }
    }

    console.log(`[paper] ${order.side.toUpperCase()} ${order.qty} ${order.symbol} @ $${price}`)
    return { brokerOrderId: id, filledPrice: price, filledAt }
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return Array.from(this.positions.values())
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    this.orders.delete(brokerOrderId)
  }
}

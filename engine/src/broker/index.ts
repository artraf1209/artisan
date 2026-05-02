export interface Order {
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  type: 'market' | 'limit'
  limitPrice?: number
}

export interface Fill {
  brokerOrderId: string
  filledPrice: number
  filledAt: Date
}

export interface BrokerPosition {
  symbol: string
  qty: number
  avgEntryPrice: number
  currentPrice: number
  unrealizedPnl: number
}

export interface IBroker {
  submitOrder(order: Order): Promise<Fill>
  getPositions(): Promise<BrokerPosition[]>
  cancelOrder(brokerOrderId: string): Promise<void>
}

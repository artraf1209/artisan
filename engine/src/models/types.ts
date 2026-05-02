export interface Bar {
  symbol: string
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Signal {
  model: string
  symbol: string
  direction: 'long' | 'short' | 'flat'
  confidence: number
  metadata?: Record<string, unknown>
}

export interface ModelConfig {
  symbols: string[]
}

export interface IModel {
  name: string
  evaluate(bars: Bar[]): Signal | null
}

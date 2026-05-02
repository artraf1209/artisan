import type { Bar, IModel, Signal } from './types'

const SHORT_WINDOW = 10
const LONG_WINDOW = 30
const MIN_CONFIDENCE = 0.65

function sma(bars: Bar[], window: number): number {
  const slice = bars.slice(-window)
  return slice.reduce((sum, b) => sum + b.close, 0) / slice.length
}

export class MomentumModel implements IModel {
  name = 'momentum_v1'

  evaluate(bars: Bar[]): Signal | null {
    if (bars.length < LONG_WINDOW || bars.length === 0) return null

    const symbol = bars[0].symbol
    const shortSma = sma(bars, SHORT_WINDOW)
    const longSma = sma(bars, LONG_WINDOW)
    const ratio = shortSma / longSma

    if (ratio > 1.02) {
      const confidence = Math.min(0.95, MIN_CONFIDENCE + (ratio - 1.02) * 10)
      return { model: this.name, symbol, direction: 'long', confidence }
    }

    if (ratio < 0.98) {
      const confidence = Math.min(0.95, MIN_CONFIDENCE + (0.98 - ratio) * 10)
      return { model: this.name, symbol, direction: 'short', confidence }
    }

    return null
  }
}

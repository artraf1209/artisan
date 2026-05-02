import { AlpacaBroker } from './broker/alpaca'
import { PaperBroker } from './broker/paper'
import { MomentumModel } from './models/momentum'
import { supabase } from './lib/supabase'
import { logger } from './lib/logger'
import type { Bar } from './models/types'

const POLL_INTERVAL_MS = 60_000
const SYMBOLS = ['AAPL', 'MSFT', 'BTCUSD', 'ETHUSD']
const isPaper = process.env.PAPER_TRADING !== 'false'

const broker = isPaper ? new PaperBroker() : new AlpacaBroker()
const models = [new MomentumModel()]

async function fetchBars(symbol: string): Promise<Bar[]> {
  const dataBase = 'https://data.alpaca.markets'
  const headers = {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
    'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
  }

  const end = new Date().toISOString()
  const start = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const res = await fetch(
    `${dataBase}/v2/stocks/${symbol}/bars?timeframe=1Min&start=${start}&end=${end}&limit=60`,
    { headers },
  )

  if (!res.ok) {
    logger.warn(`Failed to fetch bars for ${symbol}: ${res.statusText}`)
    return []
  }

  const { bars } = await res.json()
  return (bars ?? []).map((b: Record<string, unknown>) => ({
    symbol,
    timestamp: b.t,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }))
}

async function syncPositions() {
  try {
    const positions = await broker.getPositions()
    for (const p of positions) {
      await supabase.from('positions').upsert(
        {
          symbol: p.symbol,
          quantity: p.qty,
          avg_entry_price: p.avgEntryPrice,
          current_price: p.currentPrice,
          unrealized_pnl: p.unrealizedPnl,
          paper: isPaper,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'symbol' },
      )
    }
  } catch (err) {
    logger.error('Position sync failed', { err: String(err) })
  }
}

async function runCycle() {
  logger.info('Engine cycle started', { symbols: SYMBOLS, paper: isPaper })

  for (const symbol of SYMBOLS) {
    try {
      const bars = await fetchBars(symbol)
      if (bars.length === 0) continue

      for (const model of models) {
        const signal = model.evaluate(bars)
        if (!signal || signal.direction === 'flat') continue

        await supabase.from('signals').insert({
          model: signal.model,
          symbol: signal.symbol,
          direction: signal.direction,
          confidence: signal.confidence,
          metadata: signal.metadata ?? null,
        })

        logger.info(`Signal emitted: ${signal.direction} ${symbol}`, {
          confidence: signal.confidence,
          model: signal.model,
        })
      }
    } catch (err) {
      logger.error(`Error processing ${symbol}`, { err: String(err) })
    }
  }

  await syncPositions()
}

async function main() {
  logger.info(`Artisan engine starting (paper=${isPaper})`)

  await runCycle()

  setInterval(async () => {
    await runCycle()
  }, POLL_INTERVAL_MS)
}

main()

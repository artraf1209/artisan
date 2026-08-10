import { toNumber } from '@/lib/queue'
import type {
  FundamentalOutput,
  PositionReviewEntry,
  SentimentOutput,
  SynthesisRecommendationEntry,
  TechnicalOutput,
} from '@/lib/recommendation-detail'

export type LogRange = '7d' | '30d'

export function rangeToDays(range: LogRange | undefined): number {
  return range === '7d' ? 7 : 30
}

export function sinceDateForRange(range: LogRange | undefined): string {
  const days = rangeToDays(range)
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  return since.toISOString()
}

export interface LogEntry<T> {
  id: string
  symbol: string
  model: string | null
  createdAt: string
  data: T
}

interface RawAgentAnalysisRow {
  id: string
  symbol: string | null
  output: unknown
  model: string | null
  created_at: string
}

const RAW_COLUMNS = 'id, symbol, output, model, created_at'
const DEFAULT_LIMIT = 200

async function loadRawRows(
  supabase: any,
  agentType: string,
  { symbol, range }: { symbol?: string; range?: LogRange },
): Promise<RawAgentAnalysisRow[]> {
  let query = supabase
    .from('agent_analyses')
    .select(RAW_COLUMNS)
    .eq('agent_type', agentType)
    .gte('created_at', sinceDateForRange(range))
    .order('created_at', { ascending: false })
    .limit(DEFAULT_LIMIT)

  if (symbol) {
    query = query.eq('symbol', symbol)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as RawAgentAnalysisRow[]
}

/** Fundamental/technical/sentiment rows already carry one symbol per row —
 * no flattening needed. */
async function loadPerSymbolLog<T>(
  supabase: any,
  agentType: string,
  filters: { symbol?: string; range?: LogRange },
): Promise<LogEntry<T>[]> {
  const rows = await loadRawRows(supabase, agentType, filters)
  return rows
    .filter((row) => row.symbol != null)
    .map((row) => ({
      id: row.id,
      symbol: row.symbol as string,
      model: row.model,
      createdAt: row.created_at,
      data: row.output as T,
    }))
}

export function loadFundamentalLog(supabase: any, filters: { symbol?: string; range?: LogRange }) {
  return loadPerSymbolLog<FundamentalOutput>(supabase, 'fundamental', filters)
}

export function loadTechnicalLog(supabase: any, filters: { symbol?: string; range?: LogRange }) {
  return loadPerSymbolLog<TechnicalOutput>(supabase, 'technical', filters)
}

export function loadSentimentLog(supabase: any, filters: { symbol?: string; range?: LogRange }) {
  return loadPerSymbolLog<SentimentOutput>(supabase, 'sentiment', filters)
}

/** Synthesis and position-review rows are run-level (symbol is NULL) — the
 * per-symbol data lives inside output.recommendations[] / .position_reviews[].
 * Flatten each run's array into individual log entries, then apply the
 * symbol filter in-memory since it can't be pushed into the query. */
async function loadRunLevelLog<Item, Entry>(
  supabase: any,
  agentType: string,
  filters: { symbol?: string; range?: LogRange },
  arrayKey: 'recommendations' | 'position_reviews',
  itemSymbol: (item: Item) => string,
  toEntry: (item: Item) => Entry,
): Promise<LogEntry<Entry>[]> {
  const rows = await loadRawRows(supabase, agentType, { range: filters.range })

  const entries: LogEntry<Entry>[] = []
  for (const row of rows) {
    const items = ((row.output as Record<string, unknown> | null)?.[arrayKey] ?? []) as Item[]
    for (const item of items) {
      const symbol = itemSymbol(item)
      if (filters.symbol && symbol !== filters.symbol) {
        continue
      }
      entries.push({
        id: `${row.id}-${symbol}`,
        symbol,
        model: row.model,
        createdAt: row.created_at,
        data: toEntry(item),
      })
    }
  }

  return entries
}

export function loadSynthesisLog(supabase: any, filters: { symbol?: string; range?: LogRange }) {
  return loadRunLevelLog<SynthesisRecommendationEntry, SynthesisRecommendationEntry>(
    supabase,
    'synthesis',
    filters,
    'recommendations',
    (item) => item.symbol,
    (item) => item,
  )
}

export function loadPositionReviewLog(supabase: any, filters: { symbol?: string; range?: LogRange }) {
  return loadRunLevelLog<PositionReviewEntry, PositionReviewEntry>(
    supabase,
    'position_review',
    filters,
    'position_reviews',
    (item) => item.symbol,
    (item) => ({
      ...item,
      suggested_new_stop: toNumber(item.suggested_new_stop),
      suggested_new_target: toNumber(item.suggested_new_target),
    }),
  )
}

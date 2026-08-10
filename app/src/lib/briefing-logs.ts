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

interface SynthesisRunOutput {
  recommendations?: SynthesisRecommendationEntry[]
  submitted_recommendations?: SynthesisRecommendationEntry[]
  run_summary?: string
  no_recommendation_reason?: string | null
  enter_candidates_considered?: string[]
  watch_candidates_considered?: string[]
}

export type SynthesisLogData =
  | ({
      kind: 'summary'
      run_summary: string
      no_recommendation_reason: string | null
      recommendation_count: number
      enter_candidates_considered: string[]
      watch_candidates_considered: string[]
    })
  | ({ kind: 'recommendation' } & SynthesisRecommendationEntry)

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
  return loadSynthesisEntries(supabase, filters)
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

async function loadSynthesisEntries(
  supabase: any,
  filters: { symbol?: string; range?: LogRange },
): Promise<LogEntry<SynthesisLogData>[]> {
  const rows = await loadRawRows(supabase, 'synthesis', { range: filters.range })

  const entries: LogEntry<SynthesisLogData>[] = []
  for (const row of rows) {
    const output = (row.output as SynthesisRunOutput | null) ?? {}
    const recommendations = Array.isArray(output.recommendations) ? output.recommendations : []
    const enterCandidates = Array.isArray(output.enter_candidates_considered)
      ? output.enter_candidates_considered
      : []
    const watchCandidates = Array.isArray(output.watch_candidates_considered)
      ? output.watch_candidates_considered
      : []

    const consideredSymbols = new Set<string>([
      ...enterCandidates,
      ...watchCandidates,
      ...recommendations.map((item) => item.symbol),
    ])
    const summaryMatchesFilter = !filters.symbol || consideredSymbols.has(filters.symbol)
    const shouldIncludeSummary =
      summaryMatchesFilter &&
      (recommendations.length === 0 || Boolean(output.run_summary) || Boolean(output.no_recommendation_reason))

    if (shouldIncludeSummary) {
      entries.push({
        id: `${row.id}-summary`,
        symbol: 'RUN',
        model: row.model,
        createdAt: row.created_at,
        data: {
          kind: 'summary',
          run_summary: output.run_summary ?? 'No synthesis summary was captured for this run.',
          no_recommendation_reason: output.no_recommendation_reason ?? null,
          recommendation_count: recommendations.length,
          enter_candidates_considered: enterCandidates,
          watch_candidates_considered: watchCandidates,
        },
      })
    }

    for (const item of recommendations) {
      if (filters.symbol && item.symbol !== filters.symbol) {
        continue
      }
      entries.push({
        id: `${row.id}-${item.symbol}`,
        symbol: item.symbol,
        model: row.model,
        createdAt: row.created_at,
        data: {
          kind: 'recommendation',
          ...item,
        },
      })
    }
  }

  return entries
}

import { computeOverrideDeltas } from '@/lib/orders'

export interface RecommendationHistoryRow {
  id: string
  symbol: string
  action: string
  conviction: string | null
  thesis: string | null
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  shares: number | null
  status: string
  created_at: string
  reviewed_at: string | null
  review_note: string | null
  /** Non-empty only for an approved 'enter' recommendation where a human
   * changed shares/stop/target at approval time -- see computeOverrideDeltas. */
  override_deltas: string[]
}

export interface RecommendationHistoryPage {
  rows: RecommendationHistoryRow[]
  total: number
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Every recommendation the pipeline has ever produced -- not just today's
 * pending queue -- with what was recommended, what happened to it, when, and
 * (for an approved entry) what a human edited before it went out. Reused by
 * the New Recommendations page's history section, one page at a time. */
export async function loadRecommendationHistory(
  supabase: any,
  options: { page?: number; pageSize?: number } = {},
): Promise<RecommendationHistoryPage> {
  const pageSize = options.pageSize ?? 5
  const page = Math.max(1, options.page ?? 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const {
    data: recommendationRows,
    error: recommendationError,
    count,
  } = await supabase
    .from('recommendations')
    .select(
      'id, symbol, action, conviction, thesis, entry_price, stop_price, target_price, shares, status, created_at, reviewed_at, review_note',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  if (recommendationError) {
    throw new Error(recommendationError.message)
  }

  const rows = (recommendationRows ?? []) as Array<Record<string, unknown>>

  // Overrides only ever exist for an approved 'enter' recommendation that made
  // it into a trade_intent -- everything else (pending/rejected/expired/watch)
  // has nothing to diff against, so skip the join for those.
  const approvedEnterIds = rows
    .filter((row) => row.status === 'approved' && row.action === 'enter')
    .map((row) => String(row.id))

  const { data: intentRows, error: intentError } =
    approvedEnterIds.length > 0
      ? await supabase.from('trade_intents').select('signal_id, overrides').in('signal_id', approvedEnterIds)
      : { data: [], error: null }

  if (intentError) {
    throw new Error(intentError.message)
  }

  const overridesBySignalId = new Map<string, Record<string, unknown>>()
  for (const intent of (intentRows ?? []) as Array<{
    signal_id: string | null
    overrides: Record<string, unknown> | null
  }>) {
    if (intent.signal_id && intent.overrides) {
      overridesBySignalId.set(intent.signal_id, intent.overrides)
    }
  }

  const mapped = rows.map((row) => {
    const id = String(row.id)
    const recommended = {
      shares: toNumber(row.shares),
      stop_price: toNumber(row.stop_price),
      target_price: toNumber(row.target_price),
    }
    const overrides = overridesBySignalId.get(id) ?? {}

    return {
      id,
      symbol: String(row.symbol),
      action: String(row.action),
      conviction: (row.conviction as string | null) ?? null,
      thesis: (row.thesis as string | null) ?? null,
      entry_price: toNumber(row.entry_price),
      stop_price: recommended.stop_price,
      target_price: recommended.target_price,
      shares: recommended.shares,
      status: String(row.status),
      created_at: String(row.created_at),
      reviewed_at: (row.reviewed_at as string | null) ?? null,
      review_note: (row.review_note as string | null) ?? null,
      override_deltas: computeOverrideDeltas(overrides, recommended),
    }
  })

  return { rows: mapped, total: count ?? mapped.length }
}

export interface PositionReviewHistoryRow {
  id: string
  symbol: string
  recommended_action: string
  reasoning: string | null
  new_stop_price: number | null
  new_target_price: number | null
  trim_shares: number | null
  status: string
  created_at: string
  reviewed_at: string | null
  review_note: string | null
}

export interface PositionReviewHistoryPage {
  rows: PositionReviewHistoryRow[]
  total: number
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Every position review ever generated -- pending, approved, rejected,
 * auto-applied (risk-reducing actions skip the approval queue and land
 * straight at a resolved status), or expired. Unlike recommendations,
 * position-review approval has no shares/stop/target edit affordance today
 * (see PositionActionCard), so there's no override-delta concept to compute
 * here -- new_stop_price/new_target_price are simply what the review itself
 * recommended. Reused by the Position Actions page's history section, one
 * page at a time. */
export async function loadPositionReviewHistory(
  supabase: any,
  options: { page?: number; pageSize?: number } = {},
): Promise<PositionReviewHistoryPage> {
  const pageSize = options.pageSize ?? 5
  const page = Math.max(1, options.page ?? 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from('position_reviews')
    .select(
      'id, symbol, recommended_action, reasoning, new_stop_price, new_target_price, trim_shares, status, created_at, reviewed_at, review_note',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    throw new Error(error.message)
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    symbol: String(row.symbol),
    recommended_action: String(row.recommended_action),
    reasoning: (row.reasoning as string | null) ?? null,
    new_stop_price: toNumber(row.new_stop_price),
    new_target_price: toNumber(row.new_target_price),
    trim_shares: toNumber(row.trim_shares),
    status: String(row.status),
    created_at: String(row.created_at),
    reviewed_at: (row.reviewed_at as string | null) ?? null,
    review_note: (row.review_note as string | null) ?? null,
  }))

  return { rows, total: count ?? rows.length }
}

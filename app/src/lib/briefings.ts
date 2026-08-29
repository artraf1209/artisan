export type BriefingRecord = {
  id: string
  run_id: string | null
  briefing_date: string
  regime_line: string | null
  urgent_flags: string[]
  new_recommendations_summary: string | null
  position_actions_summary: string | null
  outcomes_note: string | null
  portfolio_state_line: string | null
  full_text: string
  model: string | null
  cost_usd: number | string | null
  created_at: string
}

export function formatStoredCalendarDate(value: string): string {
  if (!value) {
    return 'No briefing date'
  }

  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function normalizeUrgentFlags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export function normalizeBriefingRecord(row: Record<string, unknown>): BriefingRecord {
  return {
    id: String(row.id ?? ''),
    run_id: typeof row.run_id === 'string' ? row.run_id : null,
    briefing_date: typeof row.briefing_date === 'string' ? row.briefing_date : '',
    regime_line: typeof row.regime_line === 'string' ? row.regime_line : null,
    urgent_flags: normalizeUrgentFlags(row.urgent_flags),
    new_recommendations_summary:
      typeof row.new_recommendations_summary === 'string' ? row.new_recommendations_summary : null,
    position_actions_summary:
      typeof row.position_actions_summary === 'string' ? row.position_actions_summary : null,
    outcomes_note: typeof row.outcomes_note === 'string' ? row.outcomes_note : null,
    portfolio_state_line:
      typeof row.portfolio_state_line === 'string' ? row.portfolio_state_line : null,
    full_text: typeof row.full_text === 'string' ? row.full_text : '',
    model: typeof row.model === 'string' ? row.model : null,
    cost_usd: row.cost_usd == null ? null : (row.cost_usd as number | string),
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
  }
}

export function normalizeBriefingRecords(rows: Array<Record<string, unknown>>): BriefingRecord[] {
  return rows.map(normalizeBriefingRecord)
}

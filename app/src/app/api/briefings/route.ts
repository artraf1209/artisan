import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeBriefingRecords } from '@/lib/briefings'

export async function GET() {
  const supabase = (await createServerClient()) as any
  const { data, error } = await supabase
    .from('briefings')
    .select(
      'id, run_id, briefing_date, regime_line, urgent_flags, new_recommendations_summary, position_actions_summary, outcomes_note, portfolio_state_line, full_text, model, cost_usd, created_at',
    )
    .order('briefing_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(normalizeBriefingRecords((data ?? []) as Array<Record<string, unknown>>))
}

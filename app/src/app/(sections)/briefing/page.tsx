import { createServerClient } from '@/lib/supabase/server'
import BriefingList from '@/components/briefings/BriefingList'
import { normalizeBriefingRecords, type BriefingRecord } from '@/lib/briefings'

export const dynamic = 'force-dynamic'

export default async function DailyDigestPage() {
  const supabase = (await createServerClient()) as any
  const { data, error } = await supabase
    .from('briefings')
    .select(
      'id, run_id, briefing_date, regime_line, urgent_flags, new_recommendations_summary, position_actions_summary, outcomes_note, portfolio_state_line, full_text, model, cost_usd, created_at',
    )
    .order('briefing_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30)

  const briefings = normalizeBriefingRecords((data ?? []) as Array<Record<string, unknown>>)
  const latestBriefing = briefings[0] ?? null
  const urgentBriefingCount = briefings.filter((briefing) => briefing.urgent_flags.length > 0).length

  return (
    <>
      {error ? (
        <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          {error.message}
        </p>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-3">
        <SummaryCard
          label="Loaded briefings"
          value={String(briefings.length)}
          detail="Most recent daily digests returned from the dedicated briefings table."
        />
        <SummaryCard
          label="Urgent digests"
          value={String(urgentBriefingCount)}
          detail="Briefings in the loaded set that carry one or more urgent flags."
        />
        <SummaryCard
          label="Latest date"
          value={latestBriefing?.briefing_date ?? 'No rows'}
          detail={latestBriefing?.regime_line ?? 'No briefing row has been written yet.'}
        />
      </section>

      <BriefingList briefings={briefings as BriefingRecord[]} />
    </>
  )
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <article className="rounded-[1.5rem] border border-border bg-card/90 p-4 shadow-[0_16px_35px_rgba(0,0,0,0.22)]">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </article>
  )
}

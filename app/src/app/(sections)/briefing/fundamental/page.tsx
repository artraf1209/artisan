import { createServerClient } from '@/lib/supabase/server'
import { loadFundamentalLog, type LogRange } from '@/lib/briefing-logs'
import { bucketFundamental } from '@/lib/recommendation-detail'
import AgentLogCard from '@/components/briefing/AgentLogCard'
import LogFilterBar from '@/components/briefing/LogFilterBar'

export const dynamic = 'force-dynamic'

type SearchParams = { symbol?: string | string[]; range?: string | string[] }

function firstValue(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : value?.[0]
}

export default async function FundamentalAgentLogPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const symbol = firstValue(params?.symbol)?.trim().toUpperCase() || undefined
  const range: LogRange = firstValue(params?.range) === '7d' ? '7d' : '30d'

  const supabase = (await createServerClient()) as any
  const entries = await loadFundamentalLog(supabase, { symbol, range })

  return (
    <>
      <LogFilterBar action="/briefing/fundamental" symbol={symbol} range={range} />

      {entries.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No fundamental analyses in this window.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The fundamental analyst writes one row per symbol per pipeline run — try widening the range.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <AgentLogCard
              key={entry.id}
              symbol={entry.symbol}
              createdAt={entry.createdAt}
              model={entry.model}
              qualifier={{
                label: 'Quality',
                value: entry.data.quality_assessment,
                tone: bucketFundamental(entry.data.quality_assessment),
              }}
              summary={entry.data.summary}
              fields={[{ label: 'Trend vs prior run', value: entry.data.trend_vs_prior_run.replaceAll('_', ' ') }]}
              listFields={[
                { label: 'Key drivers', items: entry.data.key_drivers },
                { label: 'Red flags', items: entry.data.red_flags },
              ]}
              historicalPrecedent={entry.data.historical_precedent}
            />
          ))}
        </div>
      )}
    </>
  )
}

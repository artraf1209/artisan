import { createServerClient } from '@/lib/supabase/server'
import { loadTechnicalLog, type LogRange } from '@/lib/briefing-logs'
import { bucketTechnical } from '@/lib/recommendation-detail'
import AgentLogCard from '@/components/briefing/AgentLogCard'
import LogFilterBar from '@/components/briefing/LogFilterBar'

export const dynamic = 'force-dynamic'

type SearchParams = { symbol?: string | string[]; range?: string | string[] }

function firstValue(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : value?.[0]
}

export default async function TechnicalAgentLogPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const symbol = firstValue(params?.symbol)?.trim().toUpperCase() || undefined
  const range: LogRange = firstValue(params?.range) === '7d' ? '7d' : '30d'

  const supabase = (await createServerClient()) as any
  const entries = await loadTechnicalLog(supabase, { symbol, range })

  return (
    <>
      <LogFilterBar action="/briefing/technical" symbol={symbol} range={range} />

      {entries.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No technical analyses in this window.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The technical analyst writes one row per symbol per pipeline run — try widening the range.
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
                label: 'Setup',
                value: entry.data.setup_quality,
                tone: bucketTechnical(entry.data.setup_quality),
              }}
              summary={entry.data.summary}
              fields={[
                { label: 'Confirmation strength', value: entry.data.confirmation_strength },
                { label: 'Regime fit', value: entry.data.regime_fit },
              ]}
              listFields={[
                {
                  label: 'Invalidation note',
                  items: entry.data.technical_invalidation_note ? [entry.data.technical_invalidation_note] : [],
                },
              ]}
              historicalPrecedent={entry.data.historical_precedent}
            />
          ))}
        </div>
      )}
    </>
  )
}

import { createServerClient } from '@/lib/supabase/server'
import { loadSentimentLog, type LogRange } from '@/lib/briefing-logs'
import { bucketSentiment } from '@/lib/recommendation-detail'
import AgentLogCard from '@/components/briefing/AgentLogCard'
import LogFilterBar from '@/components/briefing/LogFilterBar'

export const dynamic = 'force-dynamic'

type SearchParams = { symbol?: string | string[]; range?: string | string[] }

function firstValue(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : value?.[0]
}

export default async function SentimentAgentLogPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const symbol = firstValue(params?.symbol)?.trim().toUpperCase() || undefined
  const range: LogRange = firstValue(params?.range) === '7d' ? '7d' : '30d'

  const supabase = (await createServerClient()) as any
  const entries = await loadSentimentLog(supabase, { symbol, range })

  return (
    <>
      <LogFilterBar action="/briefing/sentiment" symbol={symbol} range={range} />

      {entries.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No sentiment analyses in this window.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The sentiment analyst writes one row per symbol per pipeline run — try widening the range.
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
                label: 'Direction',
                value: entry.data.sentiment_direction,
                tone: bucketSentiment(entry.data.sentiment_direction),
              }}
              summary={entry.data.summary}
              fields={[{ label: 'Materiality', value: entry.data.materiality }]}
              listFields={[
                { label: 'Catalysts', items: entry.data.catalysts_identified },
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

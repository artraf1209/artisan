import { createServerClient } from '@/lib/supabase/server'
import { loadSynthesisLog, type LogRange, type SynthesisLogData } from '@/lib/briefing-logs'
import type { SentimentBucket } from '@/lib/recommendation-detail'
import AgentLogCard from '@/components/briefing/AgentLogCard'
import LogFilterBar from '@/components/briefing/LogFilterBar'

export const dynamic = 'force-dynamic'

type SearchParams = { symbol?: string | string[]; range?: string | string[] }

function firstValue(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : value?.[0]
}

function bucketConviction(value: string): SentimentBucket | null {
  if (value === 'high') return 'positive'
  if (value === 'medium') return 'neutral'
  if (value === 'low') return 'negative'
  return null
}

export default async function SynthesisAgentLogPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const symbol = firstValue(params?.symbol)?.trim().toUpperCase() || undefined
  const range: LogRange = firstValue(params?.range) === '7d' ? '7d' : '30d'

  const supabase = (await createServerClient()) as any
  const entries = await loadSynthesisLog(supabase, { symbol, range })

  const renderEntry = (entry: { id: string; symbol: string; model: string | null; createdAt: string; data: SynthesisLogData }) => {
    if (entry.data.kind === 'summary') {
      return (
        <AgentLogCard
          key={entry.id}
          symbol="Run Summary"
          createdAt={entry.createdAt}
          model={entry.model}
          summary={entry.data.run_summary}
          fields={[
            {
              label: 'Outcome',
              value:
                entry.data.recommendation_count > 0
                  ? `${entry.data.recommendation_count} recommendation(s)`
                  : 'No recommendations',
            },
          ]}
          listFields={[
            {
              label: 'No-trade reason',
              items: entry.data.no_recommendation_reason ? [entry.data.no_recommendation_reason] : [],
            },
            { label: 'Enter candidates considered', items: entry.data.enter_candidates_considered },
            { label: 'Watch candidates considered', items: entry.data.watch_candidates_considered },
          ]}
        />
      )
    }

    return (
      <AgentLogCard
        key={entry.id}
        symbol={entry.symbol}
        createdAt={entry.createdAt}
        model={entry.model}
        qualifier={{
          label: 'Conviction',
          value: entry.data.conviction,
          tone: bucketConviction(entry.data.conviction),
        }}
        summary={entry.data.thesis}
        fields={[{ label: 'Action', value: entry.data.action }]}
        listFields={[
          { label: 'Invalidation conditions', items: entry.data.invalidation_conditions },
          { label: 'Redundancy note', items: entry.data.redundancy_note ? [entry.data.redundancy_note] : [] },
        ]}
        historicalPrecedent={entry.data.historical_precedent}
      />
    )
  }

  return (
    <>
      <LogFilterBar action="/briefing/synthesis" symbol={symbol} range={range} />

      {entries.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No synthesis entries in this window.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Synthesis writes one recommendation per eligible symbol per pipeline run — try widening the range.
          </p>
        </div>
      ) : (
        <div className="space-y-4">{entries.map(renderEntry)}</div>
      )}
    </>
  )
}

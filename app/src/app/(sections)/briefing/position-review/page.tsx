import { createServerClient } from '@/lib/supabase/server'
import { loadPositionReviewLog, type LogRange } from '@/lib/briefing-logs'
import { formatCurrency } from '@/lib/utils'
import AgentLogCard from '@/components/briefing/AgentLogCard'
import LogFilterBar from '@/components/briefing/LogFilterBar'

export const dynamic = 'force-dynamic'

type SearchParams = { symbol?: string | string[]; range?: string | string[] }

function firstValue(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : value?.[0]
}

export default async function PositionReviewAgentLogPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const symbol = firstValue(params?.symbol)?.trim().toUpperCase() || undefined
  const range: LogRange = firstValue(params?.range) === '7d' ? '7d' : '30d'

  const supabase = (await createServerClient()) as any
  const entries = await loadPositionReviewLog(supabase, { symbol, range })

  return (
    <>
      <LogFilterBar action="/briefing/position-review" symbol={symbol} range={range} />

      {entries.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No position reviews in this window.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The position review agent only writes an entry for open positions it evaluated that run — try widening
            the range.
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
                label: 'Action',
                value: entry.data.recommended_action.replaceAll('_', ' '),
                tone: null,
              }}
              summary={entry.data.reasoning}
              fields={[
                { label: 'Suggested new stop', value: formatCurrency(entry.data.suggested_new_stop) },
                { label: 'Suggested new target', value: formatCurrency(entry.data.suggested_new_target) },
              ]}
              historicalPrecedent={entry.data.historical_precedent}
            />
          ))}
        </div>
      )}
    </>
  )
}

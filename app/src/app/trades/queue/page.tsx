import Navbar from '@/components/shared/Navbar'
import ApprovalQueue from '@/components/trades/ApprovalQueue'
import { createServerClient } from '@/lib/supabase/server'
import type { QueueSignal, ThesisAnalysis } from '@/types/hybrid'

export const dynamic = 'force-dynamic'

export default async function TradeQueuePage() {
  const supabase = (await createServerClient()) as any
  const { data, error } = await supabase
    .from('signal_events')
    .select(`
      *,
      llm_analyses(*)
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  const signals: QueueSignal[] = ((data ?? []) as any[]).map((row) => {
    const thesis = Array.isArray(row.llm_analyses)
      ? (row.llm_analyses.find(
          (analysis: { analysis_type?: string }) => analysis.analysis_type === 'thesis',
        ) as ThesisAnalysis | undefined)
      : undefined

    return {
      ...row,
      thesis: thesis ?? null,
    } as QueueSignal
  })

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Approval Queue</h1>
          <p className="text-sm text-muted-foreground">
            Review pending hybrid-engine signals before they become trade intents.
          </p>
          {error ? <p className="text-sm text-loss">{error.message}</p> : null}
        </div>
        <ApprovalQueue signals={signals} />
      </main>
    </div>
  )
}

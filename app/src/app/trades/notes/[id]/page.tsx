import Navbar from '@/components/shared/Navbar'
import ThesisNote from '@/components/trades/ThesisNote'
import { createServerClient } from '@/lib/supabase/server'
import type { QueueSignal, ThesisAnalysis } from '@/types/hybrid'

export const dynamic = 'force-dynamic'

export default async function TradeNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createServerClient()) as any

  const { data, error } = await supabase
    .from('signal_events')
    .select(`
      *,
      llm_analyses(*)
    `)
    .eq('id', id)
    .single()

  const signal = data as (QueueSignal & { llm_analyses?: ThesisAnalysis[] }) | null
  const thesis =
    signal && Array.isArray(signal.llm_analyses)
      ? ((signal.llm_analyses.find((analysis) => analysis.analysis_type === 'thesis') as ThesisAnalysis | undefined) ?? null)
      : null

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 space-y-6">
        {error || !signal ? (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
            <p className="text-base font-medium text-foreground">Signal note not found.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The requested signal or thesis note is unavailable.
            </p>
          </div>
        ) : (
          <ThesisNote signal={signal} thesis={thesis} />
        )}
      </main>
    </div>
  )
}

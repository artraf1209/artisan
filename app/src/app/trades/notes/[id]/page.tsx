import { ClipboardCheck, Newspaper } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
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
    <PageShell
      eyebrow="Analyst note"
      title="Thesis"
      subtitle="A concise signal rationale, supporting evidence, and invalidation path for one candidate trade."
      actions={[
        { href: '/trades/queue', label: 'Approval Queue', icon: ClipboardCheck },
        { href: '/briefings', label: 'Briefings', icon: Newspaper },
      ]}
    >
        {error || !signal ? (
          <div className="surface-panel p-10 text-center">
            <p className="text-base font-medium text-foreground">Signal note not found.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The requested signal or thesis note is unavailable.
            </p>
          </div>
        ) : (
          <ThesisNote signal={signal} thesis={thesis} />
        )}
    </PageShell>
  )
}

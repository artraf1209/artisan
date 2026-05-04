import { FileText, Settings } from 'lucide-react'
import ApprovalQueue from '@/components/trades/ApprovalQueue'
import PageShell from '@/components/shared/PageShell'
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
    <PageShell
      eyebrow="Human decision lane"
      title="Queue"
      subtitle="Approve or reject pending hybrid-engine setups before they become executable trade intents."
      actions={[
        { href: '/briefings', label: 'Briefings', icon: FileText },
        { href: '/settings', label: 'Settings', icon: Settings },
      ]}
    >
        {error ? <p className="text-sm text-loss">{error.message}</p> : null}
        <ApprovalQueue signals={signals} />
    </PageShell>
  )
}

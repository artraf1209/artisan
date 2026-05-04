import { ClipboardCheck, Settings } from 'lucide-react'
import BriefingList from '@/components/briefings/BriefingList'
import { createServerClient } from '@/lib/supabase/server'
import PageShell from '@/components/shared/PageShell'
import type { BriefingAnalysis } from '@/types/hybrid'

export const dynamic = 'force-dynamic'

export default async function BriefingsPage() {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('llm_analyses')
    .select('*')
    .eq('analysis_type', 'briefing')
    .order('created_at', { ascending: false })
    .limit(30)

  const briefings = (data ?? []) as BriefingAnalysis[]

  return (
    <PageShell
      eyebrow="Analyst narrative"
      title="Briefings"
      subtitle="Daily generated context from signals, executions, and headline sentiment."
      actions={[
        { href: '/trades/queue', label: 'Approval Queue', icon: ClipboardCheck },
        { href: '/settings', label: 'Settings', icon: Settings },
      ]}
    >
        {error ? <p className="text-sm text-loss">{error.message}</p> : null}
        <BriefingList briefings={briefings} />
    </PageShell>
  )
}

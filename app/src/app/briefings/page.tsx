import Navbar from '@/components/shared/Navbar'
import BriefingList from '@/components/briefings/BriefingList'
import { createServerClient } from '@/lib/supabase/server'
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
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Daily Briefings</h1>
          <p className="text-sm text-muted-foreground">
            Morning summaries generated from recent signals, executions, and headlines.
          </p>
          {error ? <p className="text-sm text-loss">{error.message}</p> : null}
        </div>
        <BriefingList briefings={briefings} />
      </main>
    </div>
  )
}

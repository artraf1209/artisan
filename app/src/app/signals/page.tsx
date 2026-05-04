import { createServerClient } from '@/lib/supabase/server'
import { ClipboardCheck, Newspaper } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import SignalFeed from '@/components/signals/SignalFeed'
import type { Signal } from '@/types'

export const dynamic = 'force-dynamic'

export default async function SignalsPage() {
  const supabase = await createServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const [legacyRes, hybridRes] = await Promise.all([
    db.from('signals').select('*').order('created_at', { ascending: false }).limit(50),
    db
      .from('signal_events')
      .select('id, symbol, direction, status, composite_score, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  // Prefer hybrid signal_events if they exist; fall back to legacy signals table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hybridRows: Record<string, any>[] = hybridRes.data ?? []
  let signals: Signal[]
  if (hybridRows.length > 0) {
    signals = hybridRows.map(s => ({
      id: s.id,
      symbol: s.symbol,
      direction: s.direction as Signal['direction'],
      confidence: s.composite_score ?? 0,
      model: 'hybrid-v0',
      metadata: null,
      executed: s.status === 'executed',
      created_at: s.created_at,
    }))
  } else {
    signals = legacyRes.data ?? []
  }

  return (
    <PageShell
      eyebrow="Model output"
      title="Signals"
      subtitle="Review the latest model-generated ideas and their confidence before they move into the human approval lane."
      actions={[
        { href: '/trades/queue', label: 'Approval Queue', icon: ClipboardCheck },
        { href: '/briefings', label: 'Briefings', icon: Newspaper },
      ]}
    >
      <SignalFeed signals={signals} />
    </PageShell>
  )
}

import { createServerClient } from '@/lib/supabase/server'
import { ClipboardCheck, Newspaper } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import TradeTable from '@/components/trades/TradeTable'

export const dynamic = 'force-dynamic'

export default async function TradesPage() {
  const supabase = await createServerClient()
  const { data: trades } = await supabase
    .from('trades')
    .select('*, signals(model, direction, confidence)')
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <PageShell
      eyebrow="Execution history"
      title="Trades"
      subtitle="A compact ledger of recent fills, direction, and price action across the paper account."
      actions={[
        { href: '/trades/queue', label: 'Approval Queue', icon: ClipboardCheck },
        { href: '/briefings', label: 'Briefings', icon: Newspaper },
      ]}
    >
        <TradeTable trades={trades ?? []} />
    </PageShell>
  )
}

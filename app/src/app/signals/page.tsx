import { createServerClient } from '@/lib/supabase/server'
import { ClipboardCheck, Newspaper } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import SignalFeed from '@/components/signals/SignalFeed'

export const dynamic = 'force-dynamic'

export default async function SignalsPage() {
  const supabase = await createServerClient()
  const { data: signals } = await supabase
    .from('signals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

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
        <SignalFeed signals={signals ?? []} />
    </PageShell>
  )
}

import { createServerClient } from '@/lib/supabase/server'
import Navbar from '@/components/shared/Navbar'
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
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Trade Log</h1>
        <TradeTable trades={trades ?? []} />
      </main>
    </div>
  )
}

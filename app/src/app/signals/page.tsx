import { createServerClient } from '@/lib/supabase/server'
import Navbar from '@/components/shared/Navbar'
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
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">AI Signals</h1>
        <SignalFeed signals={signals ?? []} />
      </main>
    </div>
  )
}

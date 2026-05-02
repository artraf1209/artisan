import { createServerClient } from '@/lib/supabase/server'
import Navbar from '@/components/shared/Navbar'
import PortfolioCard from '@/components/dashboard/PortfolioCard'
import ActivePositions from '@/components/dashboard/ActivePositions'
import RecentTrades from '@/components/dashboard/RecentTrades'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createServerClient()

  const [{ data: positions }, { data: trades }, { data: signals }] = await Promise.all([
    supabase.from('positions').select('*').order('updated_at', { ascending: false }),
    supabase.from('trades').select('*').order('created_at', { ascending: false }).limit(10),
    supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(5),
  ])

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PortfolioCard positions={positions ?? []} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ActivePositions positions={positions ?? []} />
          <RecentTrades trades={trades ?? []} />
        </div>
      </main>
    </div>
  )
}

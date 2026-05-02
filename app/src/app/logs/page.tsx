import { createServerClient } from '@/lib/supabase/server'
import Navbar from '@/components/shared/Navbar'
import type { Log } from '@/types'

export const dynamic = 'force-dynamic'

export default async function LogsPage() {
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  const logs = data as Log[] | null

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">System Logs</h1>
        <div className="rounded-lg border border-border bg-card p-4 font-mono text-sm space-y-1 max-h-[70vh] overflow-y-auto">
          {(logs ?? []).map((log) => (
            <div key={log.id} className={`flex gap-3 ${log.level === 'error' ? 'text-destructive' : log.level === 'warn' ? 'text-yellow-400' : 'text-muted-foreground'}`}>
              <span className="shrink-0 text-xs opacity-60">
                {new Date(log.created_at).toLocaleTimeString()}
              </span>
              <span className="shrink-0 uppercase text-xs font-bold w-12">{log.level}</span>
              <span className="shrink-0 text-xs opacity-60 w-16">{log.source}</span>
              <span>{log.message}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

import { createServerClient } from '@/lib/supabase/server'
import { BarChart3, Settings } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
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
    <PageShell
      eyebrow="Operational trace"
      title="Logs"
      subtitle="Low-level event output from the engine, bot, and infrastructure."
      actions={[
        { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
        { href: '/settings', label: 'Settings', icon: Settings },
      ]}
    >
        <div className="surface-panel max-h-[70vh] overflow-y-auto p-4 font-mono text-sm space-y-1">
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
    </PageShell>
  )
}

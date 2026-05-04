import { BarChart3, ClipboardCheck } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'

export default function SettingsPage() {
  return (
    <PageShell
      eyebrow="Workspace controls"
      title="Settings"
      subtitle="Configuration hooks for engine behavior, approvals, and account context."
      actions={[
        { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
        { href: '/trades/queue', label: 'Approval Queue', icon: ClipboardCheck },
      ]}
    >
        <div className="surface-panel p-6 text-muted-foreground">
          Engine configuration coming soon.
        </div>
    </PageShell>
  )
}

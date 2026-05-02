import { cn } from '@/lib/utils'

type Status = 'pending' | 'filled' | 'cancelled' | 'rejected' | 'long' | 'short' | 'flat' | string

const statusStyles: Record<string, string> = {
  filled: 'bg-profit/20 text-profit border-profit/30',
  long: 'bg-profit/20 text-profit border-profit/30',
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  short: 'bg-loss/20 text-loss border-loss/30',
  rejected: 'bg-loss/20 text-loss border-loss/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
  flat: 'bg-muted text-muted-foreground border-border',
}

export default function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border', statusStyles[status] ?? 'bg-muted text-muted-foreground border-border')}>
      {status}
    </span>
  )
}

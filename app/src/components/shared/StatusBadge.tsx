import { cn } from '@/lib/utils'

type Status = 'pending' | 'filled' | 'cancelled' | 'rejected' | 'long' | 'short' | 'flat' | string

const statusStyles: Record<string, string> = {
  filled: 'bg-profit/14 text-profit border-profit/20',
  long: 'bg-profit/14 text-profit border-profit/20',
  approved: 'bg-profit/14 text-profit border-profit/20',
  pending: 'bg-white/10 text-white border-white/10',
  submitted: 'bg-white/10 text-white border-white/10',
  short: 'bg-loss/14 text-loss border-loss/20',
  rejected: 'bg-loss/14 text-loss border-loss/20',
  cancelled: 'bg-muted text-muted-foreground border-border',
  flat: 'bg-muted text-muted-foreground border-border',
  executed: 'bg-profit/14 text-profit border-profit/20',
}

export default function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.16em]',
        statusStyles[status] ?? 'bg-muted text-muted-foreground border-border',
      )}
    >
      {status}
    </span>
  )
}

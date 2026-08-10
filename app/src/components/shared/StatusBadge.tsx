import { cn } from '@/lib/utils'

type Status = 'pending' | 'filled' | 'cancelled' | 'rejected' | 'long' | 'short' | 'flat' | string

const statusStyles: Record<string, string> = {
  filled: 'bg-profit/14 text-profit border-profit/20',
  long: 'bg-profit/14 text-profit border-profit/20',
  buy: 'bg-profit/14 text-profit border-profit/20',
  approved: 'bg-profit/14 text-profit border-profit/20',
  risk_on: 'bg-profit/14 text-profit border-profit/20',
  real: 'bg-profit/14 text-profit border-profit/20',
  'in queue': 'bg-white/10 text-white border-white/10',
  pending: 'bg-white/10 text-white border-white/10',
  submitted: 'bg-white/10 text-white border-white/10',
  neutral: 'bg-amber-200/15 text-amber-200 border-amber-200/25',
  shadow: 'bg-white/10 text-white border-white/10',
  'still open': 'bg-white/10 text-white border-white/10',
  short: 'bg-loss/14 text-loss border-loss/20',
  sell: 'bg-loss/14 text-loss border-loss/20',
  rejected: 'bg-loss/14 text-loss border-loss/20',
  risk_off: 'bg-loss/14 text-loss border-loss/20',
  'hit stop': 'bg-loss/14 text-loss border-loss/20',
  superseded: 'bg-loss/14 text-loss border-loss/20',
  cancelled: 'bg-muted text-muted-foreground border-border',
  flat: 'bg-muted text-muted-foreground border-border',
  executed: 'bg-profit/14 text-profit border-profit/20',
  'hit target': 'bg-profit/14 text-profit border-profit/20',
  'time expired favorable': 'bg-profit/14 text-profit border-profit/20',
  'time expired flat': 'bg-muted text-muted-foreground border-border',
  'time expired unfavorable': 'bg-loss/14 text-loss border-loss/20',
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

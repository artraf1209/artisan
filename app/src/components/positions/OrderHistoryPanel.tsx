import StatusBadge from '@/components/shared/StatusBadge'
import { describeOrderType, humanizeLegType, type OrderHistoryRow } from '@/lib/orders'
import { formatCurrency, formatDate } from '@/lib/utils'

/** Compact per-symbol order history for a PositionCard -- every buy/sell order ever
 * posted for this symbol, not just the position's current state. Deliberately not a
 * reuse of the fuller OrderCard/OrderTableRow (recommendations/orders/page.tsx),
 * which carry more detail (recommended-vs-actual sizing, override deltas, outcome)
 * than fits well nested inside an already-dense position card. */
export default function OrderHistoryPanel({ orders }: { orders: OrderHistoryRow[] }) {
  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">No orders posted for this symbol yet.</p>
  }

  return (
    <ul className="space-y-2">
      {orders.map((order) => (
        <li
          key={order.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card/60 px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.side} />
            <StatusBadge status={order.execution_status} />
            <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {describeOrderType(order)}
            </span>
            {humanizeLegType(order.leg_type) && (
              <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                {humanizeLegType(order.leg_type)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              {order.filled_qty ?? 0}
              {order.requested_quantity != null && order.requested_quantity !== order.filled_qty
                ? `/${order.requested_quantity}`
                : ''}{' '}
              sh
              {order.filled_price != null ? ` @ ${formatCurrency(order.filled_price)}` : ''}
            </span>
            <span>{formatDate(order.filled_at ?? order.created_at)}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

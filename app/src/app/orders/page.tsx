import Link from 'next/link'
import { ClipboardCheck, Wallet } from 'lucide-react'
import PageShell from '@/components/shared/PageShell'
import StatusBadge from '@/components/shared/StatusBadge'
import { createServerClient } from '@/lib/supabase/server'
import { loadOrders, type OrderHistoryRow } from '@/lib/orders'
import { formatCurrency, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type OrdersSearchParams = {
  date_from?: string | string[]
  date_to?: string | string[]
  symbol?: string | string[]
  side?: string | string[]
}

function firstValue(value: string | string[] | undefined) {
  if (typeof value === 'string') {
    return value
  }

  return value?.[0]
}

function humanizeResolution(value: string | null) {
  return (value ?? 'still_open').replaceAll('_', ' ')
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams?: Promise<OrdersSearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const filters = {
    date_from: firstValue(params?.date_from),
    date_to: firstValue(params?.date_to),
    symbol: firstValue(params?.symbol),
    side: (firstValue(params?.side) as 'buy' | 'sell' | '') ?? undefined,
  }

  const supabase = (await createServerClient()) as any
  const orders = await loadOrders(supabase, filters)
  const editedCount = orders.filter((order) => order.override_deltas.length > 0).length
  const openCount = orders.filter((order) => order.resolution === 'still_open').length

  return (
    <PageShell
      eyebrow="Execution history"
      title="Orders"
      subtitle="Review filled and submitted v2 orders, compare original sizing against approval edits, and track how each decision eventually resolved."
      actions={[
        { href: '/trades/queue', label: 'Queue', icon: ClipboardCheck },
        { href: '/dashboard/account', label: 'Account', icon: Wallet },
      ]}
    >
      <section className="grid gap-3 lg:grid-cols-3">
        <SummaryCard
          label="Orders"
          value={String(orders.length)}
          detail="Rows returned after the active filters are applied."
        />
        <SummaryCard
          label="Edited approvals"
          value={String(editedCount)}
          detail="Orders where a human changed shares, stop, or target before execution."
        />
        <SummaryCard
          label="Still open"
          value={String(openCount)}
          detail="Orders whose linked decision outcome has not resolved yet."
        />
      </section>

      <section className="rounded-[1.5rem] border border-border bg-card/95 p-4 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <form action="/orders" className="grid gap-3 md:grid-cols-[1fr_1fr_0.8fr_auto]">
          <label className="space-y-2 text-sm text-foreground">
            <span className="font-medium">Date range</span>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="date"
                name="date_from"
                defaultValue={filters.date_from ?? ''}
                className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
              />
              <input
                type="date"
                name="date_to"
                defaultValue={filters.date_to ?? ''}
                className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
              />
            </div>
          </label>
          <label className="space-y-2 text-sm text-foreground">
            <span className="font-medium">Symbol</span>
            <input
              type="text"
              name="symbol"
              defaultValue={filters.symbol ?? ''}
              placeholder="AAPL"
              className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm uppercase text-foreground outline-none transition focus:border-ring"
            />
          </label>
          <label className="space-y-2 text-sm text-foreground">
            <span className="font-medium">Side</span>
            <select
              name="side"
              defaultValue={filters.side ?? ''}
              className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
            >
              <option value="">All</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Apply
            </button>
            <Link
              href="/orders"
              className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
            >
              Clear
            </Link>
          </div>
        </form>
      </section>

      {orders.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">No orders match the current filters.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Filled or submitted `trade_executions` rows will appear here once the v2 execution pipeline writes them.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4 lg:hidden">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-[1.5rem] border border-border bg-card/95 shadow-[0_20px_45px_rgba(0,0,0,0.22)] lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-background/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Order</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Filled</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Originally recommended</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Edited values</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {orders.map((order) => (
                    <OrderTableRow key={order.id} order={order} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </PageShell>
  )
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <article className="rounded-[1.5rem] border border-border bg-card/90 p-4 shadow-[0_16px_35px_rgba(0,0,0,0.22)]">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </article>
  )
}

function OrderCard({ order }: { order: OrderHistoryRow }) {
  return (
    <article className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-[-0.04em] text-foreground">{order.symbol}</h2>
            <StatusBadge status={order.side} />
            <StatusBadge status={order.execution_status} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {order.filled_at ? formatDate(order.filled_at) : formatDate(order.created_at)}
          </p>
        </div>
        <p className="text-sm uppercase tracking-[0.16em] text-muted-foreground">{order.source_type}</p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <InfoBlock
          label="Filled"
          lines={[
            `${order.filled_qty ?? order.actual_shares ?? 0} @ ${formatCurrency(order.filled_price)}`,
            `Intent ${order.intent_status ?? 'pending'}`,
          ]}
        />
        <InfoBlock
          label="Recommended"
          lines={[
            `Shares ${order.recommended_shares ?? 'N/A'}`,
            `Stop ${formatCurrency(order.recommended_stop_price)}`,
            `Target ${formatCurrency(order.recommended_target_price)}`,
          ]}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <InfoBlock
          label="Edited values"
          lines={
            order.override_deltas.length > 0
              ? order.override_deltas
              : ['No approval edits recorded.']
          }
        />
        <InfoBlock
          label="Outcome"
          lines={[
            humanizeResolution(order.resolution),
            order.r_multiple == null ? 'R multiple pending' : `${order.r_multiple.toFixed(2)}R`,
          ]}
        />
      </div>
    </article>
  )
}

function OrderTableRow({ order }: { order: OrderHistoryRow }) {
  return (
    <tr className="align-top transition hover:bg-accent/10">
      <td className="px-4 py-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{order.symbol}</span>
            <StatusBadge status={order.side} />
            <StatusBadge status={order.execution_status} />
          </div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {order.source_type}
          </p>
        </div>
      </td>
      <td className="px-4 py-4 text-foreground">
        <p>{order.filled_qty ?? order.actual_shares ?? 0} @ {formatCurrency(order.filled_price)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {order.filled_at ? formatDate(order.filled_at) : formatDate(order.created_at)}
        </p>
      </td>
      <td className="px-4 py-4 text-foreground">
        <p>Shares {order.recommended_shares ?? 'N/A'}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Stop {formatCurrency(order.recommended_stop_price)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Target {formatCurrency(order.recommended_target_price)}
        </p>
      </td>
      <td className="px-4 py-4 text-foreground">
        {order.override_deltas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approval edits recorded.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {order.override_deltas.map((delta) => (
              <span
                key={delta}
                className="inline-flex items-center rounded-full border border-border bg-background/70 px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-foreground"
              >
                {delta}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-4 text-foreground">
        <p className="capitalize">{humanizeResolution(order.resolution)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {order.r_multiple == null ? 'R multiple pending' : `${order.r_multiple.toFixed(2)}R`}
        </p>
      </td>
    </tr>
  )
}

function InfoBlock({
  label,
  lines,
}: {
  label: string
  lines: string[]
}) {
  return (
    <div className="rounded-2xl border border-border bg-background/50 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <div className="mt-2 space-y-1">
        {lines.map((line) => (
          <p key={line} className="text-sm text-foreground">
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}

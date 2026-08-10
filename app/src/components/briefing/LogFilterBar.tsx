import Link from 'next/link'
import type { LogRange } from '@/lib/briefing-logs'

export default function LogFilterBar({
  action,
  symbol,
  range,
}: {
  action: string
  symbol?: string
  range: LogRange
}) {
  return (
    <section className="rounded-[1.5rem] border border-border bg-card/95 p-4 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="space-y-2 text-sm text-foreground">
          <span className="font-medium">Symbol</span>
          <input
            type="text"
            name="symbol"
            defaultValue={symbol ?? ''}
            placeholder="AAPL"
            className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm uppercase text-foreground outline-none transition focus:border-ring"
          />
        </label>
        <label className="space-y-2 text-sm text-foreground">
          <span className="font-medium">Range</span>
          <select
            name="range"
            defaultValue={range}
            className="rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
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
            href={action}
            className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            Clear
          </Link>
        </div>
      </form>
    </section>
  )
}

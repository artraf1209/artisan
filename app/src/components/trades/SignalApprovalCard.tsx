'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { QueueSignal } from '@/types/hybrid'
import { formatCurrency, formatDate } from '@/lib/utils'
import StatusBadge from '@/components/shared/StatusBadge'

type Decision = 'approve' | 'reject'

export default function SignalApprovalCard({ signal }: { signal: QueueSignal }) {
  const router = useRouter()
  const [note, setNote] = useState(signal.review_note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const submitDecision = (decision: Decision) => {
    setError(null)
    startTransition(async () => {
      const url =
        decision === 'approve'
          ? `/api/queue/${signal.id}/approve`
          : `/api/queue/${signal.id}/reject`

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setError(payload?.error ?? `Failed to ${decision} signal.`)
        return
      }

      router.refresh()
    })
  }

  return (
    <article className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-foreground">{signal.symbol}</h2>
            <StatusBadge status={signal.status} />
            <StatusBadge status={signal.direction} />
          </div>
          <p className="text-sm text-muted-foreground">
            Created {formatDate(signal.created_at)} · {signal.pillars_passed} pillars passed
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:min-w-72">
          <Metric label="Composite" value={signal.composite_score.toFixed(3)} />
          <Metric label="ATR" value={signal.atr_at_signal?.toFixed(2) ?? '—'} />
          <Metric label="Stop" value={formatCurrency(signal.stop_price)} />
          <Metric label="Target" value={formatCurrency(signal.target_price)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ScorePill label="Fundamental" value={signal.f_score} />
        <ScorePill label="Technical" value={signal.t_score} />
        <ScorePill label="Sentiment" value={signal.s_score} />
      </div>

      {signal.thesis?.content ? (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Thesis</p>
          <p className="mt-2 text-sm leading-6 text-foreground whitespace-pre-wrap">
            {signal.thesis.content}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Thesis note not generated yet.
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor={`review-note-${signal.id}`} className="text-sm font-medium text-foreground">
          Review note
        </label>
        <textarea
          id={`review-note-${signal.id}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder="Optional rationale for approving or rejecting this idea."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-0 transition focus:border-ring"
        />
      </div>

      {error ? <p className="text-sm text-loss">{error}</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={isPending}
          onClick={() => submitDecision('approve')}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving...' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => submitDecision('reject')}
          className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving...' : 'Reject'}
        </button>
      </div>
    </article>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100)

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{percent}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-background/80">
        <div
          className="h-2 rounded-full bg-primary transition-all"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  )
}

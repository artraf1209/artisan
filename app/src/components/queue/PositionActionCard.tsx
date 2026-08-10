'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { PositionActionQueueItem } from '@/lib/queue'
import StatusBadge from '@/components/shared/StatusBadge'

export default function PositionActionCard({
  review,
}: {
  review: PositionActionQueueItem
}) {
  const router = useRouter()
  const [note, setNote] = useState(review.review_note ?? '')
  const [showPrecedent, setShowPrecedent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const submitDecision = (decision: 'approve' | 'reject') => {
    setError(null)

    startTransition(async () => {
      const response = await fetch(
        decision === 'approve'
          ? `/api/queue/${review.id}/approve`
          : `/api/queue/${review.id}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queue_type: 'position_review',
            note: note.trim() || undefined,
          }),
        },
      )

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Failed to ${decision} review.`)
        return
      }

      router.refresh()
    })
  }

  return (
    <article className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.28)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
              {review.symbol}
            </h2>
            <StatusBadge status={review.recommended_action} />
          </div>
          <p className="max-w-3xl text-sm leading-6 text-foreground/88">
            {review.reasoning ?? 'No reasoning attached to this position action.'}
          </p>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Queued {formatDate(review.created_at)}
          </p>
        </div>

        <div className="grid min-w-full grid-cols-2 gap-3 sm:min-w-[25rem] sm:grid-cols-3">
          <Metric label="Quantity" value={review.position?.quantity?.toString() ?? '—'} />
          <Metric label="Entry" value={formatCurrency(review.position?.avg_entry_price)} />
          <Metric label="Stop" value={formatCurrency(review.new_stop_price ?? review.position?.stop_price)} />
          <Metric label="Target" value={formatCurrency(review.new_target_price ?? review.position?.target_price)} />
          <Metric label="Opened" value={review.position?.opened_at ? formatDate(review.position.opened_at) : '—'} />
          <Metric label="Status" value={review.status} />
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-background/60 p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Original thesis</p>
        <p className="mt-2 text-sm leading-6 text-foreground">
          {review.original_recommendation?.thesis ?? 'No linked recommendation thesis found.'}
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-background/40 p-4">
        <button
          type="button"
          onClick={() => setShowPrecedent((current) => !current)}
          className="flex w-full items-center justify-between text-left text-sm font-medium text-foreground"
        >
          <span>Historical precedent</span>
          <span className="text-muted-foreground">{showPrecedent ? 'Hide' : 'Show'}</span>
        </button>
        {showPrecedent ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {review.historical_precedent ?? 'No historical precedent attached.'}
          </p>
        ) : null}
      </div>

      <div className="mt-4 space-y-2">
        <label htmlFor={`position-review-note-${review.id}`} className="text-sm font-medium text-foreground">
          Review note
        </label>
        <textarea
          id={`position-review-note-${review.id}`}
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional context for approving or rejecting this action."
          className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
        />
      </div>

      {error ? <p className="mt-4 text-sm text-loss">{error}</p> : null}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={isPending}
          onClick={() => submitDecision('approve')}
          className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving...' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => submitDecision('reject')}
          className="inline-flex items-center justify-center rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving...' : 'Reject'}
        </button>
      </div>
    </article>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/50 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

'use client'

import { useEffect, useState, useTransition, type HTMLAttributes } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { RecommendationQueueItem, SizePreview } from '@/lib/queue'
import StatusBadge from '@/components/shared/StatusBadge'

type PreviewPayload = {
  shares?: string
  stop_price?: string
  target_price?: string
}

type ApprovePayload = {
  queue_type: 'recommendation'
  note?: string
  overrides?: {
    shares?: number
    stop_price?: number
    target_price?: number
  }
}

export default function RecommendationCard({
  recommendation,
}: {
  recommendation: RecommendationQueueItem
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [note, setNote] = useState('')
  const [shares, setShares] = useState(recommendation.shares?.toString() ?? '')
  const [stopPrice, setStopPrice] = useState(recommendation.stop_price?.toString() ?? '')
  const [targetPrice, setTargetPrice] = useState(recommendation.target_price?.toString() ?? '')
  const [showEditor, setShowEditor] = useState(false)
  const [showPrecedent, setShowPrecedent] = useState(false)
  const [preview, setPreview] = useState<SizePreview | null>(
    recommendation.shares != null && recommendation.entry_price != null && recommendation.stop_price != null
      ? {
          shares: recommendation.shares,
          max_shares: recommendation.shares,
          dollar_risk: recommendation.dollar_risk ?? 0,
          entry_price: recommendation.entry_price,
          stop_price: recommendation.stop_price,
          target_price: recommendation.target_price,
          allowed: true,
        }
      : null,
  )
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false

    const loadPreview = async (payload: PreviewPayload = {}) => {
      setPreviewLoading(true)
      setPreviewError(null)

      try {
        const response = await fetch(`/api/recommendations/${recommendation.id}/preview-size`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = (await response.json().catch(() => null)) as
          | ({ error?: string } & Partial<SizePreview>)
          | null

        if (!response.ok) {
          throw new Error(body?.error ?? 'Unable to preview size.')
        }

        if (!cancelled) {
          setPreview(body as SizePreview)
        }
      } catch (previewRequestError) {
        if (!cancelled) {
          setPreviewError(
            previewRequestError instanceof Error
              ? previewRequestError.message
              : 'Unable to preview size.',
          )
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false)
        }
      }
    }

    void loadPreview()

    return () => {
      cancelled = true
    }
  }, [recommendation.id])

  useEffect(() => {
    if (!showEditor) {
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError(null)

      try {
        const response = await fetch(`/api/recommendations/${recommendation.id}/preview-size`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shares,
            stop_price: stopPrice,
            target_price: targetPrice,
          }),
        })
        const body = (await response.json().catch(() => null)) as
          | ({ error?: string } & Partial<SizePreview>)
          | null

        if (!response.ok) {
          throw new Error(body?.error ?? 'Unable to preview size.')
        }

        if (!cancelled) {
          setPreview(body as SizePreview)
        }
      } catch (previewRequestError) {
        if (!cancelled) {
          setPreviewError(
            previewRequestError instanceof Error
              ? previewRequestError.message
              : 'Unable to preview size.',
          )
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false)
        }
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [recommendation.id, shares, showEditor, stopPrice, targetPrice])

  const submitDecision = (decision: 'approve' | 'reject') => {
    setError(null)

    if (decision === 'approve' && showEditor) {
      if (!preview) {
        setError('Preview sizing before submitting edits.')
        return
      }

      if (!preview.allowed) {
        setError('Edited values exceed the allowed risk size.')
        return
      }
    }

    startTransition(async () => {
      const payload: ApprovePayload = {
        queue_type: 'recommendation',
        note: note.trim() || undefined,
      }

      if (decision === 'approve' && showEditor) {
        payload.overrides = {
          shares: shares ? Number(shares) : undefined,
          stop_price: stopPrice ? Number(stopPrice) : undefined,
          target_price: targetPrice ? Number(targetPrice) : undefined,
        }
      }

      const response = await fetch(
        decision === 'approve'
          ? `/api/recommendations/${recommendation.id}/approve`
          : `/api/recommendations/${recommendation.id}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Failed to ${decision} recommendation.`)
        return
      }

      router.refresh()
    })
  }

  const displayShares = preview?.shares ?? recommendation.shares ?? 0
  const displayDollarRisk = preview?.dollar_risk ?? recommendation.dollar_risk ?? 0
  const displayStop = preview?.stop_price ?? recommendation.stop_price
  const displayTarget = preview?.target_price ?? recommendation.target_price

  return (
    <article className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.28)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(`${pathname}?recommendation=${recommendation.id}`, { scroll: false })}
              className="text-2xl font-semibold tracking-[-0.04em] text-foreground underline decoration-border decoration-2 underline-offset-4 transition hover:decoration-foreground"
            >
              {recommendation.symbol}
            </button>
            <StatusBadge status="enter" />
            {recommendation.conviction ? <StatusBadge status={recommendation.conviction} /> : null}
          </div>
          <p className="max-w-3xl text-sm leading-6 text-foreground/88">
            {recommendation.thesis ?? 'No thesis provided for this recommendation yet.'}
          </p>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Queued {formatDate(recommendation.created_at)}
          </p>
        </div>

        <div className="grid min-w-full grid-cols-2 gap-3 sm:min-w-[25rem] sm:grid-cols-3">
          <Metric label="Entry" value={formatCurrency(recommendation.entry_price)} />
          <Metric label="Stop" value={formatCurrency(displayStop)} />
          <Metric label="Target" value={formatCurrency(displayTarget)} />
          <Metric label="ATR" value={recommendation.atr_at_signal?.toFixed(2) ?? '—'} />
          <Metric label="Horizon" value={recommendation.effective_horizon_days ? `${recommendation.effective_horizon_days}d` : '—'} />
          <Metric label="Shares" value={String(displayShares)} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-background/60 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Dollar risk</p>
          <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(displayDollarRisk)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-background/60 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Preview status</p>
          <p className="mt-2 text-sm text-foreground">
            {previewLoading ? 'Refreshing size preview...' : preview?.allowed === false ? 'Edited size exceeds the allowed max.' : 'Sizing is within the current risk limits.'}
          </p>
          {preview?.max_shares != null ? (
            <p className="mt-2 text-xs text-muted-foreground">Max allowed: {preview.max_shares} shares</p>
          ) : null}
        </div>
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
            {recommendation.historical_precedent ?? 'No historical precedent attached.'}
          </p>
        ) : null}
      </div>

      <div className="mt-4 space-y-2">
        <label
          htmlFor={`recommendation-note-${recommendation.id}`}
          className="text-sm font-medium text-foreground"
        >
          Review note
        </label>
        <textarea
          id={`recommendation-note-${recommendation.id}`}
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional approval context or override rationale."
          className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-background/30 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Edit before executing</p>
            <p className="text-sm text-muted-foreground">
              Adjust shares or protective levels and we&apos;ll re-run the exact same sizing guardrails as `execute-trade`.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowEditor((current) => !current)}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            {showEditor ? 'Close editor' : 'Edit & Approve'}
          </button>
        </div>

        {showEditor ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <InputField
              label="Shares"
              value={shares}
              onChange={setShares}
              inputMode="numeric"
              placeholder="Shares"
            />
            <InputField
              label="Stop price"
              value={stopPrice}
              onChange={setStopPrice}
              inputMode="decimal"
              placeholder="Stop"
            />
            <InputField
              label="Target price"
              value={targetPrice}
              onChange={setTargetPrice}
              inputMode="decimal"
              placeholder="Target"
            />
          </div>
        ) : null}

        {previewError ? <p className="mt-3 text-sm text-loss">{previewError}</p> : null}
      </div>

      {error ? <p className="mt-4 text-sm text-loss">{error}</p> : null}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={isPending || previewLoading}
          onClick={() => submitDecision('approve')}
          className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving...' : showEditor ? 'Save Edit & Approve' : 'Approve'}
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

function InputField({
  label,
  value,
  onChange,
  inputMode,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  inputMode: HTMLAttributes<HTMLInputElement>['inputMode']
  placeholder: string
}) {
  return (
    <label className="space-y-2 text-sm text-foreground">
      <span className="font-medium">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
      />
    </label>
  )
}

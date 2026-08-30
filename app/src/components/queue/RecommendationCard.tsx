'use client'

import { useState, type HTMLAttributes } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { RecommendationQueueItem, SizePreview } from '@/lib/queue'
import { useOrderApproval } from '@/lib/hooks/useOrderApproval'
import StatusBadge from '@/components/shared/StatusBadge'

export default function RecommendationCard({
  recommendation,
}: {
  recommendation: RecommendationQueueItem
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [showPrecedent, setShowPrecedent] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)

  const initialPreview: SizePreview | null =
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
      : null

  const {
    note,
    setNote,
    shares,
    setShares,
    stopPrice,
    setStopPrice,
    targetPrice,
    setTargetPrice,
    showEditor,
    setShowEditor,
    preview,
    previewError,
    previewLoading,
    decisionState,
    submitDecision,
  } = useOrderApproval({
    recommendationId: recommendation.id,
    initialShares: recommendation.shares,
    initialStopPrice: recommendation.stop_price,
    initialTargetPrice: recommendation.target_price,
    initialPreview,
    onDecided: () => router.refresh(),
  })

  const isPending = decisionState.kind === 'submitting'
  const error = decisionState.kind === 'error' ? decisionState.message : null

  const displayShares = preview?.shares ?? recommendation.shares ?? 0
  const displayDollarRisk = preview?.dollar_risk ?? recommendation.dollar_risk ?? 0
  const displayStop = preview?.stop_price ?? recommendation.stop_price
  const displayTarget = preview?.target_price ?? recommendation.target_price

  const rMultiple =
    recommendation.entry_price != null && displayStop != null && displayTarget != null && recommendation.entry_price !== displayStop
      ? ((displayTarget - recommendation.entry_price) / (recommendation.entry_price - displayStop)).toFixed(1)
      : '—'

  return (
    <article className="rounded border border-border bg-card p-4 text-[0.75rem] shadow-none">
      <div className="flex flex-col gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(`${pathname}?recommendation=${recommendation.id}`, { scroll: false })}
              className="text-xl font-bold tracking-tight text-paper"
            >
              {recommendation.symbol}
            </button>
            <StatusBadge status={recommendation.action} />
            {recommendation.conviction ? <StatusBadge status={recommendation.conviction} /> : null}
          </div>
            <span className="text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground">{recommendation.conviction ?? 'unrated'} conviction</span>
          </div>
          <div className="grid grid-cols-4 gap-2 border-y border-border py-3 text-xs">
            <Metric label="Entry" value={formatCurrency(recommendation.entry_price)} />
            <Metric label="Stop" value={formatCurrency(displayStop)} />
            <Metric label="Target" value={formatCurrency(displayTarget)} />
            <Metric label="R" value={rMultiple} />
          </div>
          <p className="leading-5 text-paper/90">
            {recommendation.headline ?? recommendation.thesis ?? 'No synthesis verdict has been recorded yet.'}
          </p>
        </div>

      <details className="border-t border-border pt-3">
        <summary className="cursor-pointer text-[0.68rem] uppercase tracking-[0.08em] text-amber">Full reasoning</summary>
        <div className="mt-3 space-y-2 leading-5 text-muted-foreground">
          <p><strong className="text-paper">Sentiment</strong> — {recommendation.sentiment_note ?? 'See full analyst detail.'}</p>
          <p><strong className="text-paper">Technical</strong> — {recommendation.technical_note ?? 'See full analyst detail.'}</p>
          <p><strong className="text-paper">Fundamental</strong> — {recommendation.fundamental_note ?? 'See full analyst detail.'}</p>
          <p className="border-t border-border pt-2 text-paper/80">{recommendation.thesis}</p>
          {showPrecedent ? <p>{recommendation.historical_precedent ?? 'No historical precedent attached.'}</p> : null}
          <button type="button" onClick={() => setShowPrecedent((current) => !current)} className="text-amber">
            {showPrecedent ? 'Hide precedent' : 'Show precedent'}
          </button>
        </div>
      </details>

      <details className="mt-2 border-t border-border pt-3">
        <summary className="cursor-pointer text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">Edit order</summary>
      <div className="mt-3 space-y-2">
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
          className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
        />
      </div>

      <div className="mt-3 border border-border bg-background/30 p-3">
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
            className="rounded border border-border px-3 py-2 text-xs font-medium uppercase tracking-[0.06em] text-foreground transition hover:bg-accent"
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
      </details>

      {error ? <p className="mt-4 text-sm text-loss">{error}</p> : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={isPending || previewLoading}
          onClick={() => confirmApprove ? submitDecision('approve') : setConfirmApprove(true)}
          className="inline-flex min-h-11 items-center justify-center rounded bg-amber px-4 py-2.5 text-xs font-bold uppercase tracking-[0.06em] text-amber-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving...' : confirmApprove ? `Confirm · ${displayShares} sh · ${formatCurrency(displayShares * (preview?.entry_price ?? recommendation.entry_price ?? 0))} · risk ${formatCurrency(displayDollarRisk)}` : 'Approve'}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => submitDecision('reject')}
          className="inline-flex min-h-11 items-center justify-center rounded border border-border bg-card px-4 py-2.5 text-xs font-medium uppercase tracking-[0.06em] text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving...' : 'Reject'}
        </button>
      </div>
      </div>
    </article>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.58rem] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
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
        className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
      />
    </label>
  )
}

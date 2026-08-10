'use client'

import { type HTMLAttributes } from 'react'
import StatusBadge from '@/components/shared/StatusBadge'
import { formatCurrency } from '@/lib/utils'
import { useOrderApproval } from '@/lib/hooks/useOrderApproval'
import type { RecommendationDetail } from '@/lib/recommendation-detail'

function humanize(value: string) {
  return value.replaceAll('_', ' ')
}

export default function OrderEditor({
  detail,
  onDecided,
}: {
  detail: RecommendationDetail
  onDecided?: () => void
}) {
  const { recommendation } = detail

  if (recommendation.action !== 'enter') {
    return null
  }

  if (recommendation.status !== 'pending') {
    return (
      <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
        <h3 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Order</h3>
        <div className="mt-3 flex items-center gap-2">
          <StatusBadge status={humanize(recommendation.status)} />
          <p className="text-sm text-muted-foreground">
            This recommendation was already {humanize(recommendation.status)}
            {recommendation.reviewed_at ? ` on ${new Date(recommendation.reviewed_at).toLocaleString()}` : ''}.
          </p>
        </div>
        {recommendation.review_note ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {recommendation.review_note}
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <OrderEditorForm
      recommendationId={recommendation.id}
      shares={recommendation.shares}
      stopPrice={recommendation.stop_price}
      targetPrice={recommendation.target_price}
      onDecided={onDecided}
    />
  )
}

function OrderEditorForm({
  recommendationId,
  shares: initialShares,
  stopPrice: initialStopPrice,
  targetPrice: initialTargetPrice,
  onDecided,
}: {
  recommendationId: string
  shares: number | null
  stopPrice: number | null
  targetPrice: number | null
  onDecided?: () => void
}) {
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
    recommendationId,
    initialShares,
    initialStopPrice,
    initialTargetPrice,
    onDecided: () => onDecided?.(),
  })

  const isPending = decisionState.kind === 'submitting'
  const isDone = decisionState.kind === 'done'
  const displayShares = preview?.shares ?? initialShares ?? 0
  const displayDollarRisk = preview?.dollar_risk ?? 0

  return (
    <section className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <h3 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Order</h3>

      {isDone ? (
        <DecisionOutcomeBanner decision={decisionState.decision} status={decisionState.status} />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Metric label="Shares" value={String(displayShares)} />
            <Metric label="Dollar risk" value={formatCurrency(displayDollarRisk)} />
          </div>

          <p className="mt-3 text-sm text-muted-foreground">
            {previewLoading
              ? 'Refreshing size preview...'
              : preview?.allowed === false
                ? 'Edited size exceeds the allowed max.'
                : 'Sizing is within the current risk limits.'}
          </p>

          <div className="mt-4 space-y-2">
            <label htmlFor={`detail-note-${recommendationId}`} className="text-sm font-medium text-foreground">
              Review note
            </label>
            <textarea
              id={`detail-note-${recommendationId}`}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional approval context or override rationale."
              className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
            />
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-background/30 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-foreground">Edit before executing</p>
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
                <InputField label="Shares" value={shares} onChange={setShares} inputMode="numeric" placeholder="Shares" />
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

          {decisionState.kind === 'error' ? (
            <p className="mt-4 text-sm text-loss">{decisionState.message}</p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={isPending || previewLoading}
              onClick={() => submitDecision('approve')}
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? 'Submitting...' : showEditor ? 'Save Edit & Approve' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => submitDecision('reject')}
              className="inline-flex items-center justify-center rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? 'Submitting...' : 'Reject'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function DecisionOutcomeBanner({ decision, status }: { decision: 'approve' | 'reject'; status: string }) {
  if (decision === 'reject') {
    return (
      <div className="mt-4 rounded-2xl border border-border bg-background/40 p-4">
        <StatusBadge status="rejected" />
        <p className="mt-2 text-sm text-muted-foreground">This recommendation was rejected.</p>
      </div>
    )
  }

  const copy: Record<string, string> = {
    filled: 'The order was submitted and filled.',
    submitted: 'The order was submitted to the broker and is awaiting a fill.',
    scheduled: 'The market is closed — the order is scheduled to submit at the next open.',
    cancelled: 'The order was cancelled by the broker.',
    rejected: 'The broker rejected this order.',
  }

  return (
    <div className="mt-4 rounded-2xl border border-border bg-background/40 p-4">
      <StatusBadge status={humanize(status)} />
      <p className="mt-2 text-sm text-muted-foreground">{copy[status] ?? `Order status: ${humanize(status)}.`}</p>
    </div>
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

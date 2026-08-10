import { useEffect, useState } from 'react'
import type { SizePreview } from '@/lib/queue'

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

export type DecisionState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'done'; decision: 'approve' | 'reject'; status: string }
  | { kind: 'error'; decision: 'approve' | 'reject'; message: string }

export interface UseOrderApprovalOptions {
  recommendationId: string
  initialShares: number | null
  initialStopPrice: number | null
  initialTargetPrice: number | null
  initialPreview?: SizePreview | null
  onDecided?: (result: { decision: 'approve' | 'reject'; status: string }) => void
}

export function useOrderApproval({
  recommendationId,
  initialShares,
  initialStopPrice,
  initialTargetPrice,
  initialPreview = null,
  onDecided,
}: UseOrderApprovalOptions) {
  const [note, setNote] = useState('')
  const [shares, setShares] = useState(initialShares?.toString() ?? '')
  const [stopPrice, setStopPrice] = useState(initialStopPrice?.toString() ?? '')
  const [targetPrice, setTargetPrice] = useState(initialTargetPrice?.toString() ?? '')
  const [showEditor, setShowEditor] = useState(false)
  const [preview, setPreview] = useState<SizePreview | null>(initialPreview)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [decisionState, setDecisionState] = useState<DecisionState>({ kind: 'idle' })

  const runPreview = async (payload: PreviewPayload) => {
    setPreviewLoading(true)
    setPreviewError(null)

    try {
      const response = await fetch(`/api/recommendations/${recommendationId}/preview-size`, {
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

      setPreview(body as SizePreview)
    } catch (previewRequestError) {
      setPreviewError(
        previewRequestError instanceof Error ? previewRequestError.message : 'Unable to preview size.',
      )
    } finally {
      setPreviewLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await runPreview({})
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendationId])

  useEffect(() => {
    if (!showEditor) {
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(async () => {
      if (cancelled) return
      await runPreview({ shares, stop_price: stopPrice, target_price: targetPrice })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendationId, shares, showEditor, stopPrice, targetPrice])

  const submitDecision = async (decision: 'approve' | 'reject') => {
    if (decision === 'approve' && showEditor) {
      if (!preview) {
        setDecisionState({ kind: 'error', decision, message: 'Preview sizing before submitting edits.' })
        return
      }
      if (!preview.allowed) {
        setDecisionState({ kind: 'error', decision, message: 'Edited values exceed the allowed risk size.' })
        return
      }
    }

    setDecisionState({ kind: 'submitting' })

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

    try {
      const response = await fetch(`/api/recommendations/${recommendationId}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => null)) as
        | { error?: string; status?: string }
        | null

      if (!response.ok) {
        throw new Error(body?.error ?? `Failed to ${decision} recommendation.`)
      }

      const status = body?.status ?? (decision === 'approve' ? 'submitted' : 'rejected')
      setDecisionState({ kind: 'done', decision, status })
      onDecided?.({ decision, status })
    } catch (submitError) {
      setDecisionState({
        kind: 'error',
        decision,
        message: submitError instanceof Error ? submitError.message : `Failed to ${decision} recommendation.`,
      })
    }
  }

  return {
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
  }
}

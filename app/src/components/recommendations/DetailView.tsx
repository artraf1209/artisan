'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import ExecutiveSummary from '@/components/recommendations/ExecutiveSummary'
import OrderEditor from '@/components/recommendations/OrderEditor'
import ComputationTrace from '@/components/recommendations/ComputationTrace'
import AgentReasoningCard from '@/components/recommendations/AgentReasoningCard'
import SynthesisCard from '@/components/recommendations/SynthesisCard'
import OutcomePanel from '@/components/recommendations/OutcomePanel'
import { useRealtimeTable } from '@/lib/hooks/useRealtimeTable'
import {
  bucketFundamental,
  bucketSentiment,
  bucketTechnical,
  type RecommendationDetail,
} from '@/lib/recommendation-detail'

export default function DetailView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const recommendationId = searchParams.get('recommendation')

  const [detail, setDetail] = useState<RecommendationDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDetail = useCallback((id: string, { showLoading }: { showLoading: boolean }) => {
    if (showLoading) {
      setLoading(true)
      setError(null)
    }

    return fetch(`/api/recommendations/${id}`)
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(body?.error ?? 'Failed to load recommendation detail.')
        }
        setDetail(body as RecommendationDetail)
        setError(null)
      })
      .catch((fetchError) => {
        if (showLoading) {
          setError(fetchError instanceof Error ? fetchError.message : 'Failed to load recommendation detail.')
        }
      })
      .finally(() => {
        if (showLoading) {
          setLoading(false)
        }
      })
  }, [])

  useEffect(() => {
    if (!recommendationId) {
      setDetail(null)
      setError(null)
      return
    }

    void fetchDetail(recommendationId, { showLoading: true })
  }, [recommendationId, fetchDetail])

  // Keep an open detail view fresh as execute-trade fills the order or the
  // nightly outcome tracker resolves it, without reopening the sheet.
  useRealtimeTable(
    recommendationId ? ['recommendations', 'trade_executions', 'decision_outcomes'] : [],
    () => {
      if (recommendationId) {
        void fetchDetail(recommendationId, { showLoading: false })
      }
    },
  )

  const close = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('recommendation')
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <Sheet open={Boolean(recommendationId)} onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{detail ? `${detail.recommendation.symbol} recommendation` : 'Recommendation detail'}</SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-5 pb-10">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-[1.5rem]" />
              <Skeleton className="h-48 w-full rounded-[1.5rem]" />
              <Skeleton className="h-40 w-full rounded-[1.5rem]" />
            </div>
          ) : error ? (
            <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">{error}</p>
          ) : detail ? (
            <>
              <ExecutiveSummary detail={detail} />
              <OrderEditor detail={detail} onDecided={() => router.refresh()} />
              <ComputationTrace detail={detail} />

              <AgentReasoningCard
                title="Fundamental"
                model={detail.fundamental?.model ?? null}
                qualifierLabel="Quality"
                qualifierValue={detail.fundamental?.output.quality_assessment ?? 'no data'}
                qualifierTone={bucketFundamental(detail.fundamental?.output.quality_assessment)}
                summary={detail.fundamental?.output.summary ?? 'No fundamental analysis was recorded for this run.'}
                bulletGroups={[
                  { label: 'Key drivers', items: detail.fundamental?.output.key_drivers ?? [] },
                  { label: 'Red flags', items: detail.fundamental?.output.red_flags ?? [] },
                ]}
                historicalPrecedent={detail.fundamental?.output.historical_precedent ?? ''}
              />

              <AgentReasoningCard
                title="Technical"
                model={detail.technical?.model ?? null}
                qualifierLabel="Setup"
                qualifierValue={detail.technical?.output.setup_quality ?? 'no data'}
                qualifierTone={bucketTechnical(detail.technical?.output.setup_quality)}
                summary={detail.technical?.output.summary ?? 'No technical analysis was recorded for this run.'}
                bulletGroups={[
                  {
                    label: 'Confirmation strength',
                    items: detail.technical?.output.confirmation_strength ? [detail.technical.output.confirmation_strength] : [],
                  },
                  {
                    label: 'Invalidation note',
                    items: detail.technical?.output.technical_invalidation_note
                      ? [detail.technical.output.technical_invalidation_note]
                      : [],
                  },
                ]}
                historicalPrecedent={detail.technical?.output.historical_precedent ?? ''}
              />

              <AgentReasoningCard
                title="Sentiment"
                model={detail.sentiment?.model ?? null}
                qualifierLabel="Direction"
                qualifierValue={detail.sentiment?.output.sentiment_direction ?? 'no data'}
                qualifierTone={bucketSentiment(detail.sentiment?.output.sentiment_direction)}
                summary={detail.sentiment?.output.summary ?? 'No sentiment analysis was recorded for this run.'}
                bulletGroups={[
                  { label: 'Catalysts', items: detail.sentiment?.output.catalysts_identified ?? [] },
                  { label: 'Red flags', items: detail.sentiment?.output.red_flags ?? [] },
                ]}
                historicalPrecedent={detail.sentiment?.output.historical_precedent ?? ''}
              />

              <SynthesisCard detail={detail} />
              <OutcomePanel detail={detail} />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

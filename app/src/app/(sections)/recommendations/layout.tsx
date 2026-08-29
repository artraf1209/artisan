import { Suspense } from 'react'
import SectionHeader from '@/components/shared/SectionHeader'
import TabStrip from '@/components/shared/TabStrip'
import DetailView from '@/components/recommendations/DetailView'
import RealtimeRefresher from '@/components/shared/RealtimeRefresher'

const TABS = [
  { href: '/recommendations', label: 'New Recommendations' },
  { href: '/recommendations/actions', label: 'Position Actions' },
  { href: '/recommendations/shortlist', label: 'Shortlist' },
  { href: '/recommendations/orders', label: 'Orders' },
]

export default function RecommendationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionHeader
        title="Recommendations"
        subtitle="What to trade, why, and how — from shortlist to filled order."
      />
      <TabStrip tabs={TABS} />
      <section className="space-y-5">{children}</section>
      <RealtimeRefresher tables={['recommendations', 'position_reviews', 'trade_executions']} />
      <Suspense fallback={null}>
        <DetailView />
      </Suspense>
    </>
  )
}

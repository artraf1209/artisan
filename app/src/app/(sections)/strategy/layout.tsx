import SectionHeader from '@/components/shared/SectionHeader'
import TabStrip from '@/components/shared/TabStrip'

const TABS = [
  { href: '/strategy', label: 'Config' },
  { href: '/strategy/agents', label: 'Agents' },
]

export default function StrategyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionHeader
        title="Strategy"
        subtitle="Every parameter the pipeline runs on, and the agents behind it."
      />
      <TabStrip tabs={TABS} />
      <section className="space-y-5">{children}</section>
    </>
  )
}

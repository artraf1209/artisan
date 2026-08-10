import SectionHeader from '@/components/shared/SectionHeader'
import TabStrip from '@/components/shared/TabStrip'

const TABS = [
  { href: '/briefing', label: 'Daily Digest' },
  { href: '/briefing/fundamental', label: 'Fundamental' },
  { href: '/briefing/technical', label: 'Technical' },
  { href: '/briefing/sentiment', label: 'Sentiment' },
  { href: '/briefing/synthesis', label: 'Synthesis' },
  { href: '/briefing/position-review', label: 'Position Review' },
]

export default function BriefingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionHeader
        title="Briefing"
        subtitle="The daily digest, and a full log of every agent behind it."
      />
      <TabStrip tabs={TABS} />
      <section className="space-y-5">{children}</section>
    </>
  )
}

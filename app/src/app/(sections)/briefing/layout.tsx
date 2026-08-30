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
      <header className="mb-5">
        <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.14em] text-amber">ARTISAN</p>
        <p className="mt-2 text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
          The daily digest, and a full log of every agent behind it.
        </p>
      </header>
      <TabStrip tabs={TABS} />
      <section className="space-y-5">{children}</section>
    </>
  )
}

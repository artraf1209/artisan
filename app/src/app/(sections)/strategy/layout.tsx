import TabStrip from '@/components/shared/TabStrip'

const TABS = [
  { href: '/strategy', label: 'Config' },
  { href: '/strategy/agents', label: 'Agents' },
]

export default function StrategyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mb-5">
        <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.14em] text-amber">ATLAS</p>
        <p className="mt-2 text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
          Every parameter the pipeline runs on, and the agents behind it.
        </p>
      </header>
      <TabStrip tabs={TABS} />
      <section className="space-y-5">{children}</section>
    </>
  )
}

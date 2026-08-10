import SectionHeader from '@/components/shared/SectionHeader'
import TabStrip from '@/components/shared/TabStrip'

const TABS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/positions', label: 'Positions' },
  { href: '/dashboard/account', label: 'Account' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionHeader
        title="Dashboard"
        subtitle="Portfolio state, goal tracking, and per-position performance."
      />
      <TabStrip tabs={TABS} />
      <section className="space-y-5">{children}</section>
    </>
  )
}

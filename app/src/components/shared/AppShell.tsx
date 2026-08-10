import Sidebar from '@/components/shared/Sidebar'
import MobileTabBar from '@/components/shared/MobileTabBar'

/**
 * Wraps every page inside the 4 primary sections (Dashboard/Recommendations/
 * Briefing/Strategy). No fixed-position chrome overlaps scrollable content —
 * Sidebar is a normal flex sibling (not fixed), and the content column
 * reserves bottom padding for MobileTabBar below the sm breakpoint only.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground sm:flex">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-7xl min-w-0 px-4 pb-28 pt-6 sm:px-6 sm:pb-12 sm:pt-10 lg:px-8 xl:px-10">
          {children}
        </main>
      </div>
      <MobileTabBar />
    </div>
  )
}

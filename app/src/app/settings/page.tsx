import Navbar from '@/components/shared/Navbar'

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <div className="rounded-lg border border-border bg-card p-6 text-muted-foreground">
          Engine configuration coming soon.
        </div>
      </main>
    </div>
  )
}

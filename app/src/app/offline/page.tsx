import Link from 'next/link'

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <div className="surface-panel w-full space-y-5 p-8">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.28em] text-muted-foreground">
          Offline
        </p>
        <h1 className="text-4xl font-semibold tracking-[-0.05em] text-foreground">
          Connection lost
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Artisan can still show cached UI, but live market data and approvals need a network
          connection.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          Return to dashboard
        </Link>
      </div>
    </main>
  )
}

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import Navbar from '@/components/shared/Navbar'

type Action = {
  href: string
  label: string
  icon: LucideIcon
}

export default function PageShell({
  eyebrow = 'Artisan PWA',
  title,
  subtitle,
  actions = [],
  children,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  actions?: Action[]
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto flex min-h-screen w-full max-w-7xl min-w-0 flex-col px-4 pb-32 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-10 xl:px-10">
        <section className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <p className="text-[0.7rem] font-medium uppercase tracking-[0.28em] text-muted-foreground">
              {eyebrow}
            </p>
            <div className="space-y-2">
              <h1 className="text-5xl font-semibold tracking-[-0.05em] text-foreground sm:text-6xl">
                {title}
              </h1>
              {subtitle ? (
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>

          {actions.length > 0 ? (
            <div className="flex items-center gap-3">
              {actions.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-label={label}
                  title={label}
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-[0_18px_40px_rgba(0,0,0,0.35)] transition hover:-translate-y-0.5 hover:text-foreground"
                >
                  <Icon size={22} />
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        <section className="space-y-5">{children}</section>
      </main>
    </div>
  )
}

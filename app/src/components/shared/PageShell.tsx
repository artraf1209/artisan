import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import AppShell from '@/components/shared/AppShell'

type Action = {
  href: string
  label: string
  icon: LucideIcon
}

export default function PageShell({
  eyebrow = 'Artisan',
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
    <AppShell>
      <div className="space-y-5">
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
            <div className="flex flex-wrap items-center gap-2">
              {actions.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card/90 px-4 py-2.5 text-sm font-medium text-muted-foreground shadow-[0_18px_40px_rgba(0,0,0,0.2)] transition hover:-translate-y-0.5 hover:text-foreground"
                >
                  <Icon size={22} />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        <section className="space-y-5">{children}</section>
      </div>
    </AppShell>
  )
}

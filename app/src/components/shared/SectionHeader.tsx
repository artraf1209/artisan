/** Same header typography PageShell used (kept intentionally — the design
 * system isn't changing, only the IA around it), minus the old unlabeled
 * icon-shortcut cluster. */
export default function SectionHeader({
  eyebrow = 'Artisan',
  title,
  subtitle,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-6 space-y-3">
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.28em] text-muted-foreground">{eyebrow}</p>
      <div className="space-y-2">
        <h1 className="text-5xl font-semibold tracking-[-0.05em] text-foreground sm:text-6xl">{title}</h1>
        {subtitle ? (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{subtitle}</p>
        ) : null}
      </div>
    </div>
  )
}

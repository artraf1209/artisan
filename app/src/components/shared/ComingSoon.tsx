/** Placeholder for a tab whose real content lands in a later task — never
 * fake data, always honest about being under construction. */
export default function ComingSoon({ label }: { label: string }) {
  return (
    <div className="surface-soft flex min-h-[16rem] flex-col items-center justify-center gap-2 rounded-[1.5rem] border border-dashed border-border/70 p-10 text-center">
      <p className="text-sm font-medium text-foreground">{label} is being rebuilt</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        This tab is part of the ongoing frontend rebuild and will land in an upcoming update.
      </p>
    </div>
  )
}

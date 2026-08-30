import ShortlistPage from '@/app/(sections)/recommendations/shortlist/page'

export const dynamic = 'force-dynamic'

export default function FiltersPage({
  searchParams,
}: {
  searchParams?: Promise<{ strategy?: string | string[] }>
}) {
  return (
    <div className="space-y-4">
      <header>
        <p className="font-[family-name:var(--font-display)] text-sm tracking-[0.14em] text-amber">ARTISAN</p>
        <p className="mt-2 text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
          Filters · shortlist, factor scores, and entry gates
        </p>
      </header>
      <ShortlistPage searchParams={searchParams} />
    </div>
  )
}

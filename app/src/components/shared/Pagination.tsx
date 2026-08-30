import Link from 'next/link'

/** Query-param-driven pager for a server-rendered list -- no client JS, just
 * plain links to `?{paramName}=N` so page navigation is a normal RSC
 * re-fetch. Renders nothing when everything fits on one page. */
export default function Pagination({
  page,
  pageSize,
  total,
  paramName,
  basePath,
}: {
  page: number
  pageSize: number
  total: number
  paramName: string
  basePath: string
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) {
    return null
  }

  const hrefFor = (targetPage: number) => `${basePath}?${paramName}=${targetPage}`

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        Page {page} of {totalPages} · {total} total
      </p>
      <div className="flex gap-2">
        <PageLink href={page > 1 ? hrefFor(page - 1) : null} label="Previous" />
        <PageLink href={page < totalPages ? hrefFor(page + 1) : null} label="Next" />
      </div>
    </div>
  )
}

function PageLink({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return (
      <span className="inline-flex cursor-not-allowed items-center justify-center rounded-full border border-border/50 px-4 py-1.5 text-xs font-medium text-muted-foreground/50">
        {label}
      </span>
    )
  }

  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-full border border-border px-4 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
    >
      {label}
    </Link>
  )
}

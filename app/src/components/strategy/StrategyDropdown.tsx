'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type StrategyOption = {
  id: string
  name: string
}

export default function StrategyDropdown({
  strategies,
  selectedId,
}: {
  strategies: StrategyOption[]
  selectedId: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  return (
    <select
      className="min-w-[16rem] rounded-2xl border border-border/70 bg-card/70 px-4 py-3 text-lg font-semibold tracking-[-0.04em] text-foreground outline-none transition focus:border-ring"
      value={selectedId}
      onChange={(event) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set('strategy', event.target.value)
        router.push(`${pathname}?${params.toString()}`)
      }}
    >
      {strategies.map((strategy) => (
        <option key={strategy.id} value={strategy.id}>
          {strategy.name}
        </option>
      ))}
    </select>
  )
}

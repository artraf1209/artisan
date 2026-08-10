'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import type { SentimentBucket } from '@/lib/recommendation-detail'

const TONE_STYLES: Record<SentimentBucket, string> = {
  positive: 'border-profit/30 bg-profit/10 text-profit',
  neutral: 'border-amber-200/25 bg-amber-200/15 text-amber-200',
  negative: 'border-loss/30 bg-loss/10 text-loss',
}

export interface AgentLogCardProps {
  symbol: string
  createdAt: string
  model: string | null
  qualifier?: { label: string; value: string; tone: SentimentBucket | null }
  summary?: string
  fields?: { label: string; value: string }[]
  listFields?: { label: string; items: string[] }[]
  historicalPrecedent?: string
}

export default function AgentLogCard({
  symbol,
  createdAt,
  model,
  qualifier,
  summary,
  fields = [],
  listFields = [],
  historicalPrecedent,
}: AgentLogCardProps) {
  const [showPrecedent, setShowPrecedent] = useState(false)

  return (
    <article className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold tracking-[-0.03em] text-foreground">{symbol}</h3>
          <span className="text-xs text-muted-foreground">{formatDate(createdAt)}</span>
        </div>
        {qualifier ? (
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.14em]',
              qualifier.tone ? TONE_STYLES[qualifier.tone] : 'border-border bg-accent/50 text-muted-foreground',
            )}
          >
            {qualifier.label}: {qualifier.value}
          </span>
        ) : null}
      </div>

      {model ? <p className="mt-1 text-xs text-muted-foreground">{model}</p> : null}

      {summary ? <p className="mt-3 text-sm leading-6 text-foreground/88">{summary}</p> : null}

      {fields.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.label} className="rounded-2xl border border-border bg-background/50 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{field.label}</p>
              <p className="mt-1 text-sm font-medium text-foreground">{field.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {listFields.map((group) =>
        group.items.length > 0 ? (
          <div key={group.label} className="mt-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{group.label}</p>
            <ul className="mt-2 space-y-1">
              {group.items.map((item) => (
                <li key={item} className="text-sm leading-6 text-foreground/85">
                  · {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}

      {historicalPrecedent ? (
        <div className="mt-4 rounded-2xl border border-border bg-background/40 p-3">
          <button
            type="button"
            onClick={() => setShowPrecedent((current) => !current)}
            className="flex w-full items-center justify-between text-left text-sm font-medium text-foreground"
          >
            <span>Historical precedent</span>
            <span className="text-muted-foreground">{showPrecedent ? 'Hide' : 'Show'}</span>
          </button>
          {showPrecedent ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {historicalPrecedent}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { SentimentBucket } from '@/lib/recommendation-detail'

const TONE_STYLES: Record<SentimentBucket, string> = {
  positive: 'border-profit/30 bg-profit/10 text-profit',
  neutral: 'border-amber-200/25 bg-amber-200/15 text-amber-200',
  negative: 'border-loss/30 bg-loss/10 text-loss',
}

export interface AgentReasoningCardProps {
  title: string
  model: string | null
  qualifierLabel: string
  qualifierValue: string
  qualifierTone: SentimentBucket | null
  summary: string
  bulletGroups: { label: string; items: string[] }[]
  historicalPrecedent: string
}

export default function AgentReasoningCard({
  title,
  model,
  qualifierLabel,
  qualifierValue,
  qualifierTone,
  summary,
  bulletGroups,
  historicalPrecedent,
}: AgentReasoningCardProps) {
  const [showPrecedent, setShowPrecedent] = useState(false)

  return (
    <article className="rounded-[1.5rem] border border-border bg-card/95 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.22)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-[-0.03em] text-foreground">{title}</h3>
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.14em]',
            qualifierTone ? TONE_STYLES[qualifierTone] : 'border-border bg-accent/50 text-muted-foreground',
          )}
        >
          {qualifierLabel}: {qualifierValue}
        </span>
      </div>

      {model ? <p className="mt-1 text-xs text-muted-foreground">{model}</p> : null}

      <p className="mt-3 text-sm leading-6 text-foreground/88">{summary}</p>

      {bulletGroups.map((group) =>
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
            {historicalPrecedent || 'No historical precedent attached.'}
          </p>
        ) : null}
      </div>
    </article>
  )
}

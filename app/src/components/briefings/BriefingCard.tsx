import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { formatStoredCalendarDate, type BriefingRecord } from '@/lib/briefings'

const SYMBOL_RE = /\b[A-Z]{1,5}\b/g
const NON_SYMBOL_TOKENS = new Set([
  'R',
  'USD',
  'ATR',
  'LLM',
  'TRIM',
  'HOLD',
  'BUY',
  'SELL',
  'WATCH',
  'ENTER',
  'EXIT',
  'CLOSE',
  'ADD',
])

function formatModel(value: string | null) {
  return value ?? 'Unknown model'
}

// Points into the Synthesis tab rather than /history — v3-11 wires that
// tab to read the ?symbol= filter; until then it's an honest stub, not a
// dead link, since the destination already exists (as a ComingSoon page).
function InlineSymbolLinks({ text }: { text: string }) {
  const parts: Array<{ type: 'text' | 'symbol'; value: string }> = []
  let cursor = 0

  for (const match of text.matchAll(SYMBOL_RE)) {
    const token = match[0]
    const index = match.index ?? 0
    if (NON_SYMBOL_TOKENS.has(token)) {
      continue
    }

    if (index > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, index) })
    }

    parts.push({ type: 'symbol', value: token })
    cursor = index + token.length
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', value: text.slice(cursor) })
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', value: text })
  }

  return (
    <>
      {parts.map((part, index) =>
        part.type === 'symbol' ? (
          <Link
            key={`${part.value}-${index}`}
            href={`/briefing/synthesis?symbol=${encodeURIComponent(part.value)}`}
            className="font-medium text-foreground underline decoration-border underline-offset-4 transition hover:text-primary"
          >
            {part.value}
          </Link>
        ) : (
          <span key={`${part.value}-${index}`}>{part.value}</span>
        ),
      )}
    </>
  )
}

export default function BriefingCard({ briefing }: { briefing: BriefingRecord }) {
  const urgentCount = briefing.urgent_flags.length

  return (
    <article className="surface-panel overflow-hidden">
      <div className="border-b border-border/70 bg-background/45 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-[-0.04em] text-foreground">
                {formatStoredCalendarDate(briefing.briefing_date)}
              </h2>
              <span className="rounded-full border border-border/70 bg-card/80 px-3 py-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                {formatModel(briefing.model)}
              </span>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${
                  urgentCount > 0
                    ? 'border-loss/40 bg-loss/10 text-loss'
                    : 'border-border/70 bg-card/80 text-muted-foreground'
                }`}
              >
                {urgentCount > 0 ? `${urgentCount} urgent ${urgentCount === 1 ? 'flag' : 'flags'}` : 'No urgent flags'}
              </span>
            </div>
            <p className="text-sm leading-6 text-foreground/88">
              <InlineSymbolLinks text={briefing.regime_line ?? 'No regime summary available.'} />
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        {briefing.urgent_flags.length > 0 ? (
          <section className="space-y-3">
            {briefing.urgent_flags.map((flag, index) => (
              <div
                key={`${briefing.id}-urgent-${index}`}
                className="rounded-[1.35rem] border border-loss/35 bg-loss/10 px-4 py-4 text-sm leading-6 text-loss"
              >
                <InlineSymbolLinks text={flag} />
              </div>
            ))}
          </section>
        ) : null}

        <section className="grid gap-3 lg:grid-cols-2">
          <StructuredBlock
            label="Regime"
            content={briefing.regime_line}
          />
          <StructuredBlock
            label="Portfolio State"
            content={briefing.portfolio_state_line}
          />
          <StructuredBlock
            label="New Recommendations"
            content={briefing.new_recommendations_summary}
          />
          <StructuredBlock
            label="Position Actions"
            content={briefing.position_actions_summary}
          />
          <div className="lg:col-span-2">
            <StructuredBlock
              label="Outcomes"
              content={briefing.outcomes_note}
            />
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-background/45 p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold tracking-[-0.03em] text-foreground">Full Digest</h3>
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Markdown</span>
          </div>

          <div className="space-y-4 text-sm leading-7 text-foreground/90">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="text-sm leading-7 text-foreground/90">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                ul: ({ children }) => <ul className="list-disc space-y-2 pl-5">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal space-y-2 pl-5">{children}</ol>,
                li: ({ children }) => <li className="text-sm leading-7 text-foreground/90">{children}</li>,
                a: ({ children, href }) => (
                  <a
                    href={href}
                    className="font-medium text-foreground underline decoration-border underline-offset-4"
                  >
                    {children}
                  </a>
                ),
                code: ({ children }) => (
                  <code className="rounded bg-background px-1.5 py-0.5 text-[0.85em] text-foreground">
                    {children}
                  </code>
                ),
              }}
            >
              {briefing.full_text}
            </ReactMarkdown>
          </div>
        </section>
      </div>
    </article>
  )
}

function StructuredBlock({
  label,
  content,
}: {
  label: string
  content: string | null
}) {
  return (
    <div className="rounded-[1.35rem] border border-border/70 bg-card/75 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm leading-6 text-foreground">
        <InlineSymbolLinks text={content ?? 'No summary available.'} />
      </p>
    </div>
  )
}

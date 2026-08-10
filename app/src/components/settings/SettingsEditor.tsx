'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  STRATEGY_SETTINGS_GROUPS,
  type SettingsRowDefinition,
  type StrategySettingsFormValues,
} from '@/lib/settings'
import type { StrategyGroupDisclosure } from '@/lib/strategy-disclosures'

function formatLastModified(value: string | null) {
  if (!value) {
    return 'No config edits have been audited yet.'
  }

  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toDisplayLabel(label: string) {
  return label.replaceAll('_', ' ')
}

export default function SettingsEditor({
  strategyId,
  strategyName,
  initialValues,
  lastModifiedAt,
  groupDisclosures,
}: {
  strategyId: string
  strategyName: string
  initialValues: StrategySettingsFormValues
  lastModifiedAt: string | null
  groupDisclosures?: Partial<Record<string, StrategyGroupDisclosure>>
}) {
  const router = useRouter()
  const [values, setValues] = useState<StrategySettingsFormValues>(initialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [requestError, setRequestError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setValues(initialValues)
    setErrors({})
  }, [initialValues])

  const factorWeightSum =
    Number(values['factor_weights.value'] || 0) +
    Number(values['factor_weights.quality'] || 0) +
    Number(values['factor_weights.momentum'] || 0) +
    Number(values['factor_weights.low_vol'] || 0) +
    Number(values['factor_weights.growth'] || 0)

  const submit = () => {
    setRequestError(null)
    setSuccessMessage(null)

    startTransition(async () => {
      const response = await fetch('/api/settings/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy_id: strategyId,
          values,
        }),
      })

      const body = (await response.json().catch(() => null)) as
        | {
            error?: string
            errors?: Record<string, string>
            message?: string
            changed_fields?: number
          }
        | null

      if (!response.ok) {
        setErrors(body?.errors ?? {})
        setRequestError(body?.error ?? 'Failed to save settings.')
        return
      }

      setErrors({})
      setRequestError(null)
      setSuccessMessage(
        body?.message ??
          `Saved ${body?.changed_fields ?? 0} ${body?.changed_fields === 1 ? 'setting' : 'settings'}.`,
      )
      router.refresh()
    })
  }

  return (
    <section className="surface-panel overflow-hidden">
      <div className="border-b border-border/70 bg-background/45 px-6 py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Active strategy</p>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
              {strategyName}
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Changes are stored on the strategy row and take effect on the next pipeline run. They do not rewrite historical recommendations or positions retroactively.
            </p>
          </div>
          <div className="rounded-[1.4rem] border border-border/70 bg-card/80 px-4 py-3 text-sm text-muted-foreground">
            Last modified: {formatLastModified(lastModifiedAt)}
          </div>
        </div>
      </div>

      <div className="space-y-6 px-6 py-6">
        {requestError ? (
          <p className="rounded-2xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
            {requestError}
          </p>
        ) : null}

        {successMessage ? (
          <p className="rounded-2xl border border-profit/30 bg-profit/10 px-4 py-3 text-sm text-profit">
            {successMessage}
          </p>
        ) : null}

        {STRATEGY_SETTINGS_GROUPS.map((group) => (
          <section key={group.id} className="surface-soft overflow-hidden">
            <div className="border-b border-border/70 bg-background/35 px-5 py-4">
              <h3 className="text-lg font-semibold tracking-[-0.03em] text-foreground">
                {group.title}
              </h3>
              {groupDisclosures?.[group.id] ? (
                <GroupDisclosure disclosure={groupDisclosures[group.id]!} />
              ) : null}
            </div>

            <div className="divide-y divide-border/70">
              {group.rows.map((row) => (
                <SettingRow
                  key={row.id}
                  row={row}
                  values={values}
                  errors={errors}
                  factorWeightSum={factorWeightSum}
                  onValueChange={(key, value) =>
                    setValues((current) => ({
                      ...current,
                      [key]: value,
                    }))
                  }
                />
              ))}
            </div>
          </section>
        ))}

        <div className="flex flex-col gap-3 border-t border-border/70 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-muted-foreground">
            Every change writes a separate `audit_log` row so the config history stays field-level, not just save-level.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? 'Saving...' : 'Save settings'}
          </button>
        </div>
      </div>
    </section>
  )
}

function GroupDisclosure({
  disclosure,
}: {
  disclosure: StrategyGroupDisclosure
}) {
  return (
    <div className="mt-4 rounded-[1.2rem] border border-border/70 bg-card/80 p-4">
      <p className="text-sm leading-6 text-muted-foreground">{disclosure.summary}</p>

      {disclosure.badges?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {disclosure.badges.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-muted-foreground"
            >
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      {disclosure.formulaLines?.length ? (
        <pre className="mt-3 overflow-x-auto rounded-[1rem] border border-border/70 bg-background/70 px-4 py-3 text-xs leading-6 text-foreground">
          <code>{disclosure.formulaLines.join('\n')}</code>
        </pre>
      ) : null}

      {disclosure.detailsLabel && disclosure.detailsLines?.length ? (
        <details className="mt-3 rounded-[1rem] border border-border/70 bg-background/50 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {disclosure.detailsLabel}
          </summary>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
            {disclosure.detailsLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {disclosure.footnote ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{disclosure.footnote}</p>
      ) : null}
    </div>
  )
}

function SettingRow({
  row,
  values,
  errors,
  factorWeightSum,
  onValueChange,
}: {
  row: SettingsRowDefinition
  values: StrategySettingsFormValues
  errors: Record<string, string>
  factorWeightSum: number
  onValueChange: (key: string, value: string | boolean) => void
}) {
  const rowError = errors[row.id]
  const isBoolean = row.fields.length === 1 && row.fields[0]?.type === 'boolean'
  const isMultiField = row.fields.length > 1

  return (
    <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="space-y-1">
          <h4 className="text-base font-semibold text-foreground">{row.label}</h4>
          <p className="text-sm leading-6 text-muted-foreground">{row.description}</p>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {row.id === 'factor_weights'
            ? `${row.hint} Current total: ${factorWeightSum.toFixed(2)}.`
            : row.hint}
        </p>
        {rowError ? <p className="text-sm text-loss">{rowError}</p> : null}
      </div>

      {isBoolean ? (
        <label className="flex items-center gap-3 rounded-[1.3rem] border border-input bg-background/70 px-4 py-4 text-sm text-foreground">
          <input
            type="checkbox"
            checked={Boolean(values[row.fields[0].key])}
            onChange={(event) => onValueChange(row.fields[0].key, event.target.checked)}
            className="h-4 w-4 rounded border-input bg-background text-primary"
          />
          <span className="leading-6">
            Toggle whether stop-tightening actions can be auto-applied when they only reduce risk.
          </span>
        </label>
      ) : isMultiField ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {row.fields.map((field) => (
            <div key={field.key} className="rounded-[1.2rem] border border-input bg-background/70 p-4">
              <label className="space-y-2 text-sm text-foreground">
                <span className="font-medium">{field.label}</span>
                <input
                  type={field.type === 'string' ? 'text' : 'number'}
                  value={String(values[field.key] ?? '')}
                  step={field.step}
                  min={field.min}
                  max={field.max}
                  placeholder={field.placeholder}
                  onChange={(event) => onValueChange(field.key, event.target.value)}
                  className="w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring"
                />
              </label>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{field.hint}</p>
              {errors[field.key] ? <p className="mt-2 text-sm text-loss">{errors[field.key]}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="space-y-2 text-sm text-foreground">
            <span className="font-medium">{toDisplayLabel(row.fields[0].label)}</span>
            <input
              type={row.fields[0].type === 'string' ? 'text' : 'number'}
              value={String(values[row.fields[0].key] ?? '')}
              step={row.fields[0].step}
              min={row.fields[0].min}
              max={row.fields[0].max}
              placeholder={row.fields[0].placeholder}
              onChange={(event) => onValueChange(row.fields[0].key, event.target.value)}
              className="w-full rounded-[1.3rem] border border-input bg-background/70 px-4 py-3 text-sm text-foreground outline-none transition focus:border-ring"
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">{row.fields[0].hint}</p>
          {errors[row.fields[0].key] ? (
            <p className="text-sm text-loss">{errors[row.fields[0].key]}</p>
          ) : null}
        </div>
      )}
    </div>
  )
}

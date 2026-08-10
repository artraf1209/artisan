'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock3, GitCompareArrows, History, RotateCcw, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  AGENT_CONFIG_MODEL_OPTIONS,
  buildPromptDiff,
  nextPromptVersion,
  normalizePromptText,
  type AgentConfigGroup,
  type AgentConfigType,
} from '@/lib/agent-configs'
import { cn, formatDate } from '@/lib/utils'
import type { AgentConfig } from '@/types'

type DraftState = Record<
  AgentConfigType,
  {
    modelId: string
    promptText: string
  }
>

type FlashState =
  | {
      type: 'success' | 'error'
      message: string
    }
  | null

type ConfirmState = {
  agentType: AgentConfigType
  label: string
  mode: 'save' | 'restore'
  nextModelId: string
  nextPromptText: string
  previousModelId: string | null
  previousPromptText: string
  previousVersion: string | null
  restoreFromId: string | null
}

type HistoryPreviewState = {
  group: AgentConfigGroup
  historyConfig: AgentConfig
}

function buildDraftState(groups: AgentConfigGroup[]): DraftState {
  return groups.reduce(
    (drafts, group) => {
      drafts[group.agentType] = {
        modelId: group.activeConfig?.model_id ?? AGENT_CONFIG_MODEL_OPTIONS[0],
        promptText: group.activeConfig?.prompt_text ?? '',
      }
      return drafts
    },
    {} as DraftState,
  )
}

function buildSaveState(group: AgentConfigGroup, draft: DraftState[AgentConfigType]): ConfirmState | null {
  const normalizedNextPrompt = normalizePromptText(draft.promptText)
  const normalizedCurrentPrompt = normalizePromptText(group.activeConfig?.prompt_text ?? '')
  const currentModel = group.activeConfig?.model_id ?? null

  if (!normalizedNextPrompt) {
    return null
  }

  if (currentModel === draft.modelId && normalizedCurrentPrompt === normalizedNextPrompt) {
    return null
  }

  return {
    agentType: group.agentType,
    label: group.label,
    mode: 'save',
    nextModelId: draft.modelId,
    nextPromptText: normalizedNextPrompt,
    previousModelId: currentModel,
    previousPromptText: normalizedCurrentPrompt,
    previousVersion: group.activeConfig?.prompt_version ?? null,
    restoreFromId: null,
  }
}

function buildRestoreState(group: AgentConfigGroup, historyConfig: AgentConfig): ConfirmState | null {
  const activePrompt = normalizePromptText(group.activeConfig?.prompt_text ?? '')
  const historyPrompt = normalizePromptText(historyConfig.prompt_text)
  const activeModel = group.activeConfig?.model_id ?? null

  if (activeModel === historyConfig.model_id && activePrompt === historyPrompt) {
    return null
  }

  return {
    agentType: group.agentType,
    label: group.label,
    mode: 'restore',
    nextModelId: historyConfig.model_id,
    nextPromptText: historyPrompt,
    previousModelId: activeModel,
    previousPromptText: activePrompt,
    previousVersion: group.activeConfig?.prompt_version ?? null,
    restoreFromId: historyConfig.id,
  }
}

function versionLabel(group: AgentConfigGroup) {
  return group.activeConfig?.prompt_version ?? 'Unseeded'
}

export default function AgentConfigsEditor({ groups }: { groups: AgentConfigGroup[] }) {
  const router = useRouter()
  const [drafts, setDrafts] = useState<DraftState>(() => buildDraftState(groups))
  const [flash, setFlash] = useState<FlashState>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [historyPreview, setHistoryPreview] = useState<HistoryPreviewState | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setDrafts(buildDraftState(groups))
  }, [groups])

  const totalVersions = groups.reduce((total, group) => total + group.totalVersions, 0)
  const seededAgents = groups.filter((group) => group.activeConfig).length

  const submitChange = () => {
    if (!confirmState) {
      return
    }

    setFlash(null)

    startTransition(async () => {
      const response = await fetch('/api/strategy/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_type: confirmState.agentType,
          model_id: confirmState.nextModelId,
          prompt_text: confirmState.nextPromptText,
          restore_from_id: confirmState.restoreFromId,
        }),
      })

      const body = (await response.json().catch(() => null)) as
        | {
            error?: string
            message?: string
          }
        | null

      if (!response.ok) {
        setFlash({
          type: 'error',
          message: body?.error ?? 'Failed to save agent config.',
        })
        return
      }

      setConfirmState(null)
      setFlash({
        type: 'success',
        message:
          body?.message ??
          `${confirmState.label} saved as ${nextPromptVersion(confirmState.previousVersion)}.`,
      })
      router.refresh()
    })
  }

  return (
    <section className="space-y-5">
      <section className="grid gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Editable agents"
          value={String(groups.length)}
          detail="All six engine agents expose a staged model + prompt editor."
        />
        <SummaryCard
          label="Seeded configs found"
          value={`${seededAgents} / ${groups.length}`}
          detail="Any missing seed row can still be created from this tab."
        />
        <SummaryCard
          label="Allow-listed models"
          value={String(AGENT_CONFIG_MODEL_OPTIONS.length)}
          detail="Model strings are constrained so a typo cannot break the next run."
        />
        <SummaryCard
          label="Stored versions"
          value={String(totalVersions)}
          detail="History is append-only. Save creates a new active row instead of rewriting the current one."
        />
      </section>

      {flash ? (
        <p
          className={cn(
            'rounded-2xl border px-4 py-3 text-sm',
            flash.type === 'success'
              ? 'border-profit/30 bg-profit/10 text-profit'
              : 'border-loss/30 bg-loss/10 text-loss',
          )}
        >
          {flash.message}
        </p>
      ) : null}

      <div className="space-y-5">
        {groups.map((group) => {
          const draft = drafts[group.agentType]
          const saveState = buildSaveState(group, draft)

          return (
            <article key={group.agentType} className="surface-panel overflow-hidden">
              <div className="border-b border-border/70 bg-background/45 px-6 py-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                        {group.label}
                      </h2>
                      <Badge variant="secondary" className="rounded-full bg-background/70 px-3 py-1">
                        {versionLabel(group)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full border-border/70 px-3 py-1">
                        {group.activeConfig?.model_id ?? 'No active model'}
                      </Badge>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                      {group.description}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[22rem]">
                    <MetaCard
                      icon={<Clock3 className="h-4 w-4" />}
                      label="Last modified"
                      value={
                        group.activeConfig
                          ? `${group.activeConfig.updated_by} · ${formatDate(group.activeConfig.updated_at)}`
                          : 'No active row yet'
                      }
                    />
                    <MetaCard
                      icon={<History className="h-4 w-4" />}
                      label="Version history"
                      value={
                        group.history.length > 0
                          ? `${group.history.length} prior ${group.history.length === 1 ? 'version' : 'versions'}`
                          : 'No prior versions'
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-5 px-6 py-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
                <div className="space-y-4">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Model</span>
                    <Select
                      value={draft.modelId}
                      onValueChange={(value) =>
                        setDrafts((current) => ({
                          ...current,
                          [group.agentType]: {
                            ...current[group.agentType],
                            modelId: value,
                          },
                        }))
                      }
                    >
                      <SelectTrigger className="h-12 rounded-[1rem] border-border/70 bg-background/60">
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {AGENT_CONFIG_MODEL_OPTIONS.map((modelId) => (
                          <SelectItem key={modelId} value={modelId}>
                            {modelId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">System prompt</span>
                    <Textarea
                      value={draft.promptText}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [group.agentType]: {
                            ...current[group.agentType],
                            promptText: event.target.value,
                          },
                        }))
                      }
                      rows={18}
                      spellCheck={false}
                      className="min-h-[26rem] rounded-[1.25rem] border-border/70 bg-background/65 font-mono text-[0.8rem] leading-6"
                    />
                  </label>

                  <div className="flex flex-col gap-3 border-t border-border/70 pt-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-6 text-muted-foreground">
                      Saves are staged through a diff confirmation modal, and the next pipeline run picks up the new version.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full border-border/70 bg-background/55"
                        onClick={() =>
                          setDrafts((current) => ({
                            ...current,
                            [group.agentType]: {
                              modelId: group.activeConfig?.model_id ?? AGENT_CONFIG_MODEL_OPTIONS[0],
                              promptText: group.activeConfig?.prompt_text ?? '',
                            },
                          }))
                        }
                        disabled={isPending}
                      >
                        Reset
                      </Button>
                      <Button
                        type="button"
                        className="rounded-full"
                        onClick={() => {
                          if (!saveState) {
                            setFlash({
                              type: 'error',
                              message: normalizePromptText(draft.promptText)
                                ? `${group.label} has no staged changes to save.`
                                : `${group.label} needs a non-empty prompt before it can be saved.`,
                            })
                            return
                          }

                          setConfirmState(saveState)
                        }}
                        disabled={isPending}
                      >
                        <Save className="h-4 w-4" />
                        Save changes
                      </Button>
                    </div>
                  </div>
                </div>

                <aside className="space-y-4">
                  <div className="surface-soft p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Active version details
                    </p>
                    <dl className="mt-3 space-y-3 text-sm">
                      <InfoRow label="Prompt version" value={versionLabel(group)} />
                      <InfoRow label="Current model" value={group.activeConfig?.model_id ?? 'Not set'} />
                      <InfoRow
                        label="Next save will write"
                        value={nextPromptVersion(group.activeConfig?.prompt_version)}
                      />
                      <InfoRow
                        label="Updated by"
                        value={group.activeConfig?.updated_by ?? 'No audit actor yet'}
                      />
                    </dl>
                  </div>

                  <div className="surface-soft p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Version history
                        </p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          Restore creates a fresh active row instead of mutating the original version.
                        </p>
                      </div>
                    </div>

                    {group.history.length === 0 ? (
                      <div className="mt-4 rounded-[1.25rem] border border-dashed border-border/70 bg-background/40 px-4 py-5 text-sm text-muted-foreground">
                        No prior versions have been saved yet.
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {group.history.map((historyConfig) => (
                          <div
                            key={historyConfig.id}
                            className="rounded-[1.25rem] border border-border/70 bg-background/45 p-4"
                          >
                            <div className="flex flex-col gap-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary" className="rounded-full bg-background/80 px-3 py-1">
                                  {historyConfig.prompt_version}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-border/70 px-3 py-1 text-[0.68rem]"
                                >
                                  {historyConfig.model_id}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {historyConfig.updated_by} · {formatDate(historyConfig.updated_at)}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="rounded-full border-border/70 bg-background/55"
                                  onClick={() => setHistoryPreview({ group, historyConfig })}
                                  disabled={isPending}
                                >
                                  <GitCompareArrows className="h-4 w-4" />
                                  View diff
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className="rounded-full"
                                  onClick={() => {
                                    const restoreState = buildRestoreState(group, historyConfig)
                                    if (!restoreState) {
                                      setFlash({
                                        type: 'error',
                                        message: `${historyConfig.prompt_version} already matches the active ${group.label} version.`,
                                      })
                                      return
                                    }

                                    setConfirmState(restoreState)
                                  }}
                                  disabled={isPending}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                  Restore this version
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </article>
          )
        })}
      </div>

      <Dialog open={Boolean(confirmState)} onOpenChange={(open) => !open && !isPending && setConfirmState(null)}>
        <DialogContent className="max-w-5xl border-border bg-card p-0 text-foreground">
          {confirmState ? (
            <>
              <DialogHeader className="border-b border-border/70 bg-background/45 px-6 py-5">
                <DialogTitle className="text-xl">
                  {confirmState.mode === 'restore' ? 'Restore agent version' : 'Review agent changes'}
                </DialogTitle>
                <DialogDescription className="text-sm leading-6 text-muted-foreground">
                  {confirmState.label} will move from {confirmState.previousVersion ?? 'no active version'} to{' '}
                  {nextPromptVersion(confirmState.previousVersion)} on the next pipeline run.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 px-6 py-6">
                <div className="grid gap-3 md:grid-cols-2">
                  <DiffSummary
                    label="Current model"
                    value={confirmState.previousModelId ?? 'Not set'}
                    muted
                  />
                  <DiffSummary label="Next model" value={confirmState.nextModelId} />
                </div>

                <section className="rounded-[1.35rem] border border-border/70 bg-background/55">
                  <div className="border-b border-border/70 px-4 py-3">
                    <p className="text-sm font-medium text-foreground">Prompt diff</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Removed lines are red, added lines are green, unchanged context stays muted.
                    </p>
                  </div>
                  <pre className="max-h-[28rem] overflow-auto px-4 py-4 text-[0.78rem] leading-6">
                    <code>
                      {buildPromptDiff(
                        confirmState.previousPromptText,
                        confirmState.nextPromptText,
                      ).map((line, index) => (
                        <div
                          key={`${line.type}-${index}-${line.text}`}
                          className={cn(
                            'whitespace-pre-wrap rounded px-2',
                            line.type === 'added' && 'bg-profit/10 text-profit',
                            line.type === 'removed' && 'bg-loss/10 text-loss',
                            line.type === 'context' && 'text-muted-foreground',
                          )}
                        >
                          {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
                          {line.text || ' '}
                        </div>
                      ))}
                    </code>
                  </pre>
                </section>
              </div>

              <DialogFooter className="border-t border-border/70 bg-background/35 px-6 py-4">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-border/70 bg-background/55"
                  onClick={() => setConfirmState(null)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="button" className="rounded-full" onClick={submitChange} disabled={isPending}>
                  {isPending
                    ? 'Saving...'
                    : confirmState.mode === 'restore'
                      ? 'Confirm restore'
                      : 'Confirm save'}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(historyPreview)}
        onOpenChange={(open) => !open && setHistoryPreview(null)}
      >
        <DialogContent className="max-w-5xl border-border bg-card p-0 text-foreground">
          {historyPreview ? (
            <>
              <DialogHeader className="border-b border-border/70 bg-background/45 px-6 py-5">
                <DialogTitle className="text-xl">
                  {historyPreview.group.label} · {historyPreview.historyConfig.prompt_version} diff
                </DialogTitle>
                <DialogDescription className="text-sm leading-6 text-muted-foreground">
                  Comparing this historical version against the current active prompt and model.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 px-6 py-6">
                <div className="grid gap-3 md:grid-cols-2">
                  <DiffSummary
                    label="Current active model"
                    value={historyPreview.group.activeConfig?.model_id ?? 'Not set'}
                    muted
                  />
                  <DiffSummary label="Historical model" value={historyPreview.historyConfig.model_id} />
                </div>

                <section className="rounded-[1.35rem] border border-border/70 bg-background/55">
                  <div className="border-b border-border/70 px-4 py-3">
                    <p className="text-sm font-medium text-foreground">Prompt diff</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Historical version {historyPreview.historyConfig.prompt_version} versus the current active prompt.
                    </p>
                  </div>
                  <pre className="max-h-[28rem] overflow-auto px-4 py-4 text-[0.78rem] leading-6">
                    <code>
                      {buildPromptDiff(
                        historyPreview.group.activeConfig?.prompt_text ?? '',
                        historyPreview.historyConfig.prompt_text,
                      ).map((line, index) => (
                        <div
                          key={`${line.type}-${index}-${line.text}`}
                          className={cn(
                            'whitespace-pre-wrap rounded px-2',
                            line.type === 'added' && 'bg-profit/10 text-profit',
                            line.type === 'removed' && 'bg-loss/10 text-loss',
                            line.type === 'context' && 'text-muted-foreground',
                          )}
                        >
                          {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
                          {line.text || ' '}
                        </div>
                      ))}
                    </code>
                  </pre>
                </section>
              </div>

              <DialogFooter className="border-t border-border/70 bg-background/35 px-6 py-4">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-border/70 bg-background/55"
                  onClick={() => setHistoryPreview(null)}
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <article className="rounded-[1.5rem] border border-border bg-card/90 p-4 shadow-[0_16px_35px_rgba(0,0,0,0.22)]">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </article>
  )
}

function MetaCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <article className="rounded-[1.25rem] border border-border/70 bg-card/80 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-xs uppercase tracking-[0.16em]">{label}</p>
      </div>
      <p className="mt-2 text-sm leading-6 text-foreground">{value}</p>
    </article>
  )
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  )
}

function DiffSummary({
  label,
  value,
  muted = false,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-[1.25rem] border px-4 py-3',
        muted ? 'border-border/70 bg-background/45' : 'border-profit/20 bg-profit/10',
      )}
    >
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm leading-6 text-foreground">{value}</p>
    </div>
  )
}

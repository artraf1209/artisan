import type { AgentConfig } from '@/types'

export type AgentConfigType = AgentConfig['agent_type']

export type AgentConfigGroup = {
  agentType: AgentConfigType
  label: string
  description: string
  activeConfig: AgentConfig | null
  history: AgentConfig[]
  totalVersions: number
}

export type PromptDiffLine = {
  type: 'context' | 'added' | 'removed'
  text: string
}

export const AGENT_CONFIG_MODEL_OPTIONS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-5',
  'claude-opus-5',
] as const

export const AGENT_CONFIG_MODEL_OPTION_SET = new Set<string>(AGENT_CONFIG_MODEL_OPTIONS)

export const AGENT_CONFIG_ORDER: AgentConfigType[] = [
  'fundamental_analyst',
  'technical_analyst',
  'sentiment_analyst',
  'synthesis',
  'position_review',
  'briefing',
]

export const AGENT_CONFIG_META: Record<
  AgentConfigType,
  {
    label: string
    description: string
  }
> = {
  fundamental_analyst: {
    label: 'Fundamental Analyst',
    description: 'Interprets factor scores and fundamentals into a qualitative read without making the trade call.',
  },
  technical_analyst: {
    label: 'Technical Analyst',
    description: 'Evaluates setup quality, technical invalidation, and regime fit from the pre-computed signal context.',
  },
  sentiment_analyst: {
    label: 'Sentiment Analyst',
    description: 'Screens the recent news flow for material catalysts and true red flags instead of keyword noise.',
  },
  synthesis: {
    label: 'Synthesis',
    description: 'Ranks the eligible candidate set into the final recommendation queue with portfolio-fit context.',
  },
  position_review: {
    label: 'Position Review',
    description: 'Reassesses every open position against the original thesis, time horizon, and new information.',
  },
  briefing: {
    label: 'Daily Briefing',
    description: 'Condenses the run into the final digest the user reads, without adding new analysis.',
  },
}

export function normalizePromptText(value: string) {
  return value.replaceAll('\r\n', '\n').trim()
}

export function nextPromptVersion(currentVersion?: string | null) {
  const match = /^v(\d+)$/i.exec((currentVersion ?? '').trim())
  return `v${match ? Number(match[1]) + 1 : 1}`
}

export function buildAgentConfigGroups(rows: AgentConfig[]) {
  const grouped = new Map<AgentConfigType, AgentConfig[]>()

  for (const row of rows) {
    const existing = grouped.get(row.agent_type) ?? []
    existing.push(row)
    grouped.set(row.agent_type, existing)
  }

  return AGENT_CONFIG_ORDER.map((agentType) => {
    const configs = [...(grouped.get(agentType) ?? [])].sort(
      (left, right) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    )
    const activeConfig = configs.find((config) => config.is_active) ?? configs[0] ?? null
    const history = activeConfig
      ? configs.filter((config) => config.id !== activeConfig.id)
      : configs

    return {
      agentType,
      label: AGENT_CONFIG_META[agentType].label,
      description: AGENT_CONFIG_META[agentType].description,
      activeConfig,
      history,
      totalVersions: configs.length,
    } satisfies AgentConfigGroup
  })
}

export function buildPromptDiff(beforeText: string, afterText: string): PromptDiffLine[] {
  const before = normalizePromptText(beforeText).split('\n')
  const after = normalizePromptText(afterText).split('\n')
  const matrix = Array.from({ length: before.length + 1 }, () =>
    Array.from({ length: after.length + 1 }, () => 0),
  )

  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      if (before[i] === after[j]) {
        matrix[i]![j] = matrix[i + 1]![j + 1]! + 1
      } else {
        matrix[i]![j] = Math.max(matrix[i + 1]![j]!, matrix[i]![j + 1]!)
      }
    }
  }

  const diff: PromptDiffLine[] = []
  let beforeIndex = 0
  let afterIndex = 0

  while (beforeIndex < before.length && afterIndex < after.length) {
    if (before[beforeIndex] === after[afterIndex]) {
      diff.push({ type: 'context', text: before[beforeIndex]! })
      beforeIndex += 1
      afterIndex += 1
      continue
    }

    if (matrix[beforeIndex + 1]![afterIndex]! >= matrix[beforeIndex]![afterIndex + 1]!) {
      diff.push({ type: 'removed', text: before[beforeIndex]! })
      beforeIndex += 1
    } else {
      diff.push({ type: 'added', text: after[afterIndex]! })
      afterIndex += 1
    }
  }

  while (beforeIndex < before.length) {
    diff.push({ type: 'removed', text: before[beforeIndex]! })
    beforeIndex += 1
  }

  while (afterIndex < after.length) {
    diff.push({ type: 'added', text: after[afterIndex]! })
    afterIndex += 1
  }

  return diff
}

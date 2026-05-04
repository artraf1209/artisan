import type { CompositeScore, LlmAnalysis, SignalEvent, TradeIntent } from '@/types'

export type ThesisAnalysis = LlmAnalysis & {
  analysis_type: 'thesis'
  signal_id: string
  symbol: string
}

export type BriefingAnalysis = LlmAnalysis & {
  analysis_type: 'briefing'
  symbol: null
  signal_id: null
}

export type QueueSignal = SignalEvent & {
  thesis?: ThesisAnalysis | null
  score?: CompositeScore | null
  trade_intent?: TradeIntent | null
}
